'use client';

import {
  type ConversationDto,
  createOrderSchema,
  type DeliveryMethod,
  type OfferDto,
} from '@markethub/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
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
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useCreateOrder } from '@/hooks/use-deals';
import { useMe } from '@/hooks/use-me';
import { countryOptions } from '@/lib/countries';
import { formatMoney } from '@/lib/format';
import { applyApiErrors } from '@/lib/form-errors';
import { cn } from '@/lib/utils';

type Values = z.input<typeof createOrderSchema>;

const METHOD_LABEL: Record<DeliveryMethod, { label: string; hint: string }> = {
  pickup: { label: 'Pick up', hint: 'Collect from the seller' },
  courier: { label: 'Delivery', hint: 'Sent to your address' },
  in_person: { label: 'In person', hint: 'Done at an agreed place' },
  digital: { label: 'Online', hint: 'Delivered remotely' },
};

const methodsFor = (type: ConversationDto['listing']['type']): DeliveryMethod[] =>
  type === 'product'
    ? ['pickup', 'courier']
    : type === 'service'
      ? ['in_person', 'digital']
      : ['pickup', 'courier', 'in_person', 'digital'];

/** §6 CheckoutSummary: accepted offer → order. Payment itself is the next screen. */
export function CheckoutDialog({
  conversation,
  offer,
  open,
  onOpenChange,
}: {
  conversation: ConversationDto;
  offer: OfferDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const me = useMe();
  const createOrder = useCreateOrder();
  const [banner, setBanner] = useState<string | null>(null);
  const methods = methodsFor(conversation.listing.type);

  const form = useForm<Values>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: { offerId: offer.id, deliveryMethod: methods[0], notes: '' },
  });
  const method = form.watch('deliveryMethod');

  // Courier needs an address; seed it from the profile so most people only add a street.
  useEffect(() => {
    if (method !== 'courier' || form.getValues('deliveryAddress')) return;
    const p = me.data?.profile;
    form.setValue('deliveryAddress', {
      recipient: p?.displayName ?? '',
      line1: '',
      city: p?.city ?? '',
      country: p?.country ?? '',
    });
  }, [method, me.data, form]);

  const submit = form.handleSubmit(async (v) => {
    setBanner(null);
    try {
      const order = await createOrder.mutateAsync(
        createOrderSchema.parse({
          ...v,
          deliveryAddress: v.deliveryMethod === 'courier' ? v.deliveryAddress : undefined,
          notes: v.notes || undefined,
        }),
      );
      onOpenChange(false);
      router.push(`/orders/${order.id}`);
    } catch (err) {
      setBanner(applyApiErrors(form, err));
    }
  });

  const address = (name: 'recipient' | 'phone' | 'line1' | 'line2' | 'city', label: string) => (
    <FormField
      control={form.control}
      name={`deliveryAddress.${name}`}
      render={({ field }) => (
        <FormItem className={name === 'line1' || name === 'line2' ? 'col-span-2' : undefined}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              value={field.value ?? ''}
              autoComplete={
                {
                  recipient: 'name',
                  phone: 'tel',
                  line1: 'address-line1',
                  line2: 'address-line2',
                  city: 'address-level2',
                }[name]
              }
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Checkout</DialogTitle>
          <DialogDescription>
            {offer.quantity > 1 && `${offer.quantity} × `}
            {conversation.listing.title}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={submit} className="grid gap-5" noValidate>
            {banner && <FormAlert>{banner}</FormAlert>}

            <fieldset>
              <legend className="mb-2 text-sm font-medium">How will you get it?</legend>
              <div className="grid grid-cols-2 gap-2">
                {methods.map((m) => (
                  <label
                    key={m}
                    className={cn(
                      'cursor-pointer rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring',
                      method === m ? 'border-primary bg-primary/5' : 'hover:border-foreground/30',
                    )}
                  >
                    <input
                      type="radio"
                      value={m}
                      {...form.register('deliveryMethod')}
                      className="sr-only"
                    />
                    <span className="block font-medium">{METHOD_LABEL[m].label}</span>
                    <span className="text-xs text-muted-foreground">{METHOD_LABEL[m].hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {method === 'courier' && (
              <div className="grid grid-cols-2 gap-3">
                {address('recipient', 'Full name')}
                {address('phone', 'Phone')}
                {address('line1', 'Street address')}
                {address('line2', 'Apartment, floor (optional)')}
                {address('city', 'City')}
                <FormField
                  control={form.control}
                  name="deliveryAddress.country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Country</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} value={field.value ?? ''} autoComplete="country">
                          <option value="" disabled>
                            Choose
                          </option>
                          {countryOptions().map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-normal text-muted-foreground">
                    Note for the seller <span className="text-xs">(optional)</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ''} rows={2} maxLength={1000} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <dl className="grid grid-cols-[1fr_auto] gap-y-1 rounded-lg bg-muted/50 p-3 text-sm">
              <dt className="text-muted-foreground">
                {offer.quantity} × {formatMoney(offer.unitPrice, offer.currency)}
              </dt>
              <dd className="tabular text-right">
                {formatMoney(offer.totalPrice, offer.currency)}
              </dd>
              <dt className="font-medium">You pay</dt>
              <dd className="tabular text-right text-lg font-semibold">
                {formatMoney(offer.totalPrice, offer.currency)}
              </dd>
            </dl>

            <p className="-mt-2 flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-px size-4 shrink-0 text-primary" aria-hidden />
              Your payment is held in escrow and only released to the seller after you confirm
              delivery. Unpaid orders are cancelled after 24 hours.
            </p>

            <Button type="submit" disabled={createOrder.isPending} size="lg">
              {createOrder.isPending && <Loader2 className="size-4 animate-spin" />}
              Place order
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
