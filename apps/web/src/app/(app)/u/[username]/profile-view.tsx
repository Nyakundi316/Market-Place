'use client';

import type { CursorPage, FollowStateDto, PublicProfileDto, ReviewDto } from '@markethub/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, MapPin, Settings } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ListingGrid } from '@/components/listings/listing-grid';
import { ProfileAvatar } from '@/components/profile-avatar';
import { ReviewStars } from '@/components/review-stars';
import { Button } from '@/components/ui/button';
import { VerificationBadge } from '@/components/verification-badge';
import { useListingSearch } from '@/hooks/use-listings';
import { api, ApiError } from '@/lib/api';
import { countryName } from '@/lib/countries';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';

function FollowButton({ profile }: { profile: PublicProfileDto }) {
  const qc = useQueryClient();
  const router = useRouter();
  const key = ['profile', profile.username];
  const follow = useMutation({
    mutationFn: (on: boolean) =>
      api<FollowStateDto>(`/users/${profile.userId}/follow`, { method: on ? 'POST' : 'DELETE' }),
    // §6: optimistic, rolled back on failure.
    onMutate: (on) => {
      const prev = qc.getQueryData<PublicProfileDto>(key);
      if (prev) {
        qc.setQueryData<PublicProfileDto>(key, {
          ...prev,
          isFollowing: on,
          followersCount: prev.followersCount + (on ? 1 : -1),
        });
      }
      return { prev };
    },
    onSuccess: (s) =>
      qc.setQueryData<PublicProfileDto>(key, (p) =>
        p ? { ...p, isFollowing: s.following, followersCount: s.followersCount } : p,
      ),
    onError: (err, _, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(err instanceof ApiError ? err.message : 'Try again');
    },
  });

  const on = Boolean(profile.isFollowing);
  return (
    <Button
      variant={on ? 'outline' : 'default'}
      size="sm"
      className="min-w-24"
      aria-pressed={on}
      onClick={() => {
        if (useAuth.getState().status !== 'authenticated') {
          router.push(`/login?next=/u/${profile.username}`);
          return;
        }
        follow.mutate(!on);
      }}
    >
      {on ? 'Following' : 'Follow'}
    </Button>
  );
}

function Reviews({ userId }: { userId: string }) {
  const q = useInfiniteQuery({
    queryKey: ['reviews', userId],
    queryFn: ({ pageParam }) =>
      api<CursorPage<ReviewDto>>(
        `/users/${userId}/reviews${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading reviews…</p>;
  if (!items.length) {
    return (
      <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
        No reviews yet. Reviews appear after completed, escrow-protected deals.
      </p>
    );
  }
  return (
    <ul className="divide-y">
      {items.map((r) => (
        <li key={r.id} className="py-4">
          <div className="flex items-center gap-2.5">
            <ProfileAvatar name={r.rater.displayName} src={r.rater.avatarUrl} className="size-7" />
            <span className="text-sm font-medium">{r.rater.displayName}</span>
            <span className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
          </div>
          <ReviewStars rating={r.rating} className="mt-2" />
          {r.comment && <p className="mt-1.5 text-sm leading-relaxed">{r.comment}</p>}
          {r.listing && (
            <Link
              href={`/l/${r.listing.slug}`}
              className="mt-1 block text-xs text-muted-foreground hover:underline"
            >
              for {r.listing.title}
            </Link>
          )}
        </li>
      ))}
      {q.hasNextPage && (
        <li className="pt-4">
          <Button variant="outline" size="sm" onClick={() => void q.fetchNextPage()}>
            More reviews
          </Button>
        </li>
      )}
    </ul>
  );
}

export function ProfileView({ initial }: { initial: PublicProfileDto }) {
  const status = useAuth((s) => s.status);
  const me = useAuth((s) => s.user);
  const { data: p = initial } = useQuery({
    queryKey: ['profile', initial.username],
    queryFn: () => api<PublicProfileDto>(`/users/${initial.username}`),
    // The server copy is anonymous and cached, so it can't say who you follow — always refetch.
    placeholderData: initial,
    enabled: status !== 'unknown',
  });
  const [tab, setTab] = useState<'listings' | 'reviews'>('listings');
  const listings = useListingSearch({ sellerId: p.userId, limit: 24 });
  const isMe = me?.id === p.userId;

  const stats = [
    [p.listingsCount, 'listings'],
    [p.completedDeals, 'deals'],
    [p.followersCount, p.followersCount === 1 ? 'follower' : 'followers'],
  ] as const;

  return (
    <div className="animate-rise-in">
      <header className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 sm:grid-cols-[auto_1fr_auto] sm:items-start">
        <ProfileAvatar
          name={p.displayName}
          src={p.avatarUrl}
          className="size-16 text-lg sm:size-20"
        />
        <div className="min-w-0 self-center">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
            {p.displayName}
          </h1>
          <p className="text-sm text-muted-foreground">@{p.username}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <VerificationBadge idVerified={p.idVerified} businessVerified={p.businessVerified} />
            <ReviewStars rating={p.ratingAvg} count={p.ratingCount} />
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1">
          {isMe ? (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/settings">
                <Settings className="size-4" /> Edit profile
              </Link>
            </Button>
          ) : (
            <FollowButton profile={p} />
          )}
        </div>
      </header>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="space-y-3 lg:order-2">
          {p.bio && <p className="whitespace-pre-line text-sm leading-relaxed">{p.bio}</p>}
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {(p.city || p.country) && (
              <li className="flex items-center gap-2">
                <MapPin className="size-4" aria-hidden />
                {[p.city, countryName(p.country)].filter(Boolean).join(', ')}
              </li>
            )}
            {p.website && (
              <li className="flex items-center gap-2">
                <Globe className="size-4" aria-hidden />
                <a
                  href={p.website}
                  rel="noopener nofollow ugc"
                  target="_blank"
                  className="truncate hover:underline"
                >
                  {p.website.replace(/^https?:\/\//, '')}
                </a>
              </li>
            )}
            <li>
              {[p.profession, p.company].filter(Boolean).join(' at ')}
              {(p.profession || p.company) && ' · '}
              Member since{' '}
              {new Date(p.memberSince).toLocaleDateString(undefined, {
                month: 'short',
                year: 'numeric',
              })}
            </li>
          </ul>
          <dl className="flex gap-5 border-t pt-3">
            {stats.map(([n, label]) => (
              <div key={label}>
                <dt className="sr-only">{label}</dt>
                <dd className="text-sm">
                  <span className="tabular font-semibold">{n}</span>{' '}
                  <span className="text-muted-foreground">{label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="min-w-0 lg:order-1">
          <div role="tablist" className="mb-5 flex gap-6 border-b">
            {(['listings', 'reviews'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  '-mb-px border-b-2 pb-2.5 text-sm capitalize',
                  tab === t
                    ? 'border-primary font-medium'
                    : 'border-transparent text-muted-foreground',
                )}
              >
                {t}
                {t === 'reviews' && p.ratingCount > 0 && ` (${p.ratingCount})`}
              </button>
            ))}
          </div>
          {tab === 'listings' ? (
            <ListingGrid
              query={listings}
              empty={<p className="text-sm text-muted-foreground">No live listings right now.</p>}
            />
          ) : (
            <Reviews userId={p.userId} />
          )}
        </div>
      </div>
    </div>
  );
}
