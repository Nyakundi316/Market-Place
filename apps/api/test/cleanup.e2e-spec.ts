import type { INestApplication } from '@nestjs/common';
import { Cleanup } from '../src/modules/audit/cleanup';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, type TestUser } from './helpers';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const hash = () => `h-${Math.random().toString(36).slice(2)}`;

describe('audit:cleanup (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let user: TestUser;

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    user = await makeUser(app);
  });
  afterAll(() => app.close());

  it('prunes dead rows and leaves everything still meaningful', async () => {
    const familyId = crypto.randomUUID();
    const refresh = (expiresAt: Date, extra = {}) =>
      db.refreshToken.create({
        data: { userId: user.id, tokenHash: hash(), familyId, expiresAt, ...extra },
      });
    const staleRefresh = await refresh(daysAgo(31));
    // Used long ago but not yet expired: still needed for reuse detection.
    const rotated = await refresh(daysAgo(-5), { usedAt: daysAgo(40) });

    const token = (expiresAt: Date, usedAt?: Date) =>
      db.authToken.create({
        data: { userId: user.id, type: 'email_verify', tokenHash: hash(), expiresAt, usedAt },
      });
    const staleToken = await token(daysAgo(31));
    const usedToken = await token(daysAgo(-1), daysAgo(31));
    const freshToken = await token(daysAgo(-1));

    const note = (isRead: boolean, readAt?: Date) =>
      db.notification.create({
        data: { userId: user.id, type: 'review.received', title: 'x', isRead, readAt },
      });
    const oldRead = await note(true, daysAgo(91));
    const recentRead = await note(true, daysAgo(10));
    const unread = await note(false);

    const event = (processedAt: Date | null) =>
      db.webhookEvent.create({
        data: {
          gateway: 'sandbox',
          eventId: hash(),
          type: 'charge.success',
          payload: {},
          processedAt,
        },
      });
    const oldEvent = await event(daysAgo(91));
    const failedEvent = await event(null);

    const audit = await db.auditLog.create({
      data: {
        actorId: user.id,
        action: 'user.register',
        entityType: 'user',
        entityId: user.id,
        createdAt: daysAgo(4000),
      },
    });

    const counts = await app.get(Cleanup).run();
    expect(counts.refreshTokens).toBeGreaterThanOrEqual(1);

    const ids = async <T extends { id: string }>(rows: Promise<T[]>) =>
      new Set((await rows).map((r) => r.id));
    const refreshLeft = await ids(db.refreshToken.findMany({ where: { familyId } }));
    expect(refreshLeft.has(staleRefresh.id)).toBe(false);
    expect(refreshLeft.has(rotated.id)).toBe(true);

    const tokensLeft = await ids(db.authToken.findMany({ where: { userId: user.id } }));
    expect(tokensLeft.has(staleToken.id)).toBe(false);
    expect(tokensLeft.has(usedToken.id)).toBe(false);
    expect(tokensLeft.has(freshToken.id)).toBe(true);

    const notesLeft = await ids(db.notification.findMany({ where: { userId: user.id } }));
    expect(notesLeft.has(oldRead.id)).toBe(false);
    expect(notesLeft.has(recentRead.id)).toBe(true);
    expect(notesLeft.has(unread.id)).toBe(true);

    expect(await db.webhookEvent.findUnique({ where: { id: oldEvent.id } })).toBeNull();
    expect(await db.webhookEvent.findUnique({ where: { id: failedEvent.id } })).not.toBeNull();
    expect(await db.auditLog.findUnique({ where: { id: audit.id } })).not.toBeNull();

    // Idempotent: a second run has nothing of ours left to delete.
    await app.get(Cleanup).run();
    expect(await db.authToken.count({ where: { id: freshToken.id } })).toBe(1);
  });
});
