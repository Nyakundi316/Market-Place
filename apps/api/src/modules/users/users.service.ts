import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MeDto, PublicProfileDto, UpdateProfileInput } from '@markethub/shared';
import { Prisma, type Profile, type User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { toAuthUser } from '../auth/auth.service';

export function toPublicProfile(p: Profile, memberSince: Date): PublicProfileDto {
  return {
    userId: p.userId,
    username: p.username,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    coverUrl: p.coverUrl,
    bio: p.bio,
    profession: p.profession,
    company: p.company,
    website: p.website,
    country: p.country,
    city: p.city,
    socials: (p.socials ?? {}) as Record<string, string>,
    idVerified: p.idVerified,
    businessVerified: p.businessVerified,
    ratingAvg: p.ratingAvg.toNumber(),
    ratingCount: p.ratingCount,
    listingsCount: p.listingsCount,
    completedDeals: p.completedDeals,
    responseRate: p.responseRate.toNumber(),
    memberSince: memberSince.toISOString(),
  };
}

const toMe = (u: User & { profile: Profile | null }): MeDto => ({
  user: toAuthUser(u),
  profile: u.profile && toPublicProfile(u.profile, u.createdAt),
  phone: u.phone,
});

@Injectable()
export class UsersService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async me(userId: string): Promise<MeDto> {
    return toMe(
      await this.db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } }),
    );
  }

  /** First call creates the profile (onboarding), later calls patch it. */
  async updateMe(userId: string, input: UpdateProfileInput, ipAddress?: string): Promise<MeDto> {
    const { phone, role, website, socials, ...profileFields } = input;
    const current = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true },
    });

    const profileData = {
      ...profileFields,
      ...(website !== undefined && { website: website || null }),
      ...(socials !== undefined && { socials }),
    };

    const touchesProfile = Object.keys(profileData).length > 0;
    if (!current.profile && touchesProfile && (!profileData.displayName || !profileData.username)) {
      throw new BadRequestException({
        message: 'Choose a display name and username to finish setting up your profile',
        fields: {
          ...(!profileData.displayName && { displayName: ['Required'] }),
          ...(!profileData.username && { username: ['Required'] }),
        },
      });
    }

    try {
      const updated = await this.db.$transaction(async (tx) => {
        if (role && role !== current.role) {
          await this.audit.log(
            {
              actorId: userId,
              action: 'user.role_changed',
              entityType: 'user',
              entityId: userId,
              metadata: { from: current.role, to: role },
              ipAddress,
            },
            tx,
          );
        }
        return tx.user.update({
          where: { id: userId },
          data: {
            ...(role && { role }),
            // A new number has to be verified again (Phase 6).
            ...(phone !== undefined &&
              phone !== current.phone && { phone, isPhoneVerified: false }),
            ...(touchesProfile && {
              profile: current.profile
                ? { update: profileData }
                : {
                    create: {
                      ...profileData,
                      displayName: profileData.displayName!,
                      username: profileData.username!,
                    },
                  },
            }),
          },
          include: { profile: true },
        });
      });
      return toMe(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          message: 'That username is taken',
          fields: { username: ['Taken'] },
        });
      }
      throw err;
    }
  }

  /** Banned or deactivated accounts read as not found. */
  async publicProfile(username: string): Promise<PublicProfileDto> {
    const profile = await this.db.profile.findUnique({
      where: { username },
      include: { user: true },
    });
    if (!profile || profile.user.isBanned || !profile.user.isActive) {
      throw new NotFoundException('User not found');
    }
    return toPublicProfile(profile, profile.user.createdAt);
  }
}
