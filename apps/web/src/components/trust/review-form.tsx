'use client';

import { Loader2, Star } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ReviewStars } from '@/components/review-stars';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCreateReview } from '@/hooks/use-trust';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const HINT = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'];

/** Radio group under the hood, so arrow keys move between stars (§6 WCAG). */
function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label="Rating" className="flex" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer p-0.5" onMouseEnter={() => setHover(n)}>
            <input
              type="radio"
              name="rating"
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="peer sr-only"
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
            />
            <Star
              className={cn(
                'size-7 transition-transform peer-focus-visible:scale-110 peer-focus-visible:drop-shadow',
                n <= shown ? 'fill-saffron text-saffron' : 'text-muted-foreground/40',
              )}
            />
          </label>
        ))}
      </div>
      <span className="text-sm text-muted-foreground" aria-live="polite">
        {HINT[shown]}
      </span>
    </div>
  );
}

/** §6 ReviewForm: on a completed order, for the buyer. */
export function ReviewForm({
  orderId,
  sellerName,
  existing,
}: {
  orderId: string;
  sellerName: string;
  existing: { rating: number; comment: string | null } | null;
}) {
  const create = useCreateReview(orderId);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  if (existing) {
    return (
      <section aria-labelledby="your-review" className="rounded-lg border p-4">
        <h2 id="your-review" className="text-sm font-semibold">
          Your review
        </h2>
        <ReviewStars rating={existing.rating} className="mt-1.5" />
        {existing.comment && <p className="mt-2 text-sm">{existing.comment}</p>}
      </section>
    );
  }

  return (
    <form
      aria-labelledby="leave-review"
      className="grid gap-3 rounded-lg border border-saffron/50 bg-saffron/5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(
          { rating, comment: comment.trim() || undefined },
          {
            onSuccess: () => toast.success('Thanks for the review'),
            onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Try again'),
          },
        );
      }}
    >
      <h2 id="leave-review" className="text-sm font-semibold">
        How did it go with {sellerName}?
      </h2>
      <StarInput value={rating} onChange={setRating} />
      <Textarea
        aria-label="Comment (optional)"
        placeholder="Was it as described? How was the handover?"
        rows={2}
        maxLength={1000}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <Button type="submit" disabled={!rating || create.isPending} className="justify-self-start">
        {create.isPending && <Loader2 className="size-4 animate-spin" />}
        Post review
      </Button>
    </form>
  );
}
