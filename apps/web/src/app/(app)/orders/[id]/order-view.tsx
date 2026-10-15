'use client';

import {
  fromCents,
  type OrderAction,
  type OrderDto,
  type OrderStatus,
  toCents,
} from '@markethub/shared';
import { ArrowLeft, Check, Loader2, Lock, MessageCircle, Package, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ORDER_STATUS_LABEL, StatusPill } from '@/components/deals/status-pill';
import { ProfileAvatar } from '@/components/profile-avatar';
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
import { PaymentDialog } from '@/components/deals/payment-dialog';
import { useEscrowAction, useOrder, useOrderAction } from '@/hooks/use-deals';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { ApiError } from '@/lib/api';
import { countryName } from '@/lib/countries';
import { formatMoney, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

const stamp = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const when = (iso: string | null) => (iso ? stamp.format(new Date(iso)) : null);

const RANK: Record<OrderStatus, number> = {
  awaiting_payment: 0,
  paid: 1,
  in_escrow: 1,
  shipped: 2,
  delivered: 3,
  disputed: 3,
  completed: 4,
  refunded: 1,
  cancelled: 0,
};

/** §6 OrderTimeline. Off-path endings (cancelled, disputed, refunded) cap the line. */
function OrderTimeline({ o }: { o: OrderDto }) {
  const steps: { label: string; at: string | null; note?: string | null }[] = [
    { label: 'Order placed', at: o.createdAt },
    { label: 'Paid into escrow', at: o.paidAt },
    {
      label: o.listing.type === 'product' ? 'Shipped' : 'Started',
      at: null,
      note: o.trackingNumber,
    },
    { label: 'Delivered', at: o.deliveredAt },
    { label: 'Completed', at: o.completedAt },
  ];
  const reached = RANK[o.status];
  const ending =
    o.status === 'cancelled' || o.status === 'refunded' || o.status === 'disputed'
      ? { label: ORDER_STATUS_LABEL[o.status], at: o.status === 'cancelled' ? o.cancelledAt : null }
      : null;
  const shown: typeof steps = ending ? [...steps.slice(0, reached + 1), ending] : steps;

  return (
    <ol className="relative ml-1.5">
      {shown.map((s, i) => {
        const done = ending ? true : i <= reached;
        const current = ending ? i === shown.length - 1 : i === reached;
        const isEnd = ending && i === shown.length - 1;
        return (
          <li key={s.label} className="relative pb-5 pl-7 last:pb-0">
            {i < shown.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'absolute left-[5px] top-3 h-full w-0.5',
                  i < reached || ending ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
            <span
              aria-hidden
              className={cn(
                'absolute left-0 top-1 grid size-3 place-items-center rounded-full ring-4 ring-background',
                isEnd
                  ? 'bg-destructive'
                  : done
                    ? 'bg-primary'
                    : 'border-2 border-border bg-background',
                current && !isEnd && 'ring-primary/20',
              )}
            />
            <p className={cn('text-sm', done ? 'font-medium' : 'text-muted-foreground')}>
              {s.label}
              {current && <span className="sr-only"> (current)</span>}
            </p>
            {(when(s.at) || s.note) && (
              <p className="text-xs text-muted-foreground">
                {[when(s.at), s.note && `Tracking ${s.note}`].filter(Boolean).join(' · ')}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

type DialogAction = Exclude<OrderAction, 'pay'>;
type StatusAction = Exclude<DialogAction, 'dispute' | 'refund'>;
const isDialogAction = (a: OrderAction): a is DialogAction => a in CONFIRM;

const CONFIRM: Record<
  DialogAction,
  {
    button: string;
    title: string;
    body: string;
    done: string;
    field?: 'tracking' | 'reason';
    /** Minimum length when the field is required. */
    required?: number;
  }
> = {
  ship: {
    button: 'Mark as shipped',
    title: 'Mark as shipped',
    body: 'Add a tracking number if the courier gave you one — the buyer gets it right away.',
    done: 'Marked as shipped',
    field: 'tracking',
  },
  deliver: {
    button: 'Mark as delivered',
    title: 'Mark as delivered?',
    body: 'The buyer is asked to confirm. Payment is released once they do.',
    done: 'Marked as delivered',
  },
  'confirm-delivery': {
    button: 'I received it',
    title: 'Confirm you received it?',
    body: 'Only confirm once you have the item and it matches the listing. This completes the order and releases payment to the seller.',
    done: 'Order complete — thanks!',
  },
  cancel: {
    button: 'Cancel order',
    title: 'Cancel this order?',
    body: 'Nothing has been paid yet, so there is nothing to refund. The item goes back on sale.',
    done: 'Order cancelled',
    field: 'reason',
  },
  dispute: {
    button: 'Open a dispute',
    title: 'Something wrong with this order?',
    body: 'Payment stays frozen while our team looks at it. Describe what happened — photos and messages in the chat help.',
    done: 'Dispute opened — we’ll be in touch',
    field: 'reason',
    required: 10,
  },
  refund: {
    button: 'Cancel and refund',
    title: 'Cancel and refund the buyer?',
    body: 'The buyer gets the full amount back and the item goes back on sale.',
    done: 'Refunded',
    field: 'reason',
  },
};

function ActionDialog({
  order,
  action,
  onClose,
}: {
  order: OrderDto;
  action: DialogAction | null;
  onClose: () => void;
}) {
  const run = useOrderAction(order.id);
  const escrow = useEscrowAction(order.id);
  const pending = run.isPending || escrow.isPending;
  const [text, setText] = useState('');
  const copy = action ? CONFIRM[action] : null;

  const submit = () => {
    if (!action) return;
    const value = text.trim() || undefined;
    const body =
      copy?.field === 'tracking'
        ? { trackingNumber: value }
        : copy?.field === 'reason'
          ? { reason: value }
          : {};
    const handlers = {
      onSuccess: () => {
        toast.success(copy!.done);
        setText('');
        onClose();
      },
      onError: (err: unknown) => toast.error(err instanceof ApiError ? err.message : 'Try again'),
    };
    if (action === 'dispute' || action === 'refund') escrow.mutate({ action, body }, handlers);
    else run.mutate({ action: action as StatusAction, body }, handlers);
  };
  const tooShort = !!copy?.required && text.trim().length < copy.required;

  return (
    <Dialog open={!!action} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {copy && (
          <>
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.body}</DialogDescription>
            </DialogHeader>
            {copy.field && (
              <div className="grid gap-1.5">
                <Label htmlFor="order-action-field">
                  {copy.field === 'tracking'
                    ? 'Tracking number'
                    : action === 'dispute'
                      ? 'What went wrong?'
                      : 'Reason'}{' '}
                  {!copy.required && (
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  )}
                </Label>
                {copy.field === 'tracking' ? (
                  <Input
                    id="order-action-field"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={100}
                    autoComplete="off"
                  />
                ) : (
                  <Textarea
                    id="order-action-field"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={action === 'dispute' ? 4 : 2}
                    maxLength={action === 'dispute' ? 1000 : 500}
                  />
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Back
              </Button>
              <Button
                variant={action === 'cancel' || action === 'refund' ? 'destructive' : 'default'}
                disabled={pending || tooShort}
                onClick={submit}
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                {copy.button}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Money({ o }: { o: OrderDto }) {
  const net = fromCents(toCents(o.subtotal) - toCents(o.platformFee));
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">
        {o.quantity} × {formatMoney(o.unitPrice, o.currency)}
      </dt>
      <dd className="tabular text-right">{formatMoney(o.subtotal, o.currency)}</dd>
      {o.side === 'seller' ? (
        <>
          <dt className="text-muted-foreground">MarketHub fee</dt>
          <dd className="tabular text-right text-muted-foreground">
            −{formatMoney(o.platformFee, o.currency)}
          </dd>
          <dt className="border-t pt-2 font-medium">You receive</dt>
          <dd className="tabular border-t pt-2 text-right text-lg font-semibold">
            {formatMoney(net, o.currency)}
          </dd>
        </>
      ) : (
        <>
          <dt className="border-t pt-2 font-medium">Total</dt>
          <dd className="tabular border-t pt-2 text-right text-lg font-semibold">
            {formatMoney(o.total, o.currency)}
          </dd>
        </>
      )}
    </dl>
  );
}

const METHOD: Record<string, string> = {
  pickup: 'Pick up from the seller',
  courier: 'Delivery',
  in_person: 'In person',
  digital: 'Online',
};

/** What's happening to the money right now, in one line for whoever is looking. */
function EscrowNote({ o }: { o: OrderDto }) {
  const e = o.escrow;
  let note: React.ReactNode = null;
  if (o.status === 'disputed') {
    note = 'Dispute open — the payment is frozen while our team reviews it. We’ll update you here.';
  } else if (o.status === 'refunded') {
    note = `Refunded to the buyer${o.cancelledAt ? ` on ${when(o.cancelledAt)}` : ''}.`;
  } else if (e?.autoReleaseAt) {
    note =
      o.side === 'buyer'
        ? `Got it? Confirm below. If there’s a problem, open a dispute before ${when(e.autoReleaseAt)} — after that the payment is released automatically.`
        : `Payment is released to you on ${when(e.autoReleaseAt)}, or sooner if the buyer confirms.`;
  } else if (e?.awaitingPayoutDetails && o.side === 'seller') {
    note = (
      <>
        Your money is ready.{' '}
        <Link
          href="/settings#payouts"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Add payout details
        </Link>{' '}
        and it’s sent right away.
      </>
    );
  } else if (e?.status === 'partially_refunded') {
    note = 'Settled: part refunded to the buyer, the rest released to the seller.';
  } else if (e?.status === 'released' && o.side === 'seller') {
    note = 'Paid out to your payout account.';
  }
  if (!note) return null;
  return (
    <p
      className={cn(
        'rounded-lg p-3 text-sm',
        o.status === 'disputed' ? 'bg-destructive/10' : 'bg-muted/60 text-muted-foreground',
      )}
    >
      {note}
    </p>
  );
}

export function OrderView({ id }: { id: string }) {
  const ready = useRequireAuth();
  const [action, setAction] = useState<DialogAction | null>(null);
  const [paying, setPaying] = useState(false);
  // Back from a gateway (?paid=1) or just paid here: the webhook decides, we watch.
  const returned = useSearchParams().get('paid') === '1';
  const [confirmingSince, setConfirmingSince] = useState<number | null>(() =>
    returned ? Date.now() : null,
  );
  const q = useOrder(id, { poll: confirmingSince !== null });
  const stillUnpaid = q.data?.status === 'awaiting_payment';
  const confirming = confirmingSince !== null && stillUnpaid;
  const slow = confirming && Date.now() - confirmingSince > 60_000;
  useEffect(() => {
    if (confirmingSince !== null && q.data && !stillUnpaid) {
      setConfirmingSince(null);
      toast.success('Payment received — it’s held in escrow');
    }
  }, [confirmingSince, q.data, stillUnpaid]);

  if (q.isError) {
    return (
      <div className="max-w-sm">
        <p className="font-medium">
          {q.error instanceof ApiError && q.error.status === 404
            ? 'Order not found'
            : 'Couldn’t load this order'}
        </p>
        <Link href="/deals" className="mt-2 inline-block text-sm text-primary hover:underline">
          Back to deals
        </Link>
      </div>
    );
  }
  if (!ready || !q.data) {
    return (
      <div className="max-w-3xl space-y-4" aria-busy>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-20" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const o = q.data;
  const other = o.side === 'buyer' ? o.seller : o.buyer;
  const dialogActions = o.actions.filter(isDialogAction);
  const primary = dialogActions.find((a) => a !== 'cancel' && a !== 'dispute' && a !== 'refund');
  const secondary = dialogActions.filter((a) => a !== primary);
  const canPay = o.actions.includes('pay');
  const addr = o.deliveryAddress;

  return (
    <div className="max-w-4xl animate-rise-in">
      <Link
        href={`/deals${o.side === 'seller' ? '?tab=selling' : ''}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Deals
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="tabular text-2xl font-semibold tracking-tight">{o.orderNumber}</h1>
        <StatusPill status={o.status} kind="order" className="text-xs" />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {o.side === 'buyer' ? 'Bought' : 'Sold'} {timeAgo(o.createdAt)}
      </p>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
        <div className="space-y-6">
          <Link
            href={`/l/${o.listing.slug}`}
            className="flex items-center gap-3 rounded-lg border bg-card p-3 hover:border-foreground/30"
          >
            <span className="relative size-14 shrink-0 overflow-hidden rounded-md bg-muted">
              {o.listing.coverThumbUrl ? (
                <Image
                  src={o.listing.coverThumbUrl}
                  alt=""
                  fill
                  unoptimized
                  sizes="56px"
                  className="object-cover"
                />
              ) : (
                <Package
                  className="absolute inset-0 m-auto size-5 text-muted-foreground"
                  aria-hidden
                />
              )}
            </span>
            <span className="min-w-0">
              <span className="line-clamp-2 text-sm font-medium">{o.listing.title}</span>
              <span className="tabular text-xs text-muted-foreground">Qty {o.quantity}</span>
            </span>
          </Link>

          {o.status === 'awaiting_payment' && (
            <div
              className={cn(
                'rounded-lg p-4 text-sm',
                o.side === 'buyer' ? 'bg-saffron/15' : 'bg-muted/60',
              )}
            >
              {o.side === 'buyer' ? (
                confirming ? (
                  <p className="flex items-center gap-2 font-medium" role="status">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    {slow
                      ? 'Still waiting for the payment provider — we’ll notify you when it lands.'
                      : 'Confirming your payment…'}
                  </p>
                ) : (
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        Pay {formatMoney(o.total, o.currency)} to confirm this order
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Held for you until {when(o.paymentDueAt)}, then cancelled automatically.
                      </p>
                    </div>
                    {canPay && (
                      <Button onClick={() => setPaying(true)} className="gap-1.5">
                        <Lock className="size-4" /> Pay now
                      </Button>
                    )}
                  </div>
                )
              ) : (
                <p>
                  Waiting for {other.displayName} to pay. Don&apos;t hand anything over until the
                  order shows <strong>Paid · in escrow</strong>.
                </p>
              )}
            </div>
          )}

          <EscrowNote o={o} />

          <section aria-labelledby="progress">
            <h2 id="progress" className="mb-3 text-sm font-semibold">
              Progress
            </h2>
            <OrderTimeline o={o} />
          </section>

          {(primary || secondary.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {primary && (
                <Button onClick={() => setAction(primary)} className="gap-1.5">
                  <Check className="size-4" /> {CONFIRM[primary].button}
                </Button>
              )}
              {secondary.map((a) => (
                <Button
                  key={a}
                  variant={a === 'dispute' ? 'ghost' : 'outline'}
                  onClick={() => setAction(a)}
                  className={cn(a === 'dispute' && 'text-muted-foreground')}
                >
                  {CONFIRM[a].button}
                </Button>
              ))}
            </div>
          )}

          <section aria-labelledby="delivery" className="border-t pt-5 text-sm">
            <h2 id="delivery" className="mb-2 font-semibold">
              Delivery
            </h2>
            <p>{o.deliveryMethod ? METHOD[o.deliveryMethod] : '—'}</p>
            {addr && (
              <address className="mt-1 not-italic text-muted-foreground">
                {addr.recipient}
                {addr.phone && ` · ${addr.phone}`}
                <br />
                {[addr.line1, addr.line2].filter(Boolean).join(', ')}
                <br />
                {[addr.city, addr.region, addr.postalCode, countryName(addr.country)]
                  .filter(Boolean)
                  .join(', ')}
              </address>
            )}
            {o.notes && (
              <p className="mt-3 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-muted-foreground">
                {o.notes}
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-xl border bg-card p-4">
            <Money o={o} />
          </div>

          <div className="flex items-center gap-3">
            <ProfileAvatar name={other.displayName} src={other.avatarUrl} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">
                {o.side === 'buyer' ? 'Seller' : 'Buyer'}
              </span>
              {other.username ? (
                <Link
                  href={`/u/${other.username}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {other.displayName}
                </Link>
              ) : (
                <span className="block truncate text-sm font-medium">{other.displayName}</span>
              )}
            </span>
            {o.conversationId && (
              <Button asChild variant="outline" size="icon" aria-label="Open chat">
                <Link href={`/chat/${o.conversationId}`}>
                  <MessageCircle className="size-4" />
                </Link>
              </Button>
            )}
          </div>

          <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-px size-4 shrink-0 text-primary" aria-hidden />
            Payment stays in escrow until the buyer confirms delivery. Keep all messages on
            MarketHub so we can help if something goes wrong.
          </p>
        </aside>
      </div>

      <ActionDialog order={o} action={action} onClose={() => setAction(null)} />
      {canPay && (
        <PaymentDialog
          order={o}
          open={paying}
          onOpenChange={setPaying}
          onPaid={() => setConfirmingSince(Date.now())}
        />
      )}
    </div>
  );
}
