'use client';

import type { OrderDto, PaymentSessionDto } from '@markethub/shared';
import { ExternalLink, FlaskConical, Loader2, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormAlert } from '@/components/auth/form-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSandboxCharge, useStartPayment } from '@/hooks/use-deals';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';

const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Couldn’t reach the payment service — try again.';

function SandboxForm({
  session,
  order,
  onPaid,
  onDeclined,
}: {
  session: PaymentSessionDto;
  order: OrderDto;
  onPaid: () => void;
  onDeclined: () => void;
}) {
  const charge = useSandboxCharge();
  const [card, setCard] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    charge.mutate(
      { ref: session.clientSecret!, card },
      {
        onSuccess: ({ status }) => (status === 'succeeded' ? onPaid() : onDeclined()),
        onError: (err) => setError(message(err)),
      },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="flex gap-2 rounded-md border border-dashed border-saffron/60 bg-saffron/10 p-3 text-xs leading-relaxed">
        <FlaskConical className="mt-px size-4 shrink-0" aria-hidden />
        <span>
          Test payments — Paystack keys aren&apos;t configured yet. Use{' '}
          <code className="font-mono">4242 4242 4242 4242</code> to pay or{' '}
          <code className="font-mono">4000 0000 0000 0002</code> for a decline.
        </span>
      </p>
      {error && <FormAlert>{error}</FormAlert>}
      <div className="grid gap-1.5">
        <Label htmlFor="sandbox-card">Card number</Label>
        <Input
          id="sandbox-card"
          value={card}
          onChange={(e) => setCard(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          placeholder="4242 4242 4242 4242"
          className="tabular font-mono"
        />
      </div>
      <Button
        type="submit"
        size="lg"
        disabled={charge.isPending || card.replace(/\s/g, '').length < 12}
      >
        {charge.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Lock className="size-4" />
        )}
        Pay {formatMoney(order.total, order.currency)}
      </Button>
    </form>
  );
}

export function PaymentDialog({
  order,
  open,
  onOpenChange,
  onPaid,
}: {
  order: OrderDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Payment handed to the gateway; the order flips once its webhook lands. */
  onPaid: () => void;
}) {
  const start = useStartPayment(order.id);
  const [session, setSession] = useState<PaymentSessionDto | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Survives the form remounting for a fresh charge after a decline.
  const [notice, setNotice] = useState<string | null>(null);
  const { mutate } = start;

  useEffect(() => {
    if (!open) return;
    mutate(undefined, {
      onSuccess: (s) => {
        setSession(s);
        if (s.status === 'succeeded') {
          onPaid();
          onOpenChange(false);
        }
      },
    });
    // A declined sandbox card bumps `attempt` for a fresh charge.
  }, [open, attempt, mutate]); // eslint-disable-line react-hooks/exhaustive-deps

  const paid = () => {
    setNotice(null);
    onPaid();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay {formatMoney(order.total, order.currency)}</DialogTitle>
          <DialogDescription>
            {order.orderNumber} · held in escrow until you confirm delivery
          </DialogDescription>
        </DialogHeader>

        {notice && <FormAlert>{notice}</FormAlert>}
        {start.isError ? (
          <div className="grid gap-3">
            <FormAlert>{message(start.error)}</FormAlert>
            <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : !session || start.isPending ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Preparing secure checkout…
          </p>
        ) : session.gateway === 'paystack' && session.redirectUrl ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              You&apos;ll finish on Paystack — card, bank transfer or M-Pesa / mobile money — and
              come straight back here. Card details never touch MarketHub.
            </p>
            <Button size="lg" onClick={() => window.location.assign(session.redirectUrl!)}>
              Continue to Paystack <ExternalLink className="size-4" />
            </Button>
          </div>
        ) : session.gateway === 'sandbox' && session.clientSecret ? (
          <SandboxForm
            key={session.clientSecret}
            session={session}
            order={order}
            onPaid={paid}
            onDeclined={() => {
              setNotice('Card declined. Nothing was charged — try another card.');
              setAttempt((n) => n + 1);
            }}
          />
        ) : (
          <FormAlert>Checkout isn&apos;t available for this order right now.</FormAlert>
        )}
      </DialogContent>
    </Dialog>
  );
}
