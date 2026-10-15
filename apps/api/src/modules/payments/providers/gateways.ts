import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { type Env, type Gateway, gatewayFor } from '@markethub/shared';
import type Redis from 'ioredis';
import { InjectEnv } from '../../../config/env.validation';
import { InjectRedis } from '../../../redis/redis.module';
import type { GatewayName, PaymentProvider } from './payment-provider';
import { PaystackProvider } from './paystack.provider';
import { SandboxProvider } from './sandbox.provider';
import { StripeProvider } from './stripe.provider';

/**
 * Picks the provider for a currency (§1 adapter). A gateway without keys is
 * served by the sandbox — possible only outside production, where the env
 * schema already demands every key.
 */
@Injectable()
export class Gateways {
  private readonly logger = new Logger(Gateways.name);
  readonly stripe: StripeProvider | null;
  readonly paystack: PaystackProvider | null;
  readonly sandbox: SandboxProvider;
  readonly stripePublishableKey: string | null;

  constructor(@InjectEnv() env: Env, @InjectRedis() redis: Redis) {
    this.stripe =
      env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET
        ? new StripeProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET)
        : null;
    this.paystack =
      env.PAYSTACK_SECRET_KEY && env.PAYSTACK_WEBHOOK_SECRET
        ? new PaystackProvider(env.PAYSTACK_SECRET_KEY, env.PAYSTACK_WEBHOOK_SECRET)
        : null;
    this.stripePublishableKey = env.STRIPE_PUBLISHABLE_KEY ?? null;
    // Derived, never configured: the sandbox only ever verifies its own events.
    const sandboxSecret = createHmac('sha256', env.JWT_ACCESS_SECRET)
      .update('sandbox-webhooks')
      .digest('hex');
    this.sandbox = new SandboxProvider(redis, sandboxSecret);

    const missing = [!this.stripe && 'Stripe', !this.paystack && 'Paystack'].filter(Boolean);
    if (missing.length && env.NODE_ENV !== 'test') {
      this.logger.warn(`${missing.join(' and ')} not configured — using the payment sandbox`);
    }
  }

  forCurrency(currency: string): PaymentProvider {
    return this.forGateway(gatewayFor(currency));
  }

  forGateway(gateway: Gateway): PaymentProvider {
    return (gateway === 'stripe' ? this.stripe : this.paystack) ?? this.sandbox;
  }

  /** For a stored Transaction.gateway / PayoutAccount.gateway value. */
  byName(name: string): PaymentProvider {
    if (name === 'sandbox') return this.sandbox;
    const real = name === 'stripe' ? this.stripe : name === 'paystack' ? this.paystack : null;
    if (!real) throw new Error(`Gateway ${name} is not configured`);
    return real;
  }

  /** Which gateway name a currency's payments will be recorded under. */
  nameFor(currency: string): GatewayName {
    return this.forCurrency(currency).gateway;
  }
}
