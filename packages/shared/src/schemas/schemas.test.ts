import { describe, expect, it } from 'vitest';
import { registerSchema, resetPasswordSchema } from './auth';
import { cursorQuerySchema } from './pagination';
import { updateProfileSchema, usernameSchema } from './profile';

describe('registerSchema', () => {
  it('normalises email and defaults role', () => {
    const out = registerSchema.parse({ email: '  Jane@Example.COM ', password: 'correct horse' });
    expect(out).toEqual({ email: 'jane@example.com', password: 'correct horse', role: 'buyer' });
  });
  it('rejects short passwords and admin self-signup', () => {
    expect(registerSchema.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(false);
    expect(
      registerSchema.safeParse({ email: 'a@b.co', password: 'longenough', role: 'admin' }).success,
    ).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('requires a real-length token', () => {
    expect(resetPasswordSchema.safeParse({ token: 'abc', password: 'longenough' }).success).toBe(
      false,
    );
  });
});

describe('usernameSchema', () => {
  it.each(['jane_doe', 'abc', 'j4ne'])('accepts %s', (u) =>
    expect(usernameSchema.parse(u)).toBe(u),
  );
  it.each(['ab', '_jane', 'jane_', 'jane doe', 'jané'])('rejects %s', (u) =>
    expect(usernameSchema.safeParse(u).success).toBe(false),
  );
});

describe('updateProfileSchema', () => {
  it('rejects unknown keys so clients cannot set rating or verification', () => {
    expect(updateProfileSchema.safeParse({ ratingAvg: 5 }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ idVerified: true }).success).toBe(false);
  });
  it('blocks role escalation to admin', () => {
    expect(updateProfileSchema.safeParse({ role: 'admin' }).success).toBe(false);
  });
  it('upper-cases country code', () => {
    expect(updateProfileSchema.parse({ country: 'ke' }).country).toBe('KE');
  });
});

describe('cursorQuerySchema', () => {
  it('caps limit at 50 (§0)', () => {
    expect(cursorQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(cursorQuerySchema.parse({}).limit).toBe(20);
  });
});
