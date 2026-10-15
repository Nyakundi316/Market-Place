import { Injectable } from '@nestjs/common';
import type { Currency, CursorQuery } from '@markethub/shared';
import { decodeCursor, olderThan, pageOf } from '../../common/cursor';
import { PrismaService } from '../../prisma/prisma.module';
import { toParty } from '../offers/offers.mapper';

/** The admin dispute queue, most recently opened first. */
@Injectable()
export class DisputesQuery {
  constructor(private readonly db: PrismaService) {}

  async list(q: CursorQuery) {
    const rows = await this.db.order.findMany({
      where: { status: 'disputed', ...olderThan('updatedAt', decodeCursor(q.cursor)) },
      include: {
        escrow: { select: { disputeReason: true } },
        listing: { select: { title: true, slug: true } },
        buyer: { select: { id: true, profile: true } },
        seller: { select: { id: true, profile: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const { page, nextCursor } = pageOf(rows, q.limit, (r) => r.updatedAt);
    return {
      items: page.map((o) => ({
        orderId: o.id,
        orderNumber: o.orderNumber,
        total: o.total.toFixed(2),
        currency: o.currency as Currency,
        reason: o.escrow?.disputeReason ?? null,
        openedAt: o.updatedAt.toISOString(),
        deliveredAt: o.deliveredAt?.toISOString() ?? null,
        listing: o.listing,
        buyer: toParty(o.buyer),
        seller: toParty(o.seller),
      })),
      nextCursor,
    };
  }
}
