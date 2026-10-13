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
}: {
  listing: ListingCardDto;
  priority?: boolean;
  /** seller views show draft/sold state instead of the heart */
  showStatus?: boolean;
}) {
  const where = [l.city, l.country].filter(Boolean).join(', ');
  return (
    <article className="group relative flex flex-col">
      <Link
        href={`/l/${l.slug}`}
        className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted"
      >
        {l.coverThumbUrl ? (
          <Image
            src={l.coverThumbUrl}
            alt=""
            fill
            unoptimized // thumbnails are already resized client-side before upload
            priority={priority}
            sizes="(min-width: 1024px) 25vw, 50vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="grid h-full place-items-center text-muted-foreground">
            <ImageOff className="size-6" strokeWidth={1.5} aria-hidden />
          </span>
        )}
        {l.isFeatured && (
          <span className="absolute left-2 top-2 rounded bg-saffron px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-saffron-foreground">
            Featured
          </span>
        )}
        {showStatus && l.status !== 'active' && (
          <span className="absolute inset-x-0 bottom-0 bg-foreground/75 px-2 py-1 text-center text-xs font-medium capitalize text-background">
            {l.status}
          </span>
        )}
      </Link>
      {!showStatus && <FavoriteButton listing={l} className="absolute right-2 top-2 z-10" />}

      <div className="mt-2 min-w-0 px-0.5">
        <p className="tabular text-[15px] font-semibold leading-tight">
          {formatPrice(l)}
          {l.isNegotiable && l.type !== 'request' && (
            <span className="ml-1.5 align-middle text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              neg.
            </span>
          )}
        </p>
        <h3 className="mt-0.5 line-clamp-2 text-sm leading-snug">
          <Link href={`/l/${l.slug}`} className="after:absolute after:inset-0 after:content-['']">
            {l.type !== 'product' && (
              <span className="mr-1 text-xs font-medium text-primary">{TYPE_LABEL[l.type]} ·</span>
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
          <span className="shrink-0">{timeAgo(l.publishedAt ?? l.createdAt)}</span>
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
