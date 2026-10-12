import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CursorPage,
  CursorQuery,
  FollowStateDto,
  MeDto,
  PublicProfileDto,
  ReviewDto,
  UpdateProfileInput,
} from '@markethub/shared';
import { Prisma, type Profile, type User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { toAuthUser } from '../auth/auth.service';
import { UploadsService } from '../uploads/uploads.service';

export interface SocialCounts {
  followersCount: number;
  followingCount: number;
  isFollowing: boolean | null;
}

const NO_SOCIAL: SocialCounts = { followersCount: 0, followingCount: 0, isFollowing: null };

/** Include on a user query to fill SocialCounts. */
export const followCounts = { _count: { select: { followers: true, following: true } } } as const;

export function toPublicProfile(
  p: Profile,
  memberSince: Date,
  social: SocialCounts = NO_SOCIAL,
): PublicProfileDto {
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
    ...social,
  };
}

type MeRow = User & { profile: Profile | null; _count?: { followers: number; following: number } };

const toMe = (u: MeRow): MeDto => ({
  user: toAuthUser(u),
  profile:
    u.profile &&
    toPublicProfile(u.profile, u.createdAt, {
      followersCount: u._count?.followers ?? 0,
      followingCount: u._count?.following ?? 0,
      isFollowing: null,
    }),
  phone: u.phone,
});

@Injectable()
export class UsersService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
  ) {}

  async me(userId: string): Promise<MeDto> {
    return toMe(
      await this.db.user.findUniqueOrThrow({
        where: { id: userId },
        include: { profile: true, ...followCounts },
      }),
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
          include: { profile: true, ...followCounts },
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

  async setAvatar(userId: string, url: string): Promise<MeDto> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user.profile) throw new BadRequestException('Finish setting up your profile first');
    await this.uploads.assertUploaded([url], userId, 'avatar');
    return toMe(
      await this.db.user.update({
        where: { id: userId },
        data: { profile: { update: { avatarUrl: url } } },
        include: { profile: true, ...followCounts },
      }),
    );
  }

  /** Banned or deactivated accounts read as not found. */
  async publicProfile(username: string, viewerId: string | null): Promise<PublicProfileDto> {
    const profile = await this.db.profile.findUnique({
      where: { username },
      include: { user: { include: followCounts } },
    });
    if (!profile || profile.user.isBanned || !profile.user.isActive) {
      throw new NotFoundException('User not found');
    }
    const isFollowing =
      viewerId && viewerId !== profile.userId
        ? Boolean(
            await this.db.follow.findUnique({
              where: {
                followerId_followingId: { followerId: viewerId, followingId: profile.userId },
              },
            }),
          )
        : null;
    return toPublicProfile(profile, profile.user.createdAt, {
      followersCount: profile.user._count.followers,
      followingCount: profile.user._count.following,
      isFollowing,
    });
  }

  async follow(followerId: string, targetId: string, on: boolean): Promise<FollowStateDto> {
    if (followerId === targetId) throw new BadRequestException("You can't follow yourself");
    const target = await this.db.user.findUnique({ where: { id: targetId } });
    if (!target || target.isBanned || !target.isActive)
      throw new NotFoundException('User not found');

    if (on) {
      await this.db.follow.createMany({
        data: [{ followerId, followingId: targetId }],
        skipDuplicates: true,
      });
    } else {
      await this.db.follow.deleteMany({ where: { followerId, followingId: targetId } });
    }
    const followersCount = await this.db.follow.count({ where: { followingId: targetId } });
    return { following: on, followersCount };
  }

  /** Visible reviews about a user, newest first. Written in Phase 6 (reviews module). */
  async reviewsFor(userId: string, q: CursorQuery): Promise<CursorPage<ReviewDto>> {
    const rows = await this.db.review.findMany({
      where: { rateeId: userId, isVisible: true },
      include: {
        rater: { select: { profile: true } },
        order: { select: { listing: { select: { title: true, slug: true, status: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        rater: {
          username: r.rater.profile?.username ?? '',
          displayName: r.rater.profile?.displayName ?? 'MarketHub member',
          avatarUrl: r.rater.profile?.avatarUrl ?? null,
        },
        listing:
          r.order.listing.status === 'removed'
            ? null
            : { title: r.order.listing.title, slug: r.order.listing.slug },
      })),
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
    };
  }
}
