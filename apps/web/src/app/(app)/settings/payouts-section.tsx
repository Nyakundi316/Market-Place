'use client';

import { PAYOUT_CURRENCIES, type PayoutAccountDto } from '@markethub/shared';
import { Banknote, CircleCheck, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormAlert } from '@/components/auth/form-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useBanks, usePayoutAccounts, useSetupPayouts } from '@/hooks/use-deals';
import { ApiError } from '@/lib/api';

type LocalCurrency = (typeof PAYOUT_CURRENCIES)[number];

const STATUS_COPY: Record<PayoutAccountDto['status'], string> = {
  ready: 'Ready for payouts',
  pending: 'Verification not finished',
  restricted: 'Payouts paused by the provider',
};

/** Paystack recipients for local currencies (bank or mobile money). */
function BankForm({ onDone }: { onDone: () => void }) {
  const [currency, setCurrency] = useState<LocalCurrency>('KES');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const banks = useBanks(currency);
  const setup = useSetupPayouts();

  return (
    <form
      className="grid gap-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setup.mutate(
          { currency, bankCode, accountNumber: accountNumber.trim() },
          {
            onSuccess: () => {
              toast.success('Payout account saved');
              onDone();
            },
          },
        );
      }}
    >
      {setup.isError && (
        <FormAlert>
          {setup.error instanceof ApiError ? setup.error.message : 'Couldn’t save that account'}
        </FormAlert>
      )}
      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="payout-currency">Currency</Label>
          <NativeSelect
            id="payout-currency"
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value as LocalCurrency);
              setBankCode('');
            }}
          >
            {PAYOUT_CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="payout-bank">Bank or wallet</Label>
          <NativeSelect
            id="payout-bank"
            value={bankCode}
            onChange={(e) => setBankCode(e.target.value)}
            disabled={banks.isPending}
          >
            <option value="" disabled>
              {banks.isPending ? 'Loading…' : 'Choose'}
            </option>
            {banks.data?.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="payout-number">Account number, or phone number for M-Pesa</Label>
        <Input
          id="payout-number"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
        />
      </div>
      <Button
        type="submit"
        disabled={setup.isPending || !bankCode || !/^\d{6,20}$/.test(accountNumber.trim())}
        className="justify-self-start"
      >
        {setup.isPending && <Loader2 className="size-4 animate-spin" />}
        Save payout account
      </Button>
    </form>
  );
}

/** Where escrow releases go (§7). Linked from the "add payout details" nudge. */
export function PayoutsSection() {
  const accounts = usePayoutAccounts();
  const [adding, setAdding] = useState(false);

  return (
    <section id="payouts" className="scroll-mt-20 space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Payouts
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Where your money goes when a buyer confirms delivery: a bank account or M-Pesa / mobile
          money wallet, paid out through Paystack.
        </p>
      </div>

      {accounts.isPending ? (
        <Skeleton className="h-14" />
      ) : (
        accounts.data?.map((a) => (
          <div key={a.gateway} className="flex items-center gap-3 rounded-lg border bg-card p-3">
            {a.status === 'ready' ? (
              <CircleCheck className="size-5 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <Banknote className="size-5 shrink-0 text-saffron-foreground" aria-hidden />
            )}
            <span className="min-w-0 flex-1 text-sm">
              <span className="block font-medium">{a.details?.label ?? 'Payout account'}</span>
              <span className="text-xs text-muted-foreground">{STATUS_COPY[a.status]}</span>
            </span>
          </div>
        ))
      )}

      {adding ? (
        <BankForm onDone={() => setAdding(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAdding(true)}>
            {accounts.data?.length ? 'Change payout account' : 'Add bank or M-Pesa'}
          </Button>
        </div>
      )}
    </section>
  );
}
