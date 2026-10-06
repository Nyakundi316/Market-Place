import { Controller, Get, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CurrentUser, type RequestUser } from '../src/common/decorators/current-user.decorator';
import { Public } from '../src/common/decorators/public.decorator';
import { Roles, Verified } from '../src/common/decorators/roles.decorator';
import { TokenService } from '../src/modules/auth/token.service';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, resetRateLimits, uniqueEmail } from './helpers';

@Controller('probe')
class ProbeController {
  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return user;
  }

  @Roles('admin')
  @Get('admin')
  admin() {
    return { ok: true };
  }

  @Roles('seller')
  @Get('seller')
  seller() {
    return { ok: true };
  }

  @Verified()
  @Get('verified')
  verified() {
    return { ok: true };
  }
}

describe('Guards (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let tokens: TokenService;
  const http = () => request(app.getHttpServer());

  async function userWith(
    data: Partial<{ role: 'buyer' | 'seller' | 'both' | 'admin'; isEmailVerified: boolean }> = {},
  ) {
    const user = await db.user.create({ data: { email: uniqueEmail('g'), ...data } });
    return { user, bearer: `Bearer ${tokens.signAccess({ sub: user.id, role: user.role })}` };
  }

  beforeAll(async () => {
    app = await createApp([ProbeController]);
    db = app.get(PrismaService);
    tokens = app.get(TokenService);
  });
  beforeEach(resetRateLimits);
  afterAll(() => app.close());

  it('routes are protected by default; @Public opts out', async () => {
    await http().get('/probe/open').expect(200);
    await http().get('/probe/me').expect(401);
    await http().get('/probe/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    await http().get('/probe/me').set('Authorization', 'Basic abc').expect(401);
  });

  it('@CurrentUser exposes id/role/isEmailVerified from the DB', async () => {
    const { user, bearer } = await userWith();
    const res = await http().get('/probe/me').set('Authorization', bearer).expect(200);
    expect(res.body).toEqual({ id: user.id, role: 'buyer', isEmailVerified: false });
  });

  it('a ban applies immediately, even with a still-valid token (§9)', async () => {
    const { user, bearer } = await userWith();
    await db.user.update({ where: { id: user.id }, data: { isBanned: true } });
    await http().get('/probe/me').set('Authorization', bearer).expect(403);
  });

  it('role comes from the DB, not the token: demotion is immediate', async () => {
    const { user, bearer } = await userWith({ role: 'admin' });
    await http().get('/probe/admin').set('Authorization', bearer).expect(200);
    await db.user.update({ where: { id: user.id }, data: { role: 'buyer' } });
    await http().get('/probe/admin').set('Authorization', bearer).expect(403);
  });

  it('@Roles: buyer blocked from seller routes; role=both passes', async () => {
    const buyer = await userWith({ role: 'buyer' });
    const both = await userWith({ role: 'both' });
    await http().get('/probe/seller').set('Authorization', buyer.bearer).expect(403);
    await http().get('/probe/seller').set('Authorization', both.bearer).expect(200);
  });

  it('@Verified requires a verified email', async () => {
    const unverified = await userWith();
    const verified = await userWith({ isEmailVerified: true });
    const res = await http()
      .get('/probe/verified')
      .set('Authorization', unverified.bearer)
      .expect(403);
    expect(res.body.message).toBe('Verify your email address first');
    await http().get('/probe/verified').set('Authorization', verified.bearer).expect(200);
  });

  it('deleted users are rejected', async () => {
    const { user, bearer } = await userWith();
    await db.user.delete({ where: { id: user.id } });
    await http().get('/probe/me').set('Authorization', bearer).expect(401);
  });
});
