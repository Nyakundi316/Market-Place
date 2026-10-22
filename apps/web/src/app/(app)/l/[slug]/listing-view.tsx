'use client';

import type { ListingDetailDto } from '@markethub/shared';
import { ChevronRight, Eye, Handshake, MapPin, MessageCircle, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { FavoriteButton } from '@/components/listings/listing-card';
import { OwnerActions } from '@/components/listings/owner-actions';
import { ReportButton } from '@/components/trust/report-dialog';
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

function InfoBlock({ l, className }: { l: ListingDetailDto; className?: string }) {
  return (
    <div className={className}>
      <Link
        href={`/c/${l.category.slug}`}
        className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
      >
        {l.category.parent ? `${l.category.parent.name} · ` : ''}
        {l.category.name}
      </Link>
      <div className="mt-2 flex items-start justify-between gap-4">
        <h1 className="text-balance font-display text-[1.75rem] font-medium leading-[1.1] tracking-tight lg:text-[2.125rem]">
          {l.title}
        </h1>
        {!l.isOwner && <FavoriteButton listing={l} className="mt-1 shrink-0 border shadow-none" />}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
        <MapPin className="size-3.5" aria-hidden />
        {[l.city, countryName(l.country)].filter(Boolean).join(', ')}
        <span aria-hidden>·</span>
        <time dateTime={l.publishedAt ?? l.createdAt} suppressHydrationWarning>
          {timeAgo(l.publishedAt ?? l.createdAt)}
        </time>
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="tabular font-display text-[2rem] font-semibold leading-none tracking-tight lg:text-[2.5rem]">
          {formatPrice(l)}
        </p>
        {l.isNegotiable && l.type !== 'request' && (
          <span className="-rotate-2 rounded-sm border-[1.5px] border-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
            Open to offers
          </span>
        )}
      </div>
      {l.status !== 'active' && (
        <p
          className={cn(
            'mt-4 inline-block rounded-md px-2 py-1 text-xs font-medium capitalize',
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
      <Skeleton className="-mx-4 -mt-5 aspect-[4/3] sm:mx-0 sm:mt-0 sm:rounded-xl" />
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
        <h1 className="font-display text-2xl font-medium">
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
          <InfoBlock l={l} className="mt-5 lg:hidden" />

          <section aria-labelledby="about-heading" className="mt-10">
            <h2 id="about-heading" className="font-display text-xl font-medium">
              Description
            </h2>
            {/* Stored raw, rendered as text — React escapes it (§5, §9). */}
            <p className="mt-3 max-w-prose whitespace-pre-line text-[15px] leading-relaxed">
              {l.description}
            </p>
          </section>

          {/* A printed price list: dotted leaders carry the eye from label to value. */}
          <section aria-labelledby="details-heading" className="mt-10 max-w-md">
            <h2 id="details-heading" className="font-display text-xl font-medium">
              Details
            </h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              {details.map(([k, v]) => (
                <div key={k} className="flex items-baseline">
                  <dt className="flex flex-1 items-baseline gap-2 text-muted-foreground after:min-w-6 after:flex-1 after:border-b after:border-dotted after:border-foreground/30 after:content-['']">
                    {k}
                  </dt>
                  <dd className="pl-2 text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

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

        {/* top-24 clears the sticky top bar (4rem) with room to breathe. */}
        <aside className="mt-8 space-y-5 lg:sticky lg:top-24 lg:mt-0 lg:self-start">
          <InfoBlock l={l} className="hidden lg:block" />
          {l.isOwner ? (
            <div className="rounded-lg border bg-card p-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Eye className="size-3.5" aria-hidden /> {l.viewsCount} view
                {l.viewsCount === 1 ? '' : 's'} · {l.favoritesCount} save
                {l.favoritesCount === 1 ? '' : 's'}
              </p>
              <OwnerActions listing={l} layout="panel" afterDelete="/seller" />
            </div>
          ) : (
            <BuyerActions l={l} className="hidden lg:grid" />
          )}
          <SellerCard l={l} />
          {!l.isOwner && (
            <div className="ticket rounded-md bg-secondary text-secondary-foreground">
              <span className="grid place-items-center text-primary">
                <ShieldCheck className="size-5" aria-hidden />
              </span>
              <p className="border-l-[1.5px] border-dashed border-foreground/20 py-3 pl-3.5 pr-4 text-xs leading-relaxed">
                <span className="font-semibold">Pay through MarketHub escrow.</span> The seller is
                paid only after you confirm delivery — never send money outside the app.
              </p>
            </div>
          )}
          {!l.isOwner && <ReportButton entityType="listing" entityId={l.id} />}
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
