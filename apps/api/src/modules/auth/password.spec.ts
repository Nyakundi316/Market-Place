import { hashPassword, needsRehash, verifyPassword } from './password';

describe('password', () => {
  it('hashes with argon2id at §9 params and verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(needsRehash(hash)).toBe(false);
  });

  it('rejects the wrong password and garbage hashes without throwing', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword(hash, 'Correct horse battery')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});
