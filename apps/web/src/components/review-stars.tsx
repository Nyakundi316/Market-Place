import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Read-only stars. The form variant lives with the review form (Phase 6). */
export function ReviewStars({
  rating,
  count,
  size = 'sm',
  className,
}: {
  rating: number;
  count?: number;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const px = size === 'sm' ? 'size-3.5' : 'size-4';
  if (count === 0) {
    return <span className={cn('text-xs text-muted-foreground', className)}>No reviews yet</span>;
  }
  return (
    <span
      className={cn('inline-flex items-center gap-1', className)}
      aria-label={`Rated ${rating.toFixed(1)} out of 5${count ? ` from ${count} reviews` : ''}`}
    >
      <span className="flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={cn(
              px,
              i <= Math.round(rating)
                ? 'fill-saffron text-saffron'
                : 'fill-muted text-muted-foreground/30',
            )}
          />
        ))}
      </span>
      <span className="tabular text-xs font-medium" aria-hidden>
        {rating.toFixed(1)}
        {count !== undefined && (
          <span className="font-normal text-muted-foreground"> ({count})</span>
        )}
      </span>
    </span>
  );
}
