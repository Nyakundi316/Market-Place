import argon2 from 'argon2';

// §9: argon2id, 64 MB, t=3, p=4
const OPTIONS = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 4 } as const;

export const hashPassword = (plain: string) => argon2.hash(plain, OPTIONS);

/** Never throws on a malformed hash — a corrupt row should read as "wrong password". */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** True when a stored hash was made with weaker params and should be rehashed on next login. */
export const needsRehash = (hash: string) => argon2.needsRehash(hash, OPTIONS);
