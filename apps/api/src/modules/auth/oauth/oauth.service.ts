import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OAuthProvider } from '@markethub/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.module';
import { AuditService } from '../../audit/audit.service';
import { AuthService, type Session } from '../auth.service';
import type { SessionMeta } from '../token.service';
import {
  OAUTH_CLIENTS,
  type OAuthClient,
  type OAuthClients,
  type OAuthIdentity,
} from './oauth-clients';

const withProfile = { profile: { select: { userId: true } } } as const;

@Injectable()
export class OAuthService {
  constructor(
    @Inject(OAUTH_CLIENTS) private readonly clients: OAuthClients,
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  /** 404 rather than 400 for unconfigured providers: the route simply doesn't exist here. */
  client(provider: OAuthProvider): OAuthClient {
    const client = this.clients[provider];
    if (!client) throw new NotFoundException(`${provider} sign-in is not enabled`);
    return client;
  }

  async signIn(
    provider: OAuthProvider,
    identity: OAuthIdentity,
    meta: SessionMeta,
  ): Promise<Session> {
    let user;
    try {
      user = await this.resolveUser(provider, identity, meta);
    } catch (err) {
      // Two callbacks racing to create the same account: the loser just finds it.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      user = await this.resolveUser(provider, identity, meta);
    }

    this.auth.assertCanSignIn(user);
    await this.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.auth.startSession(user, meta);
  }

  private async resolveUser(provider: OAuthProvider, id: OAuthIdentity, meta: SessionMeta) {
    const linked = await this.db.oAuthAccount.findUnique({
      where: { provider_providerUid: { provider, providerUid: id.providerUid } },
      include: { user: { include: withProfile } },
    });
    if (linked) return linked.user;

    // Linking by email is only safe when the provider vouches for it.
    if (!id.email || !id.emailVerified) {
      throw new BadRequestException(`Your ${provider} account has no verified email address`);
    }

    const existing = await this.db.user.findUnique({ where: { email: id.email } });
    if (existing) {
      return this.db.$transaction(async (tx) => {
        await tx.oAuthAccount.create({
          data: { userId: existing.id, provider, providerUid: id.providerUid },
        });
        await this.audit.log(
          {
            actorId: existing.id,
            action: 'user.oauth_linked',
            entityType: 'user',
            entityId: existing.id,
            metadata: { provider },
            ipAddress: meta.ipAddress,
          },
          tx,
        );
        // The provider just proved inbox ownership.
        return tx.user.update({
          where: { id: existing.id },
          data: { isEmailVerified: true },
          include: withProfile,
        });
      });
    }

    return this.db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: id.email!,
          isEmailVerified: true,
          oauthAccounts: { create: { provider, providerUid: id.providerUid } },
        },
        include: withProfile,
      });
      await this.audit.log(
        {
          actorId: created.id,
          action: 'user.register',
          entityType: 'user',
          entityId: created.id,
          metadata: { provider },
          ipAddress: meta.ipAddress,
        },
        tx,
      );
      return created;
    });
  }
}
