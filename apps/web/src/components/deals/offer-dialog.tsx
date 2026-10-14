'use client';

import {
  type ConversationDto,
  MAX_OFFER_QUANTITY,
  moneySchema,
  multiplyMoney,
  type OfferDto,
} from '@markethub/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormAlert } from '@/components/auth/form-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useOfferAction } from '@/hooks/use-deals';
import { formatMoney } from '@/lib/format';
import { applyApiErrors } from '@/lib/form-errors';

const offerFormSchema = z.object({
  unitPrice: moneySchema,
  quantity: z.coerce.number().int().min(1, 'At least 1').max(MAX_OFFER_QUANTITY),
  message: z.string().trim().max(500, 'Keep it under 500 characters').optional(),
});
type Values = z.input<typeof offerFormSchema>;

const VALID_AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Make an offer, or counter one (§6 CounterOfferModal). Radix traps focus and
 * returns it to the trigger on close.
 */
export function OfferDialog({
  conversation,
  counterTo,
  open,
  onOpenChange,
}: {
  conversation: ConversationDto;
  /** Set when countering; prefills its terms. */
  counterTo?: OfferDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { listing } = conversation;
  const action = useOfferAction();
  const [banner, setBanner] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(offerFormSchema),
    defaultValues: { unitPrice: '', quantity: 1, message: '' },
  });

  useEffect(() => {
    if (!open) return;
    setBanner(null);
    form.reset({
      unitPrice: counterTo?.unitPrice ?? listing.price ?? '',
      quantity: counterTo?.quantity ?? 1,
      message: '',
    });
  }, [open, counterTo, listing.price, form]);

  const [price, qty] = form.watch(['unitPrice', 'quantity']);
  const amount = String(price ?? '').trim();
  const count = Number(qty);
  const total =
    VALID_AMOUNT.test(amount) && Number(amount) > 0 && Number.isInteger(count) && count > 0
      ? multiplyMoney(Number(amount).toFixed(2), count)
      : null;

  const submit = form.handleSubmit(async (raw) => {
    const v = offerFormSchema.parse(raw);
    const message = v.message || undefined;
    setBanner(null);
    try {
      await action.mutateAsync(
        counterTo
          ? { kind: 'counter', id: counterTo.id, input: { ...v, message } }
          : { kind: 'create', input: { conversationId: conversation.id, ...v, message } },
      );
      toast.success(counterTo ? 'Counter-offer sent' : 'Offer sent');
      onOpenChange(false);
    } catch (err) {
      setBanner(applyApiErrors(form, err));
    }
  });

  const showQuantity = listing.type === 'product';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{counterTo ? 'Counter-offer' : 'Make an offer'}</DialogTitle>
          <DialogDescription className="truncate">
            {listing.title}
            {listing.price && ` · listed at ${formatMoney(listing.price, listing.currency)}`}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            {banner && <FormAlert>{banner}</FormAlert>}
            <div className={showQuantity ? 'grid grid-cols-[1fr_6.5rem] gap-3' : undefined}>
              <FormField
                control={form.control}
                name="unitPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {showQuantity ? 'Price each' : 'Your price'} ({listing.currency})
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={String(field.value ?? '')}
                        inputMode="decimal"
                        autoComplete="off"
                        className="tabular text-lg"
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {showQuantity && (
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={String(field.value ?? '')}
                          type="number"
                          min={1}
                          inputMode="numeric"
                          className="tabular text-lg"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-normal text-muted-foreground">
                    Note <span className="text-xs">(optional)</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={2}
                      maxLength={500}
                      placeholder={counterTo ? 'Meet me halfway?' : 'I can pick up this weekend'}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-end justify-between gap-4 border-t pt-4">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Total
                <span className="tabular block text-xl font-semibold text-foreground">
                  {total ? formatMoney(total, listing.currency) : '—'}
                </span>
              </p>
              <Button type="submit" disabled={action.isPending} className="min-w-32">
                {action.isPending && <Loader2 className="size-4 animate-spin" />}
                {counterTo ? 'Send counter' : 'Send offer'}
              </Button>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              Valid for 48 hours. If it&apos;s accepted, you pay through escrow.
            </p>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
