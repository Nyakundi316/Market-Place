'use client';

import type { ListingDetailDto } from '@markethub/shared';
import { ChevronRight, Eye, Handshake, MapPin, MessageCircle, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { FavoriteButton } from '@/components/listings/listing-card';
import { OwnerActions } from '@/components/listings/owner-actions';
import { ProfileAvatar } from '@/components/profile-avatar';
import { ReviewStars } from '@/components/review-stars';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { VerificationBadge } from '@/components/verification-badge';
import { useListing } from '@/hooks/use-listings';
import { ApiError } from '@/lib/api';
import { countryName } from '@/lib/countries';
import { CONDITION_LABEL, formatPrice, timeAgo, TYPE_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Gallery } from './gallery';

function PriceBlock({ l, className }: { l: ListingDetailDto; className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="tabular text-2xl font-semibold tracking-tight lg:text-3xl">
            {formatPrice(l)}
          </p>
          {l.isNegotiable && l.type !== 'request' && (
            <p className="mt-0.5 text-xs font-medium text-primary">Open to offers</p>
          )}
        </div>
        {!l.isOwner && <FavoriteButton listing={l} className="shrink-0 border shadow-none" />}
      </div>
      <h1 className="mt-3 text-lg font-medium leading-snug lg:text-xl">{l.title}</h1>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
        <MapPin className="size-3.5" aria-hidden />
        {[l.city, countryName(l.country)].filter(Boolean).join(', ')}
        <span aria-hidden>·</span>
        {timeAgo(l.publishedAt ?? l.createdAt)}
      </p>
      {l.status !== 'active' && (
        <p
          className={cn(
            'mt-3 inline-block rounded-md px-2 py-1 text-xs font-medium capitalize',
            l.status === 'sold'
              ? 'bg-foreground text-background'
              : 'bg-saffron/20 text-saffron-foreground',
          )}
        >
          {l.status === 'draft' ? 'Draft — only you can see this' : l.status}
        </p>
      )}
    </div>
  );
}

function BuyerActions({ l, className }: { l: ListingDetailDto; className?: string }) {
  if (l.status === 'sold') {
    return (
      <Button disabled className={cn('w-full', className)}>
        Sold
      </Button>
    );
  }
  const chat = `/chat/new?listing=${l.id}`;
  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      <Button asChild variant="outline" className="gap-2">
        <Link href={chat}>
          <MessageCircle className="size-4" /> Chat
        </Link>
      </Button>
      <Button asChild className="gap-2">
        <Link href={`${chat}&offer=1`}>
          <Handshake className="size-4" /> {l.type === 'request' ? 'Respond' : 'Make offer'}
        </Link>
      </Button>
    </div>
  );
}

function SellerCard({ l }: { l: ListingDetailDto }) {
  const s = l.seller;
  return (
    <Link
      href={`/u/${s.username}`}
      className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/30"
    >
      <ProfileAvatar name={s.displayName} src={s.avatarUrl} className="size-11" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{s.displayName}</span>
          <VerificationBadge
            idVerified={s.idVerified}
            businessVerified={s.businessVerified}
            compact
          />
        </span>
        <ReviewStars rating={s.ratingAvg} count={s.ratingCount} className="mt-0.5" />
      </span>
      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function ListingSkeleton() {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,1fr)] lg:gap-10">
      <Skeleton className="-mx-4 aspect-[4/3] sm:mx-0 sm:rounded-xl" />
      <div className="mt-5 space-y-3 lg:mt-0">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="mt-6 h-16 w-full" />
      </div>
    </div>
  );
}

export function ListingView({ slug, initial }: { slug: string; initial: ListingDetailDto | null }) {
  const { data: l, error, isPending } = useListing(slug, initial);

  if (!l && isPending) return <ListingSkeleton />;
  if (!l) {
    const gone = error instanceof ApiError && error.status === 404;
    return (
      <div className="max-w-md py-10">
        <h1 className="text-xl font-semibold">
          {gone ? 'This listing isn’t available' : 'Something went wrong'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {gone ? 'It may have sold, expired or been removed.' : 'Try reloading the page.'}
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/feed">Back to Discover</Link>
        </Button>
      </div>
    );
  }

  const details: [string, React.ReactNode][] = [
    ['Type', TYPE_LABEL[l.type]],
    ...(l.condition ? [['Condition', CONDITION_LABEL[l.condition]] as [string, string]] : []),
    ...(l.stock !== null ? [['In stock', l.stock] as [string, number]] : []),
    [
      'Category',
      <Link key="c" href={`/c/${l.category.slug}`} className="text-primary hover:underline">
        {l.category.parent ? `${l.category.parent.name} › ` : ''}
        {l.category.name}
      </Link>,
    ],
  ];

  return (
    <div className="pb-20 lg:pb-0">
      <div className="lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,1fr)] lg:gap-10">
        <div className="min-w-0">
          <Gallery images={l.images} title={l.title} />
          <PriceBlock l={l} className="mt-5 lg:hidden" />

          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Description
            </h2>
            {/* Stored raw, rendered as text — React escapes it (§5, §9). */}
            <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{l.description}</p>
          </section>

          <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-8 gap-y-2.5 border-t pt-6 text-sm">
            {details.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          {l.tags.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-1.5" aria-label="Tags">
              {l.tags.map((t) => (
                <li key={t}>
                  <Link
                    href={`/search?q=${encodeURIComponent(t)}`}
                    className="rounded-full bg-secondary px-2.5 py-1 text-xs hover:bg-accent"
                  >
                    #{t}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="mt-8 space-y-5 lg:sticky lg:top-8 lg:mt-0 lg:self-start">
          <PriceBlock l={l} className="hidden lg:block" />
          {l.isOwner ? (
            <div className="rounded-lg border bg-card p-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Eye className="size-3.5" aria-hidden /> {l.viewsCount} views · {l.favoritesCount}{' '}
                saves
              </p>
              <OwnerActions listing={l} layout="panel" afterDelete="/seller" />
            </div>
          ) : (
            <BuyerActions l={l} className="hidden lg:grid" />
          )}
          <SellerCard l={l} />
          {!l.isOwner && (
            <p className="flex gap-2.5 rounded-lg bg-secondary/60 p-3 text-xs leading-relaxed text-secondary-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              Pay through MarketHub escrow. The seller is paid only after you confirm delivery —
              never send money outside the app.
            </p>
          )}
        </aside>
      </div>

      {/* §6: sticky mobile CTA, sitting on top of the bottom nav. */}
      {!l.isOwner && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <BuyerActions l={l} />
        </div>
      )}
    </div>
  );
}
