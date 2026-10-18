import { Injectable, Logger } from '@nestjs/common';
import type { Env } from '@markethub/shared';
import type Redis from 'ioredis';
import { InjectEnv } from '../../config/env.validation';
import { InjectRedis } from '../../redis/redis.module';

export const smsOutboxKey = (phone: string) => `sms:outbox:${phone}`;

const AT_URL = {
  live: 'https://api.africastalking.com/version1/messaging',
  // Africa's Talking's sandbox account is literally called "sandbox"; messages show up
  // in their web simulator instead of on a handset.
  sandbox: 'https://api.sandbox.africastalking.com/version1/messaging',
};

// Per-recipient status codes: 100 Processed, 101 Sent, 102 Queued.
const ACCEPTED = new Set([100, 101, 102]);
// 403 InvalidPhoneNumber, 404 UnsupportedNumberType, 406 UserInBlacklist,
// 409 DoNotDisturbRejection: retrying won't help, the number is the problem.
const NUMBER_PROBLEM = new Set([403, 404, 406, 409]);

interface AtRecipient {
  statusCode: number;
  status: string;
  messageId?: string;
}

export class SmsError extends Error {
  constructor(
    message: string,
    /** True when the recipient can't be texted at all, so the caller can blame the number. */
    readonly badNumber = false,
  ) {
    super(message);
  }
}

/**
 * Phone codes go out through Africa's Talking once `AFRICASTALKING_USERNAME` and
 * `AFRICASTALKING_API_KEY` are set (brief §3 addendum). Without them, outside
 * production, messages land in a Redis outbox (and the dev log) that dev and
 * tests read; in production phone verification reports itself unavailable.
 * Tests always use the outbox, even if a key leaks into the shell.
 */
@Injectable()
export class SmsSender {
  private readonly logger = new Logger(SmsSender.name);

  constructor(
    @InjectEnv() private readonly env: Env,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  private get gateway() {
    const { AFRICASTALKING_USERNAME: username, AFRICASTALKING_API_KEY: apiKey } = this.env;
    if (this.env.NODE_ENV === 'test' || !username || !apiKey) return null;
    return { username, apiKey, from: this.env.AFRICASTALKING_SENDER_ID };
  }

  get available() {
    return this.gateway !== null || this.env.NODE_ENV !== 'production';
  }

  async send(phone: string, text: string): Promise<void> {
    const gateway = this.gateway;
    if (gateway) return this.viaAfricasTalking(gateway, phone, text);
    if (!this.available) throw new SmsError('No SMS provider configured');

    await this.redis
      .multi()
      .lpush(smsOutboxKey(phone), text)
      .expire(smsOutboxKey(phone), 3600)
      .exec();
    if (this.env.NODE_ENV === 'development') this.logger.log(`SMS to ${phone}: ${text}`);
  }

  private async viaAfricasTalking(
    { username, apiKey, from }: { username: string; apiKey: string; from?: string },
    phone: string,
    text: string,
  ) {
    const body = new URLSearchParams({ username, to: phone, message: text });
    if (from) body.set('from', from);

    const res = await fetch(username === 'sandbox' ? AT_URL.sandbox : AT_URL.live, {
      method: 'POST',
      headers: {
        apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    // Errors before routing (bad key, bad username) come back as plain text.
    const raw = await res.text();
    let recipient: AtRecipient | undefined;
    try {
      recipient = (JSON.parse(raw) as { SMSMessageData?: { Recipients?: AtRecipient[] } })
        .SMSMessageData?.Recipients?.[0];
    } catch {
      // not JSON: handled below with the raw text
    }

    const tail = `…${phone.slice(-4)}`;
    if (!res.ok || !recipient) {
      this.logger.error(`Africa's Talking ${res.status} for ${tail}: ${raw.slice(0, 200)}`);
      throw new SmsError(`SMS gateway responded ${res.status}`);
    }
    if (!ACCEPTED.has(recipient.statusCode)) {
      this.logger.warn(
        `Africa's Talking refused ${tail}: ${recipient.statusCode} ${recipient.status}`,
      );
      throw new SmsError(recipient.status, NUMBER_PROBLEM.has(recipient.statusCode));
    }
  }
}
