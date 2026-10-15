'use client';

import { REPORT_REASON_LABEL, type ReportDto } from '@markethub/shared';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { type ReasonPrompt, ReasonDialog } from '@/components/admin/reason-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminAction, useAdminList } from '@/hooks/use-trust';
import { ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUSES = ['open', 'resolved', 'dismissed'] as const;

export default function AdminReportsPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('open');
  const q = useAdminList<ReportDto>('reports', `status=${status}`);
  const act = useAdminAction();
  const [prompt, setPrompt] = useState<ReasonPrompt | null>(null);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const run = (label: string, action: Parameters<typeof act.mutateAsync>[0]) =>
    act.mutateAsync(action).then(
      () => toast.success(label),
      (err: unknown) => {
        toast.error(err instanceof ApiError ? err.message : 'Failed');
        throw err;
      },
    );

  const ask = (p: Omit<ReasonPrompt, 'minLength'> & { minLength?: number }) =>
    setPrompt({ minLength: 3, ...p });

  return (
    <div className="max-w-3xl">
      <div className="flex gap-1 text-sm">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={cn(
              'rounded-full px-3 py-1 capitalize',
              status === s
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {q.isPending ? (
        <Skeleton className="mt-4 h-32" />
      ) : !items.length ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {status === 'open' ? 'Nothing reported. 🎉' : `No ${status} reports.`}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((r) => (
            <li key={r.id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {r.entityType}
                  </span>
                  {r.target.link ? (
                    <Link
                      href={r.target.link}
                      target="_blank"
                      className="font-medium hover:underline"
                    >
                      {r.target.label} <ExternalLink className="inline size-3" aria-hidden />
                    </Link>
                  ) : (
                    <span className="font-medium">{r.target.label}</span>
                  )}
                </p>
                <span className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
              </div>
              <p className="mt-2 text-sm">
                <span className="font-medium text-destructive">
                  {REPORT_REASON_LABEL[r.reason]}
                </span>
                <span className="text-muted-foreground"> · by {r.reporter.displayName}</span>
                {r.duplicates > 0 && (
                  <span className="ml-2 rounded-full bg-destructive/10 px-2 text-xs text-destructive">
                    +{r.duplicates} more
                  </span>
                )}
              </p>
              {r.details && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  “{r.details}”
                </p>
              )}

              {r.status === 'open' && (
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                  {r.entityType === 'listing' && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        ask({
                          title: 'Remove this listing?',
                          description: 'The seller is told why. The report is closed as resolved.',
                          label: 'Reason (sent to the seller)',
                          confirm: 'Remove listing',
                          destructive: true,
                          run: async (reason) => {
                            await run('Listing removed', {
                              kind: 'remove-listing',
                              id: r.entityId,
                              reason,
                            });
                            await run('Report resolved', {
                              kind: 'resolve-report',
                              id: r.id,
                              body: { action: 'resolve', note: reason },
                            });
                          },
                        })
                      }
                    >
                      Remove listing
                    </Button>
                  )}
                  {r.entityType === 'review' && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        ask({
                          title: 'Hide this review?',
                          label: 'Reason (audit log)',
                          confirm: 'Hide review',
                          destructive: true,
                          run: async (reason) => {
                            await run('Review hidden', {
                              kind: 'hide-review',
                              id: r.entityId,
                              reason,
                            });
                            await run('Report resolved', {
                              kind: 'resolve-report',
                              id: r.id,
                              body: { action: 'resolve', note: reason },
                            });
                          },
                        })
                      }
                    >
                      Hide review
                    </Button>
                  )}
                  {r.target.ownerId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        ask({
                          title: 'Warn the owner',
                          description: 'They get this as a notification.',
                          label: 'Message',
                          confirm: 'Send warning',
                          minLength: 10,
                          run: async (message) => {
                            await run('Warning sent', {
                              kind: 'warn',
                              id: r.target.ownerId!,
                              message,
                            });
                            await run('Report resolved', {
                              kind: 'resolve-report',
                              id: r.id,
                              body: { action: 'resolve', note: message },
                            });
                          },
                        })
                      }
                    >
                      Warn owner
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={act.isPending}
                    onClick={() =>
                      void run('Dismissed', {
                        kind: 'resolve-report',
                        id: r.id,
                        body: { action: 'dismiss' },
                      }).catch(() => undefined)
                    }
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void q.fetchNextPage()}>
          Load more
        </Button>
      )}
      <ReasonDialog prompt={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}
