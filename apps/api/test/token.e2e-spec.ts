import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { EnvModule } from '../src/config/env.validation';
import { TokenService } from '../src/modules/auth/token.service';
import { PrismaModule, PrismaService } from '../src/prisma/prisma.module';

describe('TokenService', () => {
  let tokens: TokenService;
  let db: PrismaService;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EnvModule, PrismaModule, JwtModule.register({})],
      providers: [TokenService],
    }).compile();
    await moduleRef.init();
    tokens = moduleRef.get(TokenService);
    db = moduleRef.get(PrismaService);
    userId = (await db.user.create({ data: { email: `tok-${Date.now()}@test.local` } })).id;
  });

  afterAll(() => db.$disconnect());

  describe('access tokens', () => {
    it('round-trips sub and role', () => {
      const jwt = tokens.signAccess({ sub: userId, role: 'buyer' });
      expect(tokens.verifyAccess(jwt)).toEqual({ sub: userId, role: 'buyer' });
    });

    it('rejects tokens signed with another secret, alg=none, or tampered payloads', () => {
      const forged = new JwtService().sign(
        { sub: userId, role: 'admin' },
        { secret: 'x'.repeat(40) },
      );
      expect(() => tokens.verifyAccess(forged)).toThrow('Invalid or expired token');

      const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url');
      const body = Buffer.from(JSON.stringify({ sub: userId, role: 'admin' })).toString(
        'base64url',
      );
      expect(() => tokens.verifyAccess(`${header}.${body}.`)).toThrow();

      const [h, , s] = tokens.signAccess({ sub: userId, role: 'buyer' }).split('.');
      expect(() => tokens.verifyAccess(`${h}.${body}.${s}`)).toThrow();
    });
  });

  describe('refresh rotation', () => {
    it('stores only a keyed hash, never the token', async () => {
      const rt = await tokens.issueRefresh(userId);
      const row = await db.refreshToken.findFirstOrThrow({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      expect(row.tokenHash).not.toContain(rt);
      expect(row.tokenHash).toHaveLength(43); // sha256 base64url
    });

    it('rotates: new token works, old one is single-use', async () => {
      const first = await tokens.issueRefresh(userId);
      const { refreshToken: second } = await tokens.rotate(first);
      expect(second).not.toBe(first);
      await expect(tokens.rotate(second)).resolves.toMatchObject({ userId });
    });

    it('reusing a spent token revokes the whole family', async () => {
      const first = await tokens.issueRefresh(userId);
      const { refreshToken: second } = await tokens.rotate(first);

      await expect(tokens.rotate(first)).rejects.toThrow('Session revoked'); // attacker replays
      await expect(tokens.rotate(second)).rejects.toThrow('Session revoked'); // legit holder is out too
    });

    it('concurrent refreshes with the same token: exactly one wins', async () => {
      const rt = await tokens.issueRefresh(userId);
      const results = await Promise.allSettled([
        tokens.rotate(rt),
        tokens.rotate(rt),
        tokens.rotate(rt),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('rejects expired and unknown tokens', async () => {
      const rt = await tokens.issueRefresh(userId);
      await db.refreshToken.updateMany({
        where: { userId, usedAt: null, revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expect(tokens.rotate(rt)).rejects.toThrow('Session expired');
      await expect(tokens.rotate('nope')).rejects.toThrow('Invalid session');
    });

    it('revoke() signs out that device; revokeAllForUser() signs out everywhere', async () => {
      const phone = await tokens.issueRefresh(userId);
      const laptop = await tokens.issueRefresh(userId);
      await tokens.revoke(phone);
      await expect(tokens.rotate(phone)).rejects.toThrow();
      const { refreshToken: laptop2 } = await tokens.rotate(laptop);

      await tokens.revokeAllForUser(userId);
      await expect(tokens.rotate(laptop2)).rejects.toThrow();
    });
  });
});
