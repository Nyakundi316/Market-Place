import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Env } from '@markethub/shared';
import { InjectEnv } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { JobsService } from '../jobs/jobs.module';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from './payments.service';
import { Gateways } from './providers/gateways';
import type { GatewayName } from './providers/payment-provider';

/** Pending charges younger than this may still be on the buyer's screen. */
const SETTLE_MS = 15 * 60_000;
const LOOKBACK_MS = 48 * 3_600_000;

export interface ReconcileReport {
  checked: number;
  recovered: string[];
  failed: string[];
  mismatches: { txnId: string; ours: string; theirs: string }[];
}

/**
 * §7/§8 reconcile:payments, nightly. Compares recent charges with the
 * gateway's ledger: recovers payments whose webhook never arrived, closes
 * abandoned ones, and alerts admins about anything that disagrees.
 */
@Injectable()
export class ReconciliationService implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly gateways: Gateways,
    private readonly payments: PaymentsService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @InjectEnv() private readonly env: Env,
  ) {}

  async onModuleInit() {
    this.jobs.work(
      'reconcile',
      async (job) => {
        if (job.name === 'payments') await this.run();
      },
      1,
    );
    if (this.env.NODE_ENV === 'test') return;
    await this.jobs
      .queue('reconcile')
      .upsertJobScheduler(
        'nightly-payments',
        { pattern: '0 3 * * *', tz: 'UTC' },
        { name: 'payments' },
      )
      .catch((err: unknown) => this.logger.error({ err }, 'could not schedule reconciliation'));
  }

  async run(now = new Date()): Promise<ReconcileReport> {
    const report: ReconcileReport = { checked: 0, recovered: [], failed: [], mismatches: [] };
    const charges = await this.db.transaction.findMany({
      where: {
        type: 'charge',
        gatewayRef: { not: null },
        status: { in: ['pending', 'succeeded'] },
        updatedAt: { gte: new Date(now.getTime() - LOOKBACK_MS) },
      },
    });

    for (const txn of charges) {
      if (txn.status === 'pending' && now.getTime() - txn.createdAt.getTime() < SETTLE_MS) continue;
      let provider;
      try {
        provider = this.gateways.byName(txn.gateway);
      } catch {
        continue; // gateway since unconfigured (keys rotated out locally)
      }
      report.checked++;
      let theirs;
      try {
        theirs = await provider.lookup(txn.gatewayRef!);
      } catch (err) {
        this.logger.warn({ err, txnId: txn.id }, 'gateway lookup failed; will retry next run');
        continue;
      }
      const ours = `${txn.amount.toFixed(2)} ${txn.currency} ${txn.status}`;
      const amountsAgree =
        theirs.amount === txn.amount.toFixed(2) && theirs.currency === txn.currency;

      if (txn.status === 'pending' && theirs.status === 'succeeded' && amountsAgree) {
        // The webhook went missing: apply what it would have said, once.
        await this.payments.applyOnce(txn.gateway as GatewayName, {
          id: `reconcile:${txn.id}`,
          kind: 'charge.succeeded',
          ref: txn.gatewayRef!,
          amount: theirs.amount,
          currency: theirs.currency,
        });
        report.recovered.push(txn.id);
      } else if (txn.status === 'pending' && theirs.status === 'failed') {
        await this.db.transaction.update({ where: { id: txn.id }, data: { status: 'failed' } });
        report.failed.push(txn.id);
      } else if (
        (txn.status === 'succeeded' && (theirs.status !== 'succeeded' || !amountsAgree)) ||
        (txn.status === 'pending' && theirs.status === 'succeeded' && !amountsAgree)
      ) {
        report.mismatches.push({
          txnId: txn.id,
          ours,
          theirs: `${theirs.amount} ${theirs.currency} ${theirs.status}`,
        });
      }
    }

    if (report.mismatches.length) await this.alert(report);
    await this.audit.log({
      actorId: null,
      action: 'reconcile.run',
      entityType: 'system',
      entityId: 'payments',
      metadata: {
        checked: report.checked,
        recovered: report.recovered.length,
        failed: report.failed.length,
        mismatches: report.mismatches.length,
      },
    });
    return report;
  }

  private async alert(report: ReconcileReport) {
    this.logger.error({ mismatches: report.mismatches }, 'payment reconciliation mismatch');
    for (const m of report.mismatches) {
      await this.audit.log({
        actorId: null,
        action: 'reconcile.mismatch',
        entityType: 'transaction',
        entityId: m.txnId,
        metadata: { ours: m.ours, theirs: m.theirs },
      });
    }
    const admins = await this.db.user.findMany({
      where: { role: 'admin', isActive: true },
      select: { id: true },
    });
    for (const a of admins) {
      await this.notifications.notify(a.id, {
        type: 'payment.failed',
        title: `Reconciliation: ${report.mismatches.length} payment(s) disagree with the gateway`,
        body: report.mismatches
          .map((m) => `${m.txnId}: ours ${m.ours}, gateway ${m.theirs}`)
          .join('\n')
          .slice(0, 1000),
        link: '/admin',
        payload: { mismatches: report.mismatches.map((m) => m.txnId) },
      });
    }
  }
}
