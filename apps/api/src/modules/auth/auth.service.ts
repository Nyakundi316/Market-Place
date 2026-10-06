import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUserDto, LoginInput, RegisterInput } from '@markethub/shared';
import { Prisma, type User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { AccountLinksService } from './account-links.service';
import { hashPassword, needsRehash, verifyPassword } from './password';
import { type SessionMeta, TokenService } from './token.service';

const INVALID = 'Invalid email or password';

export interface Session {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  user: AuthUserDto;
}

@Injectable()
export class AuthService {
  // Verified against when the email is unknown, so both paths cost one argon2 run.
  private readonly dummyHash = hashPassword('timing-equaliser-not-a-real-password');

  constructor(
    private readonly db: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly links: AccountLinksService,
  ) {}

  async register(input: RegisterInput, meta: SessionMeta): Promise<Session> {
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email: input.email, passwordHash, role: input.role },
          include: { profile: { select: { userId: true } } },
        });
        await this.audit.log(
          {
            actorId: created.id,
            action: 'user.register',
            entityType: 'user',
            entityId: created.id,
            ipAddress: meta.ipAddress,
          },
          tx,
        );
        return created;
      });
      await this.links.sendVerification(user);
      return this.startSession(user, meta);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account with this email already exists');
      }
      throw err;
    }
  }

  async login(input: LoginInput, meta: SessionMeta): Promise<Session> {
    const user = await this.db.user.findUnique({
      where: { email: input.email },
      include: { profile: { select: { userId: true } } },
    });

    const ok = await verifyPassword(user?.passwordHash ?? (await this.dummyHash), input.password);
    if (!user || !user.passwordHash || !ok) throw new UnauthorizedException(INVALID);

    // Status is only revealed to someone who knows the password.
    this.assertCanSignIn(user);

    await this.db.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        ...(needsRehash(user.passwordHash) && { passwordHash: await hashPassword(input.password) }),
      },
    });
    return this.startSession(user, meta);
  }

  async refresh(refreshToken: string, meta: SessionMeta): Promise<Session> {
    const { userId, refreshToken: next } = await this.tokens.rotate(refreshToken, meta);
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: { select: { userId: true } } },
    });
    if (user.isBanned || !user.isActive) {
      await this.tokens.revokeAllForUser(user.id);
      throw new UnauthorizedException('Session revoked');
    }
    return this.buildSession(user, next);
  }

  logout(refreshToken: string | undefined) {
    return refreshToken ? this.tokens.revoke(refreshToken) : Promise.resolve();
  }

  assertCanSignIn(user: Pick<User, 'isBanned' | 'isActive'>) {
    if (user.isBanned) throw new ForbiddenException('This account has been suspended');
    if (!user.isActive) throw new ForbiddenException('This account is deactivated');
  }

  async startSession(user: UserWithProfileFlag, meta: SessionMeta): Promise<Session> {
    return this.buildSession(user, await this.tokens.issueRefresh(user.id, meta));
  }

  private buildSession(user: UserWithProfileFlag, refreshToken: string): Session {
    return {
      accessToken: this.tokens.signAccess({ sub: user.id, role: user.role }),
      accessTokenExpiresIn: this.tokens.accessTtl,
      refreshToken,
      user: toAuthUser(user),
    };
  }
}

type UserWithProfileFlag = User & { profile: { userId: string } | null };

export const toAuthUser = (u: UserWithProfileFlag): AuthUserDto => ({
  id: u.id,
  email: u.email,
  role: u.role,
  isEmailVerified: u.isEmailVerified,
  isPhoneVerified: u.isPhoneVerified,
  hasProfile: u.profile !== null,
});
