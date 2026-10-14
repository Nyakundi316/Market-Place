import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Env } from '@markethub/shared';
import { type JobsOptions, Queue, Worker, type Processor } from 'bullmq';
import Redis from 'ioredis';
import { ENV } from '../../config/env.validation';

/**
 * §8 queues. BullMQ forbids ':' in queue names, so "notify:offline" is queue
 * `notify`, job `offline`; "email:send" is queue `email`, job `send`.
 * Custom jobIds may contain ':' only as exactly three parts (`a:b:c`);
 * anything else makes `add()` throw, so prefer `-` as the separator.
 */
export const QUEUES = ['notify', 'email'] as const;
export type QueueName = (typeof QUEUES)[number];

/** §8: idempotent jobs, exponential backoff, max 5 attempts, then the DLQ. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: true, // lets a deterministic jobId be reused later
  removeOnFail: 1_000,
};

const DEAD_LETTER = 'dead-letter';

@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
  // BullMQ needs blocking commands, so its own connection (maxRetriesPerRequest: null).
  private readonly connection: Redis;
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  // BullMQ never closes connections it was handed, so we track and quit them.
  private readonly owned: Redis[] = [];

  constructor(@Inject(ENV) env: Env) {
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }

  queue(name: QueueName | typeof DEAD_LETTER): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, q);
    }
    return q;
  }

  /** Runs in the API process; BullMQ keeps concurrent instances from double-processing. */
  work(name: QueueName, processor: Processor, concurrency = 5) {
    const connection = this.connection.duplicate();
    this.owned.push(connection);
    const worker = new Worker(name, processor, {
      connection,
      concurrency,
    });
    worker.on('failed', (job, err) => {
      if (!job) return;
      const final = job.attemptsMade >= (job.opts.attempts ?? 1);
      this.logger[final ? 'error' : 'warn'](
        { err, queue: name, job: job.name, id: job.id, attempt: job.attemptsMade },
        final ? 'job failed for good → dead-letter' : 'job failed, will retry',
      );
      if (final) {
        void this.queue(DEAD_LETTER)
          .add(`${name}:${job.name}`, { data: job.data, error: err.message, failedAt: Date.now() })
          .catch((e: unknown) => this.logger.error({ err: e }, 'dead-letter enqueue failed'));
      }
    });
    worker.on('error', (err) => this.logger.error({ err, queue: name }, 'worker error'));
    this.workers.push(worker);
    return worker;
  }

  async onApplicationShutdown() {
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    await Promise.allSettled(
      [this.connection, ...this.owned].map((c) => c.quit().catch(() => c.disconnect())),
    );
  }
}

@Global()
@Module({ providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
