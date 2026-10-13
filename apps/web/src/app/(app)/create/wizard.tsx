'use client';

import {
  type CreateListingForm,
  type CreateListingInput,
  createListingSchema,
  type ListingDetailDto,
} from '@markethub/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FormProvider, type Path, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { FormAlert } from '@/components/auth/form-alert';
import type { Photo } from '@/components/listings/photo-uploader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/hooks/use-me';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { api } from '@/lib/api';
import { applyApiErrors } from '@/lib/form-errors';
import { cn } from '@/lib/utils';
import { DetailsStep, PhotosStep, PriceStep, ReviewStep, WhatStep } from './steps';

const STEPS: { title: string; fields: Path<CreateListingForm>[] }[] = [
  { title: 'What', fields: ['type', 'categoryId'] },
  { title: 'Details', fields: ['title', 'description', 'condition', 'stock', 'tags'] },
  { title: 'Photos', fields: [] },
  {
    title: 'Price',
    fields: ['price', 'isPriceRange', 'priceMin', 'priceMax', 'currency', 'country', 'city'],
  },
  { title: 'Review', fields: [] },
];

const toForm = (l: ListingDetailDto): CreateListingForm => ({
  type: l.type,
  categoryId: l.category.id,
  title: l.title,
  description: l.description,
  condition: l.condition,
  stock: l.stock,
  tags: l.tags,
  price: l.price,
  isPriceRange: l.isPriceRange,
  priceMin: l.priceMin,
  priceMax: l.priceMax,
  currency: l.currency,
  isNegotiable: l.isNegotiable,
  country: l.country ?? '',
  city: l.city ?? '',
  contactPref: l.contactPref,
});

export function CreateListingWizard() {
  const ready = useRequireAuth();
  const { data: me } = useMe();
  const router = useRouter();
  const editSlug = useSearchParams().get('edit');
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ListingDetailDto | null>(null);

  const form = useForm<CreateListingForm, unknown, CreateListingInput>({
    resolver: zodResolver(createListingSchema),
    defaultValues: {
      type: 'product',
      title: '',
      description: '',
      tags: [],
      currency: 'KES',
      isPriceRange: false,
      isNegotiable: true,
      contactPref: 'chat',
      price: '',
      country: '',
      city: '',
    },
    mode: 'onTouched',
  });

  // Prefill location from the profile; in edit mode, everything from the listing.
  useEffect(() => {
    if (!me) return;
    if (!me.profile) {
      router.replace(`/onboarding?next=${encodeURIComponent('/create')}`);
      return;
    }
    if (!editSlug && !form.getValues('country')) {
      form.setValue('country', me.profile.country ?? '');
      form.setValue('city', me.profile.city ?? '');
      if (me.user.role === 'buyer') form.setValue('type', 'request');
    }
  }, [me, editSlug, form, router]);

  useEffect(() => {
    if (!editSlug || !ready) return;
    api<ListingDetailDto>(`/listings/${encodeURIComponent(editSlug)}`).then(
      (l) => {
        if (!l.isOwner) return router.replace('/seller');
        setEditing(l);
        form.reset(toForm(l));
        setPhotos(
          l.images.map((i) => ({
            key: i.id,
            preview: i.thumbUrl ?? i.url,
            url: i.url,
            thumbUrl: i.thumbUrl ?? undefined,
            state: 'done' as const,
          })),
        );
      },
      () => setError("Couldn't load that listing."),
    );
  }, [editSlug, ready, form, router]);

  const uploading = photos.some((p) => p.state === 'uploading');
  const failed = photos.some((p) => p.state === 'failed');

  async function next() {
    setError(null);
    const ok = await form.trigger(STEPS[step]!.fields, { shouldFocus: true });
    if (!ok) return;
    if (step === 2 && (uploading || failed)) {
      return setError(
        uploading ? 'Hang on — photos are still uploading.' : 'Retry or remove the failed photos.',
      );
    }
    setStep((s) => s + 1);
    window.scrollTo({ top: 0 });
  }

  const save = (publish: boolean) =>
    form.handleSubmit(async (values) => {
      setError(null);
      const body = {
        ...values,
        images: photos
          .filter((p) => p.state === 'done' && p.url)
          .map((p) => ({ url: p.url!, ...(p.thumbUrl && { thumbUrl: p.thumbUrl }) })),
      };
      try {
        let saved = editing
          ? await api<ListingDetailDto>(`/listings/${editing.id}`, { method: 'PATCH', body })
          : await api<ListingDetailDto>('/listings', { method: 'POST', body });
        if (publish && (saved.status === 'draft' || saved.status === 'expired')) {
          saved = await api<ListingDetailDto>(`/listings/${saved.id}/publish`, { method: 'POST' });
        }
        await queryClient.invalidateQueries({ queryKey: ['listings'] });
        await queryClient.invalidateQueries({ queryKey: ['listing'] });
        toast.success(
          saved.status === 'active'
            ? editing
              ? 'Changes saved'
              : 'Your listing is live'
            : 'Saved as a draft',
        );
        router.push(`/l/${saved.slug}`);
      } catch (err) {
        const banner = applyApiErrors(form, err);
        // Field errors from the API may belong to an earlier step: jump back to it.
        const bad = STEPS.findIndex((s) => s.fields.some((f) => form.getFieldState(f).error));
        if (bad >= 0) setStep(bad);
        setError(banner ?? (bad >= 0 ? 'Please fix the highlighted fields.' : null));
      }
    })();

  if (!ready || !me || (editSlug && !editing && !error)) {
    return (
      <div className="max-w-xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const busy = form.formState.isSubmitting;
  const last = step === STEPS.length - 1;

  return (
    <FormProvider {...form}>
      <div className="max-w-xl">
        <div className="flex items-center gap-3">
          {step > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back"
              onClick={() => setStep((s) => s - 1)}
              className="-ml-2"
            >
              <ArrowLeft className="size-5" />
            </Button>
          )}
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {editing ? 'Edit listing' : 'New listing'} · {step + 1}/{STEPS.length}
            </p>
            <h1 className="text-xl font-semibold tracking-tight">{STEPS[step]!.title}</h1>
          </div>
        </div>

        <ol className="mt-4 grid grid-cols-5 gap-1" aria-hidden>
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className={cn('h-1 rounded-full bg-border', i <= step && 'bg-primary')}
            />
          ))}
        </ol>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!last) void next();
          }}
          className="mt-8 space-y-6"
        >
          <FormAlert>{error}</FormAlert>
          <div key={step} className="animate-rise-in">
            {step === 0 && <WhatStep role={me.user.role} />}
            {step === 1 && <DetailsStep />}
            {step === 2 && <PhotosStep photos={photos} setPhotos={setPhotos} />}
            {step === 3 && <PriceStep />}
            {step === 4 && <ReviewStep photos={photos} verified={me.user.isEmailVerified} />}
          </div>

          <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] -mx-4 flex gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0">
            {last ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || uploading}
                  onClick={() => void save(false)}
                >
                  {editing && editing.status === 'active' ? 'Save changes' : 'Save draft'}
                </Button>
                {(!editing || editing.status !== 'active') && (
                  <Button
                    type="button"
                    className="flex-1"
                    disabled={busy || uploading || !me.user.isEmailVerified}
                    onClick={() => void save(true)}
                  >
                    {busy ? 'Publishing…' : 'Publish'}
                  </Button>
                )}
              </>
            ) : (
              <Button type="submit" className="ml-auto min-w-32">
                Continue
              </Button>
            )}
          </div>
        </form>
      </div>
    </FormProvider>
  );
}
