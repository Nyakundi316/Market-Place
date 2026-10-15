import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateReviewInput, CursorPage, MyReviewDto, MyReviewsQuery } from '@markethub/shared';
import { Prisma } from '@prisma/client';
import { decodeCursor, olderThan, pageOf } from '../../common/cursor';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { toParty } from '../offers/offers.mapper';

/** Reviews can only follow a real, finished deal (§0 trust: no fake data). */
const REVIEWABLE = new Set(['completed']);

@Injectable()
export class ReviewsService {
  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The buyer rates the seller once per completed order; the trigger updates the profile. */
  async create(user: RequestUser, input: CreateReviewInput): Promise<MyReviewDto> {
    const order = await this.db.order.findFirst({
      where: { id: input.orderId, OR: [{ buyerId: user.id }, { sellerId: user.id }] },
      include: { listing: { select: { title: true, slug: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== user.id) throw new ForbiddenException('Only the buyer reviews an order');
    if (!REVIEWABLE.has(order.status)) {
      throw new ConflictException('You can review once the order is complete');
    }

    let review;
    try {
      review = await this.db.review.create({
        data: {
          orderId: order.id,
          raterId: user.id,
          rateeId: order.sellerId,
          rating: input.rating,
          comment: input.comment ?? null,
        },
        include: { ratee: { select: { id: true, profile: true } } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('You already reviewed this order');
      }
      throw err;
    }

    const rater = await this.db.profile.findUnique({ where: { userId: user.id } });
    await this.notifications.notify(order.sellerId, {
      type: 'review.received',
      title: `${rater?.displayName ?? 'A buyer'} left you ${input.rating} star${input.rating === 1 ? '' : 's'}`,
      body: input.comment ?? null,
      link: review.ratee.profile ? `/u/${review.ratee.profile.username}?tab=reviews` : null,
      payload: { reviewId: review.id, orderId: order.id },
    });

    return {
      id: review.id,
      orderId: order.id,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt.toISOString(),
      counterpart: toParty(review.ratee),
      listing: { title: order.listing.title, slug: order.listing.slug },
    };
  }

  async mine(userId: string, q: MyReviewsQuery): Promise<CursorPage<MyReviewDto>> {
    const given = q.role === 'given';
    const rows = await this.db.review.findMany({
      where: {
        ...(given ? { raterId: userId } : { rateeId: userId, isVisible: true }),
        ...olderThan('createdAt', decodeCursor(q.cursor)),
      },
      include: {
        rater: { select: { id: true, profile: true } },
        ratee: { select: { id: true, profile: true } },
        order: { select: { listing: { select: { title: true, slug: true, status: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const { page, nextCursor } = pageOf(rows, q.limit, (r) => r.createdAt);
    return {
      items: page.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        counterpart: toParty(given ? r.ratee : r.rater),
        listing:
          r.order.listing.status === 'removed'
            ? null
            : { title: r.order.listing.title, slug: r.order.listing.slug },
      })),
      nextCursor,
    };
  }
}
