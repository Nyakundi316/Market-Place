import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

// Defence in depth for §9: even if a service returns a raw Prisma row,
// these never leave the API.
const FORBIDDEN_KEYS = new Set(['passwordHash', 'gatewayPayload', 'tokenHash', 'tokens']);

/** Prisma.Decimal without importing Prisma here (it arrives in 1.4). */
function isDecimal(v: object): v is { toFixed(): string } {
  return v.constructor?.name === 'Decimal' && 'toFixed' in v;
}

export function sanitize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if (value instanceof Date) return value.toISOString();
  // Money stays a string end-to-end so floats never touch it.
  if (isDecimal(value)) return value.toFixed();
  if (Array.isArray(value)) return value.map(sanitize);

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!FORBIDDEN_KEYS.has(key)) out[key] = sanitize(v);
  }
  return out;
}

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(sanitize));
  }
}
