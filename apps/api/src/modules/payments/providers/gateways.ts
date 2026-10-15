import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Env, Gateway } from '@markethub/shared';
import type Redis from 'ioredis';
import { InjectEnv } from '../../../config/env.validation';
import { InjectRedis } from '../../../redis/redis.module';
import type { GatewayName, PaymentProvider } from './payment-provider';
import { PaystackProvider } from './paystack.provider';
import { SandboxProvider } from './sandbox.provider';

/**
 * Paystack is the gateway (§1 adapter, Stripe dropped: it doesn't serve
 * Kenyan businesses). Without its keys, the sandbox stands in — possible only
 * outside production, where the env schema already demands them.
 */
@Injectable()
export class Gateways {
  private readonly logger = new Logger(Gateways.name);
  readonly paystack: PaystackProvider | null;
  readonly sandbox: SandboxProvider;

  constructor(@InjectEnv() env: Env, @InjectRedis() redis: Redis) {
    this.paystack =
      env.PAYSTACK_SECRET_KEY && env.PAYSTACK_WEBHOOK_SECRET
        ? new PaystackProvider(env.PAYSTACK_SECRET_KEY, env.PAYSTACK_WEBHOOK_SECRET)
        : null;
    // Derived, never configured: the sandbox only ever verifies its own events.
    const sandboxSecret = createHmac('sha256', env.JWT_ACCESS_SECRET)
      .update('sandbox-webhooks')
      .digest('hex');
    this.sandbox = new SandboxProvider(redis, sandboxSecret);

    if (!this.paystack && env.NODE_ENV !== 'test') {
      this.logger.warn('Paystack not configured — using the payment sandbox');
    }
  }

  forCurrency(_currency: string): PaymentProvider {
    return this.forGateway('paystack');
  }

  forGateway(_gateway: Gateway): PaymentProvider {
    return this.paystack ?? this.sandbox;
  }

  /** For a stored Transaction.gateway / PayoutAccount.gateway value. */
  byName(name: string): PaymentProvider {
    if (name === 'sandbox') return this.sandbox;
    if (name === 'paystack' && this.paystack) return this.paystack;
    throw new Error(`Gateway ${name} is not configured`);
  }

  /** Which gateway name a currency's payments will be recorded under. */
  nameFor(currency: string): GatewayName {
    return this.forCurrency(currency).gateway;
  }
}
