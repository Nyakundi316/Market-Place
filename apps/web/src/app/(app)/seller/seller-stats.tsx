'use client';

import { Eye, Handshake, MessageCircle, Timer } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ReviewStars } from '@/components/review-stars';
import { Skeleton } from '@/components/ui/skeleton';
import { useSellerAnalytics } from '@/hooks/use-trust';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const PERIODS = [7, 30, 90] as const;
const nf = new Intl.NumberFormat();

/** Seller analytics (§10 Phase 6): what's working, at a glance, above the listings. */
export function SellerStats() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const q = useSellerAnalytics(days);
  const a = q.data;

  return (
    <section aria-labelledby="stats" className="mt-6 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="stats" className="text-sm font-semibold">
          How you&apos;re doing
        </h2>
        <div role="group" aria-label="Period" className="flex rounded-md border p-0.5 text-xs">
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={cn(
                'rounded px-2 py-1',
                days === d
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {!a ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (
        <>
          {/* Earnings lead: it's the number sellers come here for. */}
          <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
            <div className={cn('transition-opacity', q.isFetching && 'opacity-60')}>
              <p className="text-xs text-muted-foreground">Paid out · last {a.days} days</p>
              {a.earnings.length ? (
                a.earnings.map((e) => (
                  <p key={e.currency} className="tabular text-2xl font-semibold tracking-tight">
                    {formatMoney(e.amount, e.currency)}
                  </p>
                ))
              ) : (
                <p className="tabular text-2xl font-semibold tracking-tight text-muted-foreground">
                  —
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {a.orders.completed} completed · {a.orders.inProgress} in progress
                {a.orders.refunded > 0 && ` · ${a.orders.refunded} refunded`}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Eye className="size-3.5" aria-hidden /> Views (all time)
                </dt>
                <dd className="tabular font-medium">{nf.format(a.listings.views)}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MessageCircle className="size-3.5" aria-hidden /> Chats started
                </dt>
                <dd className="tabular font-medium">{nf.format(a.listings.chats)}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Handshake className="size-3.5" aria-hidden /> Offers accepted
                </dt>
                <dd className="tabular font-medium">
                  {a.offers.accepted}/{a.offers.received}
                  {a.offers.acceptanceRate !== null && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({a.offers.acceptanceRate}%)
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Timer className="size-3.5" aria-hidden /> Replies within 24h
                </dt>
                <dd className="tabular font-medium">
                  {a.responseRate === null ? '—' : `${Math.round(a.responseRate)}%`}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <ReviewStars rating={a.rating.average} count={a.rating.count} />
            {a.topListings[0] && a.topListings[0].views > 0 && (
              <p className="truncate text-xs text-muted-foreground">
                Most viewed:{' '}
                <Link
                  href={`/l/${a.topListings[0].slug}`}
                  className="text-foreground hover:underline"
                >
                  {a.topListings[0].title}
                </Link>{' '}
                · {nf.format(a.topListings[0].views)} views
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
