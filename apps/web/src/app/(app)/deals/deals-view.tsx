'use client';

import type { OfferListItemDto, OrderAction, OrderListItemDto } from '@markethub/shared';
import { ImageOff } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId } from 'react';
import { StatusPill } from '@/components/deals/status-pill';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyOffers, useOrders } from '@/hooks/use-deals';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { formatMoney, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

const NEXT_STEP: Partial<Record<OrderAction, string>> = {
  ship: 'Ready to ship',
  deliver: 'Mark delivered',
  'confirm-delivery': 'Confirm you got it',
};

function Thumb({ src, className }: { src: string | null; className?: string }) {
  return (
    <span className={cn('relative block shrink-0 overflow-hidden rounded-md bg-muted', className)}>
      {src ? (
        <Image src={src} alt="" fill unoptimized sizes="64px" className="object-cover" />
      ) : (
        <ImageOff className="absolute inset-0 m-auto size-4 text-muted-foreground" aria-hidden />
      )}
    </span>
  );
}

function OrderRow({ o }: { o: OrderListItemDto }) {
  const other = o.side === 'buyer' ? o.seller : o.buyer;
  const todo = o.actions.map((a) => NEXT_STEP[a]).find(Boolean);
  const unpaid = o.status === 'awaiting_payment' && o.side === 'buyer';
  return (
    <li>
      <Link
        href={`/orders/${o.id}`}
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-3.5 transition-colors hover:bg-accent/40 sm:-mx-3 sm:rounded-lg sm:px-3"
      >
        <Thumb src={o.listing.coverThumbUrl} className="size-14" />
        <span className="min-w-0">
          <span className="line-clamp-1 text-sm font-medium">{o.listing.title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {o.orderNumber} · {o.side === 'buyer' ? 'from' : 'to'} {other.displayName} ·{' '}
            {timeAgo(o.createdAt)}
          </span>
          {(todo || unpaid) && (
            <span className="mt-1 block text-xs font-medium text-primary">
              {unpaid ? 'Payment due' : todo}
            </span>
          )}
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="tabular text-sm font-semibold">{formatMoney(o.total, o.currency)}</span>
          <StatusPill status={o.status} kind="order" />
        </span>
      </Link>
    </li>
  );
}

function OfferRow({ o }: { o: OfferListItemDto }) {
  return (
    <li>
      <Link
        href={`/chat/${o.conversationId}`}
        className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent/60"
      >
        <ProfileAvatar
          name={o.counterpart.displayName}
          src={o.counterpart.avatarUrl}
          className="size-9"
        />
        <span className="min-w-0 flex-1">
          <span className="tabular block text-sm font-semibold">
            {formatMoney(o.totalPrice, o.currency)}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{o.listing.title}</span>
        </span>
        {o.expiresAt && (
          <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(o.expiresAt)}</span>
        )}
      </Link>
    </li>
  );
}

/** Pending offers, split by whose move it is. Sits beside the orders on desktop. */
function OpenOffers({ ready }: { ready: boolean }) {
  const received = useMyOffers('received');
  const sent = useMyOffers('sent');
  const theirs = received.data?.items ?? [];
  const mine = sent.data?.items ?? [];
  const loading = !ready || received.isPending || sent.isPending;
  const heading = useId();

  return (
    <section aria-labelledby={heading} className="lg:sticky lg:top-8">
      <h2 id={heading} className="text-sm font-semibold">
        Open offers
      </h2>
      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : !theirs.length && !mine.length ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No offers in play. Make one from any listing that&apos;s open to offers.
        </p>
      ) : (
        <>
          {theirs.length > 0 && (
            <>
              <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-primary">
                Waiting on you · {theirs.length}
              </p>
              <ul className="-mx-2 mt-1">
                {theirs.map((o) => (
                  <OfferRow key={o.id} o={o} />
                ))}
              </ul>
            </>
          )}
          {mine.length > 0 && (
            <>
              <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Waiting on them · {mine.length}
              </p>
              <ul className="-mx-2 mt-1">
                {mine.map((o) => (
                  <OfferRow key={o.id} o={o} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

export function DealsView() {
  const ready = useRequireAuth();
  const router = useRouter();
  const pathname = usePathname();
  const tab = useSearchParams().get('tab') === 'selling' ? 'selling' : 'buying';
  const orders = useOrders(tab);
  const items = orders.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="animate-rise-in lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-12">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Deals</h1>

        <div role="tablist" aria-label="Orders" className="mt-5 flex gap-6 border-b">
          {(['buying', 'selling'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => router.replace(t === 'buying' ? pathname : `${pathname}?tab=${t}`)}
              className={cn(
                '-mb-px border-b-2 pb-2.5 text-sm capitalize transition-colors',
                tab === t
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-xl border bg-card/60 p-4 lg:hidden">
          <OpenOffers ready={ready} />
        </div>

        <div role="tabpanel" className="mt-2">
          {!ready || orders.isPending ? (
            <ul className="divide-y">
              {Array.from({ length: 3 }, (_, i) => (
                <li key={i} className="flex gap-3 py-3.5">
                  <Skeleton className="size-14" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </li>
              ))}
            </ul>
          ) : items.length ? (
            <ul className="divide-y">
              {items.map((o) => (
                <OrderRow key={o.id} o={o} />
              ))}
            </ul>
          ) : (
            <div className="mt-6 max-w-sm">
              <p className="font-medium">
                {tab === 'buying' ? 'Nothing bought yet' : 'No sales yet'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {tab === 'buying'
                  ? 'When a seller accepts your offer, check out from the chat and the order lands here.'
                  : 'Orders show up here once a buyer checks out on an offer you accepted.'}
              </p>
              <Button asChild variant="link" className="mt-1 h-auto px-0">
                <Link href={tab === 'buying' ? '/feed' : '/seller'}>
                  {tab === 'buying' ? 'Browse listings' : 'Your listings'}
                </Link>
              </Button>
            </div>
          )}
          {orders.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              disabled={orders.isFetchingNextPage}
              onClick={() => void orders.fetchNextPage()}
            >
              Load more
            </Button>
          )}
        </div>
      </div>

      <aside className="hidden pt-1 lg:block">
        <OpenOffers ready={ready} />
      </aside>
    </div>
  );
}
