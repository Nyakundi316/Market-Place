import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { POLICIES, type PolicyName, RateLimitService } from './rate-limit.service';

const RATE_LIMIT = 'rateLimit';
/** Adds a stricter bucket on top of the global one, e.g. @RateLimit('auth'). */
export const RateLimit = (policy: Exclude<PolicyName, 'global'>) => SetMetadata(RATE_LIMIT, policy);

/**
 * Registered after JwtAuthGuard so req.user is known: buckets are per user,
 * or per IP for anonymous calls. Auth routes are always per IP — there's no
 * user yet, and keying on the submitted email would let an attacker lock
 * someone out.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimitService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const res = ctx.switchToHttp().getResponse<Response>();

    const ipKey = `ip:${req.ip ?? 'unknown'}`;
    const callerKey = req.user ? `u:${req.user.id}` : ipKey;
    const named = this.reflector.getAllAndOverride<PolicyName | undefined>(RATE_LIMIT, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const checks: [string, PolicyName][] = [[`global:${callerKey}`, 'global']];
    if (named) checks.push([`${named}:${named === 'auth' ? ipKey : callerKey}`, named]);

    for (const [key, name] of checks) {
      const policy = POLICIES[name];
      const verdict = await this.limiter.consume(key, policy);
      res.setHeader('RateLimit-Limit', policy.capacity);
      res.setHeader('RateLimit-Remaining', verdict.remaining);
      if (!verdict.allowed) {
        res.setHeader('Retry-After', Math.max(1, Math.ceil(verdict.retryAfterMs / 1000)));
        throw new HttpException('Too many requests, slow down', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    return true;
  }
}
