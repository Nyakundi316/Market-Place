'use client';

import type { AdminVerificationDto } from '@markethub/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { type ReasonPrompt, ReasonDialog } from '@/components/admin/reason-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminAction, useAdminList } from '@/hooks/use-trust';
import { ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/format';

const DETAIL_LABEL: Record<string, string> = {
  documentType: 'Document',
  businessName: 'Registered name',
  registrationNumber: 'Registration no.',
};

export default function AdminVerificationsPage() {
  const q = useAdminList<AdminVerificationDto>('verifications', 'status=pending');
  const act = useAdminAction();
  const [prompt, setPrompt] = useState<ReasonPrompt | null>(null);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const decide = (v: AdminVerificationDto, decision: 'approve' | 'reject', note?: string) =>
    act
      .mutateAsync({
        kind: 'verify',
        userId: v.user.userId,
        body: { requestId: v.id, decision, note },
      })
      .then(
        () => toast.success(decision === 'approve' ? 'Approved' : 'Rejected'),
        (err: unknown) => toast.error(err instanceof ApiError ? err.message : 'Failed'),
      );

  return (
    <div className="max-w-4xl">
      {q.isPending ? (
        <Skeleton className="h-48" />
      ) : !items.length ? (
        <p className="text-sm text-muted-foreground">No verifications waiting.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((v) => (
            <li key={v.id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide">
                    {v.kind === 'id' ? 'ID' : 'Business'}
                  </span>
                  <span className="font-medium">{v.user.displayName}</span>
                  <span className="text-muted-foreground"> · {v.user.email}</span>
                </p>
                <span className="text-xs text-muted-foreground">
                  submitted {timeAgo(v.createdAt)} · member since{' '}
                  {new Date(v.user.createdAt).toLocaleDateString()}
                </span>
              </div>
              <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {Object.entries(v.details).map(([k, val]) => (
                  <div key={k}>
                    <dt className="inline text-muted-foreground">{DETAIL_LABEL[k] ?? k}: </dt>
                    <dd className="inline font-medium">{String(val).replace('_', ' ')}</dd>
                  </div>
                ))}
              </dl>
              {/* Signed links expire after a few minutes; reload the page to get fresh ones. */}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {v.documents.map((url, i) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-md border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not for the image optimiser */}
                    <img
                      src={url}
                      alt={`Document ${i + 1}`}
                      className="aspect-[4/3] w-full object-cover"
                    />
                  </a>
                ))}
              </div>
              <div className="mt-3 flex gap-2 border-t pt-3">
                <Button
                  size="sm"
                  disabled={act.isPending}
                  onClick={() => void decide(v, 'approve')}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setPrompt({
                      title: 'Reject this request?',
                      description: 'The user sees your note and can try again.',
                      label: 'What needs fixing',
                      confirm: 'Reject',
                      minLength: 5,
                      destructive: true,
                      run: (note) => decide(v, 'reject', note),
                    })
                  }
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ReasonDialog prompt={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}
