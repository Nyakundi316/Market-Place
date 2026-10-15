import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { SharedArray } from 'k6/data';

/** Staging only. Never point these scripts at production with its real secret. */
export const API = (__ENV.API_URL || 'http://localhost:3001').replace(/\/+$/, '');
const SECRET = __ENV.JWT_ACCESS_SECRET;
if (!SECRET)
  throw new Error('Set JWT_ACCESS_SECRET (the target environment’s) so k6 can sign tokens');

// Written by `pnpm --filter api seed:load`; ids only, no credentials.
const fixtures = new SharedArray('fixtures', () => [JSON.parse(open('../fixtures.json'))]);
export const data = () => fixtures[0];

const b64 = (s) => encoding.b64encode(s, 'rawurl');

/**
 * A 15-minute access token for a seeded user, signed exactly as the API signs
 * them (HS256, iss markethub-api, aud markethub). Skips /auth/login, which is
 * rate limited per IP and would make a single load machine the bottleneck.
 */
export function tokenFor(userId) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(
    JSON.stringify({
      sub: userId,
      role: 'both',
      iss: 'markethub-api',
      aud: 'markethub',
      iat: now,
      exp: now + 900,
    }),
  );
  const sig = crypto.hmac('sha256', SECRET, `${head}.${body}`, 'base64rawurl');
  return `${head}.${body}.${sig}`;
}

export const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
