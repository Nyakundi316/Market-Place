import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { Env } from '@markethub/shared';
import type { AuthTokenType } from '@prisma/client';
import { InjectEnv } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { hashPassword } from './password';
import { TokenService } from './token.service';

const TTL_MS: Record<AuthTokenType, number> = {
  email_verify: 24 * 3600_000,
  password_reset: 3600_000,
};

const BAD_LINK = 'This link is invalid or has expired';
const sha256 = (t: string) => createHash('sha256').update(t).digest('base64url');

/** Email-verify and password-reset links. Tokens are single-use; only hashes are stored. */
@Injectable()
export class AccountLinksService {
  constructor(
    private readonly db: PrismaService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    @InjectEnv() private readonly env: Env,
  ) {}

  private async issue(userId: string, type: AuthTokenType) {
    const token = randomBytes(32).toString('base64url');
    await this.db.$transaction([
      // A new link supersedes older ones of the same kind.
      this.db.authToken.updateMany({
        where: { userId, type, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.db.authToken.create({
        data: {
          userId,
          type,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + TTL_MS[type]),
        },
      }),
    ]);
    return token;
  }

  /** Atomically marks the token used; a second click or a race gets BAD_LINK. */
  private async consume(token: string, type: AuthTokenType) {
    const tokenHash = sha256(token);
    const { count } = await this.db.authToken.updateMany({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (count !== 1) throw new BadRequestException(BAD_LINK);
    const { userId } = await this.db.authToken.findUniqueOrThrow({ where: { tokenHash } });
    return userId;
  }

  async sendVerification(user: { id: string; email: string }) {
    const link = `${this.env.WEB_URL}/verify-email?token=${await this.issue(user.id, 'email_verify')}`;
    this.mail.sendInBackground({
      to: user.email,
      subject: 'Confirm your MarketHub email',
      text: `Confirm your email to start buying and selling on MarketHub:\n\n${link}\n\nThis link expires in 24 hours.`,
      html: `<p>Confirm your email to start buying and selling on MarketHub.</p><p><a href="${link}">Confirm email</a></p><p>This link expires in 24 hours.</p>`,
    });
  }

  async verifyEmail(token: string) {
    const userId = await this.consume(token, 'email_verify');
    await this.db.user.update({ where: { id: userId }, data: { isEmailVerified: true } });
    await this.audit.log({
      actorId: userId,
      action: 'user.email_verified',
      entityType: 'user',
      entityId: userId,
    });
  }

  /** Same response whether or not the account exists; mail goes out in the background. */
  async requestPasswordReset(email: string) {
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.isBanned || !user.isActive) return;

    const link = `${this.env.WEB_URL}/reset-password?token=${await this.issue(user.id, 'password_reset')}`;
    this.mail.sendInBackground({
      to: user.email,
      subject: 'Reset your MarketHub password',
      text: `Someone asked to reset your MarketHub password. If it was you:\n\n${link}\n\nThis link expires in 1 hour. If it wasn't you, ignore this email.`,
      html: `<p>Someone asked to reset your MarketHub password. If it was you:</p><p><a href="${link}">Choose a new password</a></p><p>This link expires in 1 hour. If it wasn't you, ignore this email.</p>`,
    });
  }

  async resetPassword(token: string, password: string, ipAddress?: string) {
    const userId = await this.consume(token, 'password_reset');
    await this.db.user.update({
      where: { id: userId },
      // Clicking the emailed link also proves the inbox is theirs.
      data: { passwordHash: await hashPassword(password), isEmailVerified: true },
    });
    await this.tokens.revokeAllForUser(userId); // every device signs out
    await this.audit.log({
      actorId: userId,
      action: 'user.password_reset',
      entityType: 'user',
      entityId: userId,
      ipAddress,
    });
  }
}
