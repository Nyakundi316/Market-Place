import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { durationToSeconds, type Env, type UserRole } from '@markethub/shared';
import { InjectEnv } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.module';

export interface AccessPayload {
  sub: string;
  role: UserRole;
}

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

const ISSUER = 'markethub-api';
const AUDIENCE = 'markethub';
const REUSE_GRACE_MS = 15_000;

@Injectable()
export class TokenService {
  readonly accessTtl: number;
  readonly refreshTtl: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly db: PrismaService,
    @InjectEnv() private readonly env: Env,
  ) {
    this.accessTtl = durationToSeconds(env.JWT_ACCESS_TTL);
    this.refreshTtl = durationToSeconds(env.JWT_REFRESH_TTL);
  }

  signAccess(payload: AccessPayload): string {
    return this.jwt.sign(payload, {
      secret: this.env.JWT_ACCESS_SECRET,
      expiresIn: this.accessTtl,
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  }

  verifyAccess(token: string): AccessPayload {
    try {
      const { sub, role } = this.jwt.verify<AccessPayload>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      return { sub, role };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /** Keyed hash: a leaked refresh_tokens table alone can't be used to mint or check tokens. */
  private hash(token: string) {
    return createHmac('sha256', this.env.JWT_REFRESH_SECRET).update(token).digest('base64url');
  }

  async issueRefresh(userId: string, meta: SessionMeta = {}, familyId: string = randomUUID()) {
    const token = randomBytes(32).toString('base64url');
    await this.db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + this.refreshTtl * 1000),
        userAgent: meta.userAgent?.slice(0, 300),
        ipAddress: meta.ipAddress,
      },
    });
    return token;
  }

  /**
   * Single-use rotation (§9). Presenting a token that was already used or
   * revoked means it leaked: the whole family (every descendant) is revoked —
   * except within the reuse grace window, see `inGrace`.
   */
  async rotate(token: string, meta: SessionMeta = {}) {
    const row = await this.db.refreshToken.findUnique({ where: { tokenHash: this.hash(token) } });
    if (!row) throw new UnauthorizedException('Invalid session');

    let usedAt = row.usedAt;
    if (!row.revokedAt && !usedAt) {
      if (row.expiresAt <= new Date()) throw new UnauthorizedException('Session expired');
      // Conditional update: of concurrent refreshes exactly one consumes the token.
      const { count } = await this.db.refreshToken.updateMany({
        where: { id: row.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 1) {
        return {
          userId: row.userId,
          refreshToken: await this.issueRefresh(row.userId, meta, row.familyId),
        };
      }
      usedAt = (await this.db.refreshToken.findUnique({ where: { id: row.id } }))?.usedAt ?? null;
    }

    if (!row.revokedAt && usedAt && (await this.inGrace(row.familyId, usedAt))) {
      return {
        userId: row.userId,
        refreshToken: await this.issueRefresh(row.userId, meta, row.familyId),
      };
    }
    await this.revokeFamily(row.familyId);
    throw new UnauthorizedException('Session revoked');
  }

  /**
   * A refresh whose response never reached the browser (navigation, closed tab,
   * flaky network) still rotated the token, so the client retries with the spent
   * one. Tolerate that briefly — but only while nothing later in the chain has
   * been redeemed; once the successor is used, a replay is theft.
   */
  private async inGrace(familyId: string, usedAt: Date) {
    if (Date.now() - usedAt.getTime() > REUSE_GRACE_MS) return false;
    const movedOn = await this.db.refreshToken.count({
      where: { familyId, OR: [{ revokedAt: { not: null } }, { usedAt: { gt: usedAt } }] },
    });
    return movedOn === 0;
  }

  /** Logout: kills this device's session chain. Unknown tokens are a no-op. */
  async revoke(token: string) {
    const row = await this.db.refreshToken.findUnique({ where: { tokenHash: this.hash(token) } });
    if (row) await this.revokeFamily(row.familyId);
  }

  revokeFamily(familyId: string) {
    return this.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Password reset / ban: every device signs out. */
  revokeAllForUser(userId: string) {
    return this.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
