'use client';

import {
  CONDITIONS,
  type CreateListingForm,
  CURRENCIES,
  MAX_LISTING_TAGS,
  type UserRole,
} from '@markethub/shared';
import { Briefcase, Hand, Package, Wrench, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { FormAlert } from '@/components/auth/form-alert';
import { type Photo, PhotoUploader } from '@/components/listings/photo-uploader';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useCategories } from '@/hooks/use-listings';
import { countryOptions } from '@/lib/countries';
import { CONDITION_LABEL, formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

const TYPES = [
  { value: 'product', label: 'Item', hint: 'Something physical to sell', icon: Package },
  { value: 'service', label: 'Service', hint: 'Work you do for people', icon: Wrench },
  { value: 'job', label: 'Job', hint: 'A role you are hiring for', icon: Briefcase },
  { value: 'request', label: 'Wanted', hint: 'Something you want to buy', icon: Hand },
] as const;

export function WhatStep({ role }: { role: UserRole }) {
  const form = useFormContext<CreateListingForm>();
  const { data: tree, isPending } = useCategories();
  const categoryId = form.watch('categoryId');
  const type = form.watch('type');
  // The root whose child is selected (or the selected root itself, for leaf roots).
  const [rootId, setRootId] = useState<string | null>(null);
  const activeRoot =
    tree?.find((r) => r.id === rootId) ??
    tree?.find((r) => r.id === categoryId || r.children.some((c) => c.id === categoryId));

  return (
    <div className="space-y-8">
      <FormField
        control={form.control}
        name="type"
        render={({ field }) => (
          <FormItem>
            <FormLabel asChild>
              <legend className="text-base">What are you posting?</legend>
            </FormLabel>
            <fieldset className="grid grid-cols-2 gap-2">
              {TYPES.map((t) => {
                const locked = role === 'buyer' && t.value !== 'request';
                return (
                  <label
                    key={t.value}
                    className={cn(
                      'flex cursor-pointer gap-3 rounded-lg border bg-card p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                      field.value === t.value
                        ? 'border-primary bg-primary/5'
                        : 'hover:border-foreground/30',
                      locked && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <input
                      type="radio"
                      name={field.name}
                      value={t.value}
                      disabled={locked}
                      checked={field.value === t.value}
                      onChange={() => {
                        field.onChange(t.value);
                        if (t.value !== 'product') form.setValue('condition', null);
                      }}
                      className="sr-only"
                    />
                    <t.icon className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={1.75} />
                    <span>
                      <span className="block text-sm font-medium">{t.label}</span>
                      <span className="block text-xs text-muted-foreground">{t.hint}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {role === 'buyer' && (
              <FormDescription>
                Selling too?{' '}
                <Link href="/settings" className="text-primary underline-offset-4 hover:underline">
                  Switch your account to selling
                </Link>
                .
              </FormDescription>
            )}
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="categoryId"
        render={({ field }) => (
          <FormItem>
            <FormLabel asChild>
              <legend className="text-base">Category</legend>
            </FormLabel>
            {isPending || !tree ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {tree.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      aria-pressed={activeRoot?.id === r.id}
                      onClick={() => {
                        setRootId(r.id);
                        field.onChange(r.children.length ? undefined : r.id);
                      }}
                      className={cn(
                        'rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                        activeRoot?.id === r.id
                          ? 'border-foreground bg-foreground text-background'
                          : 'bg-card hover:border-foreground/30',
                      )}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
                {activeRoot && activeRoot.children.length > 0 && (
                  <div className="mt-4 animate-rise-in">
                    <p className="mb-2 text-sm text-muted-foreground">In {activeRoot.name}:</p>
                    <div className="flex flex-wrap gap-2">
                      {activeRoot.children.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={field.value === c.id}
                          onClick={() => field.onChange(c.id)}
                          className={cn(
                            'rounded-full border px-3 py-1.5 text-sm',
                            field.value === c.id
                              ? 'border-primary bg-primary/10 font-medium text-primary'
                              : 'bg-card hover:border-foreground/30',
                          )}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            <FormMessage>{form.formState.errors.categoryId && 'Choose a category'}</FormMessage>
          </FormItem>
        )}
      />
      {type === 'job' && (
        <p className="text-xs text-muted-foreground">
          Tip: put the salary or rate in the price step so applicants know upfront.
        </p>
      )}
    </div>
  );
}

function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const commit = () => {
    const t = text.trim().toLowerCase().replace(/,$/, '');
    if (t && !value.includes(t) && value.length < MAX_LISTING_TAGS) onChange([...value, t]);
    setText('');
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 shadow-sm focus-within:ring-1 focus-within:ring-ring">
      {value.map((t) => (
        <span
          key={t}
          className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2.5 pr-1 text-xs"
        >
          {t}
          <button
            type="button"
            aria-label={`Remove tag ${t}`}
            onClick={() => onChange(value.filter((x) => x !== t))}
            className="grid size-4 place-items-center rounded-full hover:bg-background"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {value.length < MAX_LISTING_TAGS && (
        <input
          aria-label="Add a tag"
          value={text}
          onChange={(e) => (e.target.value.endsWith(',') ? commit() : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={value.length ? '' : 'e.g. iphone, unlocked'}
          maxLength={30}
          className="min-w-24 flex-1 bg-transparent text-base outline-none md:text-sm"
        />
      )}
    </div>
  );
}

export function DetailsStep() {
  const form = useFormContext<CreateListingForm>();
  const type = form.watch('type');
  const description = form.watch('description') ?? '';
  return (
    <div className="space-y-5">
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Title</FormLabel>
            <FormControl>
              <Input
                maxLength={120}
                placeholder="Brand, model, size — what buyers search for"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-baseline justify-between">
              <FormLabel>Description</FormLabel>
              <span className="tabular text-xs text-muted-foreground">
                {description.length}/5000
              </span>
            </div>
            <FormControl>
              <Textarea
                rows={7}
                maxLength={5000}
                placeholder={
                  type === 'service'
                    ? 'What you offer, your experience, where you work, typical turnaround…'
                    : 'Condition, what’s included, why you’re selling, any flaws…'
                }
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {type === 'product' && (
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <FormField
            control={form.control}
            name="condition"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Condition</FormLabel>
                <FormControl>
                  <NativeSelect
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  >
                    <option value="">Not specified</option>
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {CONDITION_LABEL[c]}
                      </option>
                    ))}
                  </NativeSelect>
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="stock"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Quantity</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={field.value ?? ''}
                    onChange={(e) =>
                      field.onChange(e.target.value === '' ? null : Number(e.target.value))
                    }
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}
      <FormField
        control={form.control}
        name="tags"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Tags <span className="font-normal text-muted-foreground">(optional)</span>
            </FormLabel>
            <TagInput value={field.value ?? []} onChange={field.onChange} />
            <FormDescription>
              Press Enter or comma after each. Up to {MAX_LISTING_TAGS}.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

export function PhotosStep({
  photos,
  setPhotos,
}: {
  photos: Photo[];
  setPhotos: (u: (p: Photo[]) => Photo[]) => void;
}) {
  const type = useFormContext<CreateListingForm>().watch('type');
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {type === 'product'
          ? 'At least one photo is needed to publish. Show the real thing, from a few angles.'
          : 'Optional — samples of your work, your workspace or a logo help.'}
      </p>
      <PhotoUploader photos={photos} onChange={setPhotos} />
    </div>
  );
}

export function PriceStep() {
  const form = useFormContext<CreateListingForm>();
  const range = form.watch('isPriceRange');
  const countries = useMemo(countryOptions, []);

  const setMode = (isRange: boolean) => {
    form.setValue('isPriceRange', isRange);
    // Clear the other mode's fields so they don't fail validation unseen.
    if (isRange) form.setValue('price', null);
    else {
      form.setValue('priceMin', null);
      form.setValue('priceMax', null);
      if (form.getValues('price') === null) form.setValue('price', '');
    }
    form.clearErrors(['price', 'priceMin', 'priceMax']);
  };

  const amount = (name: 'price' | 'priceMin' | 'priceMax', label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex-1">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              inputMode="decimal"
              className="tabular"
              placeholder="0"
              {...field}
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value.replace(/[^\d.]/g, ''))}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <div className="space-y-6">
      <div
        className="inline-flex rounded-lg border bg-muted p-1"
        role="radiogroup"
        aria-label="Pricing"
      >
        {[
          [false, 'Fixed price'],
          [true, 'Price range'],
        ].map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={range === v}
            onClick={() => setMode(v as boolean)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm',
              range === v ? 'bg-card font-medium shadow-card' : 'text-muted-foreground',
            )}
          >
            {label as string}
          </button>
        ))}
      </div>

      <div className="flex items-start gap-3">
        <FormField
          control={form.control}
          name="currency"
          render={({ field }) => (
            <FormItem className="w-24">
              <FormLabel>Currency</FormLabel>
              <FormControl>
                <NativeSelect {...field}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </NativeSelect>
              </FormControl>
            </FormItem>
          )}
        />
        {range ? (
          <>
            {amount('priceMin', 'From')}
            {amount('priceMax', 'To')}
          </>
        ) : (
          amount('price', 'Price')
        )}
      </div>

      <FormField
        control={form.control}
        name="isNegotiable"
        render={({ field }) => (
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[hsl(var(--primary))]"
              checked={field.value ?? true}
              onChange={(e) => field.onChange(e.target.checked)}
            />
            Open to offers — buyers can make and counter offers in chat
          </label>
        )}
      />

      <div className="grid gap-4 border-t pt-6 sm:grid-cols-[1fr_0.8fr]">
        <FormField
          control={form.control}
          name="country"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Country</FormLabel>
              <FormControl>
                <NativeSelect {...field}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {countries.map((c) => (
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
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>City or town</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}

export function ReviewStep({ photos, verified }: { photos: Photo[]; verified: boolean }) {
  const v = useFormContext<CreateListingForm>().getValues();
  const cover = photos.find((p) => p.state === 'done');
  const preview = formatPrice({
    price: v.price ? String(v.price) : null,
    priceMin: v.priceMin ? String(v.priceMin) : null,
    priceMax: v.priceMax ? String(v.priceMax) : null,
    isPriceRange: Boolean(v.isPriceRange),
    currency: v.currency,
  });
  return (
    <div className="space-y-5">
      <div className="flex gap-4 rounded-lg border bg-card p-3">
        <div className="relative size-24 shrink-0 overflow-hidden rounded-md bg-muted">
          {cover && (
            <Image
              src={cover.thumbUrl ?? cover.preview}
              alt=""
              fill
              unoptimized
              sizes="96px"
              className="object-cover"
            />
          )}
        </div>
        <div className="min-w-0">
          <p className="tabular font-semibold">{preview}</p>
          <p className="line-clamp-2 text-sm">{v.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {v.city} · {photos.length} photo{photos.length === 1 ? '' : 's'}
            {v.tags?.length ? ` · ${v.tags.length} tags` : ''}
          </p>
        </div>
      </div>
      <p className="line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">
        {v.description}
      </p>
      {!verified && (
        <FormAlert>
          Confirm your email to publish — we sent you a link when you signed up. You can save a
          draft now and publish once confirmed.
        </FormAlert>
      )}
      <p className="text-xs text-muted-foreground">
        Listings stay live for 30 days. By publishing you confirm you own this item or offer this
        service, and agree to take payment only through MarketHub escrow.
      </p>
    </div>
  );
}
