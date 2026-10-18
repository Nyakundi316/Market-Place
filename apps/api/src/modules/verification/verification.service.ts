import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  AdminVerificationDto,
  CreateVerificationInput,
  CursorPage,
  ReviewVerificationInput,
  VerificationQuery,
  VerificationRequestSummary,
  VerificationStatusDto,
} from '@markethub/shared';
import { Prisma, type VerificationRequest } from '@prisma/client';
import type Redis from 'ioredis';
import { decodeCursor, olderThan, pageOf } from '../../common/cursor';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.module';
import { InjectRedis } from '../../redis/redis.module';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { toParty } from '../offers/offers.mapper';
import { UploadsService } from '../uploads/uploads.service';
import { SmsError, SmsSender } from './sms.sender';

const CODE_TTL_S = 10 * 60;
const MAX_ATTEMPTS = 5;
const SENDS_PER_WINDOW = 3;
const SEND_WINDOW_S = 15 * 60;

const otpKey = (userId: string) => `phone:otp:${userId}`;
const sendsKey = (userId: string) => `phone:sends:${userId}`;
const hash = (userId: string, code: string) =>
  createHash('sha256').update(`${userId}:${code}`).digest();

const summary = (r: VerificationRequest | undefined): VerificationRequestSummary | null =>
  r ? { id: r.id, status: r.status, note: r.note, createdAt: r.createdAt.toISOString() } : null;

