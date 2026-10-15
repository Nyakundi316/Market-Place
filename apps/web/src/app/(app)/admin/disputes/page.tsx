'use client';

import type { Currency, DealPartyDto } from '@markethub/shared';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAdminAction, useAdminList } from '@/hooks/use-trust';
import { ApiError } from '@/lib/api';
import { formatMoney, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

interface DisputeRow {
  orderId: string;
  orderNumber: string;
  total: string;
  currency: Currency;
  reason: string | null;
  openedAt: string;
  deliveredAt: string | null;
  listing: { title: string; slug: string };
  buyer: DealPartyDto;
  seller: DealPartyDto;
}

const OUTCOMES = [
  { value: 'release', label: 'Release to seller', hint: 'The buyer’s claim doesn’t hold up' },
  {
    value: 'refund',
    label: 'Refund buyer in full',
    hint: 'Item never arrived or not as described',
  },
  { value: 'split', label: 'Split', hint: 'Part back to the buyer, the rest to the seller' },
] as const;

function ResolveDialog({ dispute, onClose }: { dispute: DisputeRow | null; onClose: () => void }) {
  const act = useAdminAction();
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]['value']>('release');
  const [refund, setRefund] = useState('');
  const [note, setNote] = useState('');
  const close = () => {
    setOutcome('release');
    setRefund('');
    setNote('');
    onClose();
  };
  const ok =
    note.trim().length >= 3 &&
    (outcome !== 'split' ||
      (/^\d+(\.\d{1,2})?$/.test(refund) &&
        Number(refund) > 0 &&
        Number(refund) < Number(dispute?.total)));

  return (
    <Dialog open={!!dispute} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        {dispute && (
          <>
            <DialogHeader>
              <DialogTitle>Resolve {dispute.orderNumber}</DialogTitle>
              <DialogDescription>
                {formatMoney(dispute.total, dispute.currency)} held in escrow. Both sides are told
                the outcome and your note.
              </DialogDescription>
            </DialogHeader>
            <fieldset className="grid gap-1.5">
              <legend className="sr-only">Outcome</legend>
              {OUTCOMES.map((o) => (
                <label
                  key={o.value}
                  className={cn(
                    'cursor-pointer rounded-md border px-3 py-2 text-sm has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring',
                    outcome === o.value ? 'border-primary bg-primary/5' : 'hover:bg-accent/50',
                  )}
                >
                  <input
                    type="radio"
                    name="outcome"
                    className="sr-only"
                    checked={outcome === o.value}
                    onChange={() => setOutcome(o.value)}
                  />
                  <span className="block font-medium">{o.label}</span>
                  <span className="text-xs text-muted-foreground">{o.hint}</span>
                </label>
              ))}
            </fieldset>
            {outcome === 'split' && (
              <div className="grid gap-1.5">
                <Label htmlFor="refund-amount">Refund to buyer ({dispute.currency})</Label>
                <Input
                  id="refund-amount"
                  inputMode="decimal"
                  value={refund}
                  onChange={(e) => setRefund(e.target.value)}
                  className="tabular"
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="dispute-note">Decision note</Label>
              <Textarea
                id="dispute-note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                disabled={!ok || act.isPending}
                onClick={() =>
                  act.mutate(
                    {
                      kind: 'resolve-dispute',
                      orderId: dispute.orderId,
                      body: {
                        outcome,
                        note: note.trim(),
                        ...(outcome === 'split' && { refundAmount: Number(refund).toFixed(2) }),
                      },
                    },
                    {
                      onSuccess: () => {
                        toast.success('Dispute resolved');
                        close();
                      },
                      onError: (err) =>
                        toast.error(err instanceof ApiError ? err.message : 'Failed'),
                    },
                  )
                }
              >
                {act.isPending && <Loader2 className="size-4 animate-spin" />}
                Resolve
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AdminDisputesPage() {
  const q = useAdminList<DisputeRow>('disputes');
  const [open, setOpen] = useState<DisputeRow | null>(null);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="max-w-3xl">
      {q.isPending ? (
        <Skeleton className="h-32" />
      ) : !items.length ? (
        <p className="text-sm text-muted-foreground">No open disputes.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((d) => (
            <li
              key={d.orderId}
              className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {d.orderNumber} ·{' '}
                  <Link href={`/l/${d.listing.slug}`} target="_blank" className="hover:underline">
                    {d.listing.title}
                  </Link>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {d.buyer.displayName} (buyer) vs {d.seller.displayName} (seller) · opened{' '}
                  {timeAgo(d.openedAt)}
                </p>
                {d.reason && <p className="mt-2 whitespace-pre-wrap text-sm">“{d.reason}”</p>}
              </div>
              <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                <span className="tabular font-semibold">{formatMoney(d.total, d.currency)}</span>
                <Button size="sm" onClick={() => setOpen(d)}>
                  Resolve
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ResolveDialog dispute={open} onClose={() => setOpen(null)} />
    </div>
  );
}
