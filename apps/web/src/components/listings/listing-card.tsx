'use client';

import type { ListingCardDto } from '@markethub/shared';
import { Heart, ImageOff, MapPin } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { VerificationBadge } from '@/components/verification-badge';
import { useToggleFavorite } from '@/hooks/use-listings';
import { CONDITION_LABEL, formatPrice, timeAgo, TYPE_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';

export function FavoriteButton({
  listing,
  className,
}: {
  listing: Pick<ListingCardDto, 'id' | 'isFavorited' | 'favoritesCount' | 'title'>;
  className?: string;
}) {
  const toggle = useToggleFavorite();
  const on = Boolean(listing.isFavorited);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Remove ${listing.title} from saved` : `Save ${listing.title}`}
      onClick={(e) => {
        e.preventDefault();
        toggle.mutate({ id: listing.id, on: !on, count: listing.favoritesCount });
      }}
      className={cn(
        'grid size-9 place-items-center rounded-full bg-card/90 shadow-card backdrop-blur transition-transform active:scale-90',
        className,
      )}
    >
      <Heart
        className={cn('size-[18px]', on ? 'fill-destructive text-destructive' : 'text-foreground')}
        strokeWidth={2}
      />
    </button>
  );
}

export function ListingCard({
  listing: l,
  priority = false,
  showStatus = false,
  lead = false,
}: {
  listing: ListingCardDto;
  priority?: boolean;
  /** seller views show draft/sold state instead of the heart */
  showStatus?: boolean;
  /** the 2×2 opening tile of a feed grid */
  lead?: boolean;
}) {
  const where = [l.city, l.country].filter(Boolean).join(', ');
  const price = formatPrice(l);
  const inactive = showStatus && l.status !== 'active';
  return (
    <article
      className={cn(
        'group relative flex flex-col',
        lead && 'col-span-2 duration-500 animate-in fade-in zoom-in-[0.98] sm:row-span-2',
      )}
    >
      <Link
        href={`/l/${l.slug}`}
        className={cn(
          'relative overflow-hidden rounded-md bg-muted',
          // The lead photo grows to fill both rows; the floor keeps it visible in a sparse grid.
          lead ? 'aspect-[4/3] sm:aspect-auto sm:min-h-72 sm:flex-1' : 'aspect-[4/3]',
        )}
      >
        {l.coverThumbUrl ? (
          <Image
            src={l.coverThumbUrl}
            alt=""
            fill
            unoptimized // thumbnails are already resized client-side before upload
            priority={priority}
            sizes={lead ? '(min-width: 640px) 50vw, 100vw' : '(min-width: 1024px) 25vw, 50vw'}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="grid h-full place-items-center text-muted-foreground">
            <ImageOff className="size-6" strokeWidth={1.5} aria-hidden />
          </span>
        )}
        {l.isFeatured && !inactive && (
          <span className="absolute left-2 top-2 rounded-sm bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-background">
            Featured
          </span>
        )}
        {inactive && (
          <span className="absolute inset-x-0 top-0 bg-foreground/75 px-2 py-1 text-center text-xs font-medium capitalize text-background">
            {l.status}
          </span>
        )}
        {/* Ranges run long; they drop a size rather than truncate a price. */}
        <span
          className={cn(
            'price-tag absolute bottom-2.5 left-2.5 max-w-[calc(100%-1.25rem)] transition-transform duration-200 group-hover:translate-x-0.5',
            price.length > 14 ? 'text-xs' : 'text-sm',
            lead && 'sm:bottom-4 sm:left-4 sm:text-lg',
          )}
        >
          {price}
          {l.isNegotiable && l.type !== 'request' && (
            // A half-width phone card fits "neg." after prices up to KES 99,999; past
            // that it would wrap the tag, so the listing page's stamp carries it instead.
            <span
              className={cn(
                'ml-1.5 text-[10px] font-medium uppercase tracking-wide opacity-70',
                price.length > 10 && !lead && 'max-sm:hidden',
              )}
            >
              neg.
            </span>
          )}
        </span>
      </Link>
      {!showStatus && <FavoriteButton listing={l} className="absolute right-2 top-2 z-10" />}

      <div className="mt-2.5 min-w-0 px-0.5">
        <h3
          className={cn(
            'line-clamp-2 text-sm leading-snug',
            lead && 'font-display text-xl font-medium leading-tight sm:text-2xl',
          )}
        >
          <Link href={`/l/${l.slug}`} className="after:absolute after:inset-0 after:content-['']">
            {l.type !== 'product' && (
              <span className="mr-1 font-sans text-xs font-medium text-primary">
                {TYPE_LABEL[l.type]} ·
              </span>
            )}
            {l.title}
          </Link>
        </h3>
        <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
          {where && (
            <>
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{where}</span>
              <span aria-hidden>·</span>
            </>
          )}
          {/* Server and phone each read their own clock: a minute apart is not a mismatch */}
          <time
            className="shrink-0"
            dateTime={l.publishedAt ?? l.createdAt}
            suppressHydrationWarning
          >
            {timeAgo(l.publishedAt ?? l.createdAt)}
          </time>
        </p>
        <div className="mt-1 flex items-center gap-2 text-xs">
          {l.condition && (
            <span className="text-muted-foreground">{CONDITION_LABEL[l.condition]}</span>
          )}
          <VerificationBadge
            idVerified={l.seller.idVerified}
            businessVerified={l.seller.businessVerified}
            compact={Boolean(l.condition)}
          />
        </div>
      </div>
    </article>
  );
}