/**
 * §10 Phase 6 verification. Email is Phase 1; phone is a 6-digit code (hash
 * in Redis, 5 tries, 3 sends per 15 min); ID and business are document
 * checks an admin approves (§4 POST /admin/verify/:userId), with documents
 * in the private bucket and only ever shown through short-lived links.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly db: PrismaService,
    private readonly uploads: UploadsService,
    private readonly sms: SmsSender,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async status(userId: string): Promise<VerificationStatusDto> {
    const [user, profile, requests] = await Promise.all([
      this.db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { phone: true, isPhoneVerified: true },
      }),
      this.db.profile.findUnique({
        where: { userId },
        select: { idVerified: true, businessVerified: true },
      }),
      this.db.verificationRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      phone: { number: user.phone, verified: user.isPhoneVerified, available: this.sms.available },
      id: {
        verified: profile?.idVerified ?? false,
        request: summary(requests.find((r) => r.kind === 'id')),
      },
      business: {
        verified: profile?.businessVerified ?? false,
        request: summary(requests.find((r) => r.kind === 'business')),
      },
    };
  }

  // ─── Phone ──────────────────────────────────────────────────────────────

  async sendPhoneCode(user: RequestUser, phone: string) {
    if (!this.sms.available)
      throw new ServiceUnavailableException('Phone verification isn’t available yet');
    const taken = await this.db.user.findFirst({
      where: { phone, isPhoneVerified: true, id: { not: user.id } },
      select: { id: true },
    });
    if (taken)
      throw new ConflictException({
        message: 'That number is verified on another account',
        fields: { phone: ['Already in use'] },
      });

    const [[, sends], , [, ttl]] = (await this.redis
      .multi()
      .incr(sendsKey(user.id))
      .expire(sendsKey(user.id), SEND_WINDOW_S, 'NX')
      .ttl(sendsKey(user.id))
      .exec()) as [[null, number], unknown, [null, number]];
    if (sends > SENDS_PER_WINDOW) {
      throw new HttpException(
        {
          message: 'Too many codes — try again in a few minutes',
          retryAfterMs: Math.max(ttl, 0) * 1000,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.redis.set(
      otpKey(user.id),
      JSON.stringify({ phone, hash: hash(user.id, code).toString('hex'), attempts: 0 }),
      'EX',
      CODE_TTL_S,
    );
    try {
      await this.sms.send(phone, `Your MarketHub code is ${code}. It expires in 10 minutes.`);
    } catch (e) {
      // A code nobody received mustn't be guessable for the next 10 minutes. The send
      // still counts toward the cap, so a failing number can't be hammered.
      await this.redis.del(otpKey(user.id));
      if (e instanceof SmsError && e.badNumber)
        throw new BadRequestException({
          message: 'We can’t send texts to that number',
          fields: { phone: ['Can’t receive SMS'] },
        });
      throw new ServiceUnavailableException('We couldn’t send the code — try again shortly');
    }
    return { sent: true, expiresIn: CODE_TTL_S };
  }

  async verifyPhone(user: RequestUser, code: string) {
    const raw = await this.redis.get(otpKey(user.id));
    if (!raw)
      throw new BadRequestException({
        message: 'That code has expired — send a new one',
        fields: { code: ['Expired'] },
      });
    const pending = JSON.parse(raw) as { phone: string; hash: string; attempts: number };
    if (pending.attempts >= MAX_ATTEMPTS) {
      await this.redis.del(otpKey(user.id));
      throw new BadRequestException({
        message: 'Too many tries — send a new code',
        fields: { code: ['Locked'] },
      });
    }
    const ok = timingSafeEqual(hash(user.id, code), Buffer.from(pending.hash, 'hex'));
    if (!ok) {
      const ttl = await this.redis.ttl(otpKey(user.id));
      await this.redis.set(
        otpKey(user.id),
        JSON.stringify({ ...pending, attempts: pending.attempts + 1 }),
        'EX',
        Math.max(ttl, 1),
      );
      throw new BadRequestException({
        message: 'That code isn’t right',
        fields: { code: ['Incorrect'] },
      });
    }
    await this.redis.del(otpKey(user.id));
    await this.db.user.update({
      where: { id: user.id },
      data: { phone: pending.phone, isPhoneVerified: true },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'user.phone_verified',
      entityType: 'user',
      entityId: user.id,
      metadata: { phone: `…${pending.phone.slice(-4)}` },
    });
    return this.status(user.id);
  }

  // ─── ID / business ──────────────────────────────────────────────────────

  async request(user: RequestUser, input: CreateVerificationInput) {
    const profile = await this.db.profile.findUnique({ where: { userId: user.id } });
    if (!profile) throw new ForbiddenException('Finish setting up your profile first');
    if (!user.isEmailVerified) throw new ForbiddenException('Confirm your email first');
    if (input.kind === 'id' ? profile.idVerified : profile.businessVerified) {
      throw new ConflictException('You’re already verified');
    }
    const documents = await this.uploads.assertPrivateUploaded(input.documents, user.id);
    try {
      const created = await this.db.verificationRequest.create({
        data: { userId: user.id, kind: input.kind, documents, details: input.details },
      });
      await this.audit.log({
        actorId: user.id,
        action: 'verification.request',
        entityType: 'verification',
        entityId: created.id,
        metadata: { kind: input.kind },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A request is already being reviewed');
      }
      throw err;
    }
    return this.status(user.id);
  }

  // ─── Admin ──────────────────────────────────────────────────────────────

  async queue(q: VerificationQuery): Promise<CursorPage<AdminVerificationDto>> {
    const rows = await this.db.verificationRequest.findMany({
      where: { status: q.status, ...olderThan('createdAt', decodeCursor(q.cursor)) },
      include: { user: { select: { id: true, email: true, createdAt: true, profile: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const { page, nextCursor } = pageOf(rows, q.limit, (r) => r.createdAt);
    return {
      items: await Promise.all(
        page.map(async (r) => ({
          id: r.id,
          kind: r.kind,
          status: r.status,
          details: r.details as Record<string, string>,
          // Rejected/approved documents are kept for the record but not re-shown.
          documents:
            r.status === 'pending'
              ? await Promise.all((r.documents as string[]).map((k) => this.uploads.signedRead(k)))
              : [],
          user: {
            ...toParty(r.user),
            email: r.user.email,
            createdAt: r.user.createdAt.toISOString(),
          },
          createdAt: r.createdAt.toISOString(),
          note: r.note,
        })),
      ),
      nextCursor,
    };
  }

  /** §4 POST /admin/verify/:userId */
  async decide(admin: RequestUser, userId: string, input: ReviewVerificationInput) {
    const request = await this.db.verificationRequest.findFirst({
      where: { id: input.requestId, userId },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'pending') throw new ConflictException(`Already ${request.status}`);
    const approve = input.decision === 'approve';

    await this.db.$transaction(async (tx) => {
      // Conditional update: two admins deciding at once can't both win.
      const { count } = await tx.verificationRequest.updateMany({
        where: { id: request.id, status: 'pending' },
        data: {
          status: approve ? 'approved' : 'rejected',
          note: input.note ?? null,
          reviewedBy: admin.id,
          reviewedAt: new Date(),
        },
      });
      if (!count) throw new ConflictException('Someone else just decided this one');
      if (approve) {
        await tx.profile.update({
          where: { userId },
          data: request.kind === 'id' ? { idVerified: true } : { businessVerified: true },
        });
      }
      await this.audit.log(
        {
          actorId: admin.id,
          action: approve ? 'verification.approve' : 'verification.reject',
          entityType: 'user',
          entityId: userId,
          metadata: { requestId: request.id, kind: request.kind, note: input.note ?? null },
        },
        tx,
      );
    });

    const label = request.kind === 'id' ? 'ID' : 'business';
    await this.notifications.notify(userId, {
      type: approve ? 'verification.approved' : 'verification.rejected',
      title: approve ? `Your ${label} is verified` : `We couldn’t verify your ${label}`,
      body: approve ? 'The badge now shows on your profile and listings.' : (input.note ?? null),
      link: '/settings#verification',
      payload: { requestId: request.id },
    });
    return { ok: true };
  }
}
