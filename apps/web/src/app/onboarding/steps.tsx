'use client';

import { type MeDto, updateProfileSchema } from '@markethub/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { type DefaultValues, type FieldValues, useForm, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { FormAlert } from '@/components/auth/form-alert';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { countryOptions } from '@/lib/countries';
import { applyApiErrors } from '@/lib/form-errors';
import { cn } from '@/lib/utils';

const field = updateProfileSchema.required().shape;

const identitySchema = z.object({
  displayName: field.displayName,
  username: field.username,
  role: field.role,
});
const locationSchema = z.object({
  country: field.country,
  city: field.city.min(1, 'Which city or town?'),
  phone: field.phone.or(z.literal('')),
});
const aboutSchema = z.object({
  bio: field.bio,
  profession: field.profession,
  company: field.company,
  website: field.website,
});

interface StepProps {
  me: MeDto;
  onSaved: (me: MeDto) => void;
  onSkip?: () => void;
}

/** One form per step; each saves straight to PATCH /me so progress survives a reload. */
function useStepForm<S extends z.ZodType<FieldValues>>(
  schema: S,
  defaults: DefaultValues<z.input<S>>,
  onSaved: StepProps['onSaved'],
  toBody: (v: z.output<S>) => object = (v) => v,
) {
  const form = useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  const [error, setError] = useState<string | null>(null);
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      onSaved(await api<MeDto>('/me', { method: 'PATCH', body: toBody(values) }));
    } catch (err) {
      setError(applyApiErrors(form as unknown as UseFormReturn<FieldValues>, err));
    }
  });
  return { form, onSubmit, error };
}

function StepFooter({
  busy,
  onSkip,
  last,
}: {
  busy: boolean;
  onSkip?: () => void;
  last?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <Button type="submit" disabled={busy} className="min-w-32">
        {busy ? 'Saving…' : last ? 'Finish' : 'Continue'}
      </Button>
      {onSkip && (
        <Button type="button" variant="ghost" onClick={onSkip} disabled={busy}>
          Skip for now
        </Button>
      )}
    </div>
  );
}

const ROLES = [
  { value: 'buyer', label: 'Buying' },
  { value: 'seller', label: 'Selling' },
  { value: 'both', label: 'Both' },
] as const;

export function IdentityStep({ me, onSaved }: StepProps) {
  const userRole = me.user.role === 'admin' ? 'both' : me.user.role;
  const { form, onSubmit, error } = useStepForm(
    identitySchema,
    {
      displayName: me.profile?.displayName ?? '',
      username: me.profile?.username ?? '',
      role: userRole,
    },
    onSaved,
    // Admins keep their role; the strict schema would reject it anyway.
    (v) => (me.user.role === 'admin' ? { ...v, role: undefined } : v),
  );
  const username = form.watch('username');

  return (
    <>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Let&apos;s set up your profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This is what people see when they chat or trade with you.
      </p>
      <Form {...form}>
        <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
          <FormAlert>{error}</FormAlert>
          <FormField
            control={form.control}
            name="displayName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Display name</FormLabel>
                <FormControl>
                  <Input autoComplete="name" placeholder="e.g. Amina Wanjiru" {...field} />
                </FormControl>
                <FormDescription>Your name, or your shop&apos;s.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Username</FormLabel>
                <div className="flex rounded-md border border-input shadow-sm focus-within:ring-1 focus-within:ring-ring">
                  <span
                    aria-hidden
                    className="grid place-items-center border-r bg-muted px-3 text-sm text-muted-foreground"
                  >
                    @
                  </span>
                  <FormControl>
                    <Input
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      className="border-0 shadow-none focus-visible:ring-0"
                      {...field}
                    />
                  </FormControl>
                </div>
                <FormDescription className="truncate">
                  markethub.app/u/{username?.toLowerCase() || 'yourname'}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {me.user.role !== 'admin' && (
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel asChild>
                    <legend>Mostly here for</legend>
                  </FormLabel>
                  <fieldset className="inline-flex rounded-lg border bg-muted p-1">
                    {ROLES.map((r) => (
                      <label
                        key={r.value}
                        className={cn(
                          'cursor-pointer rounded-md px-4 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                          field.value === r.value
                            ? 'bg-card font-medium shadow-card'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <input
                          type="radio"
                          name={field.name}
                          value={r.value}
                          checked={field.value === r.value}
                          onChange={() => field.onChange(r.value)}
                          className="sr-only"
                        />
                        {r.label}
                      </label>
                    ))}
                  </fieldset>
                </FormItem>
              )}
            />
          )}
          <StepFooter busy={form.formState.isSubmitting} />
        </form>
      </Form>
    </>
  );
}

export function LocationStep({ me, onSaved, onSkip }: StepProps) {
  const countries = useMemo(countryOptions, []);
  const { form, onSubmit, error } = useStepForm(
    locationSchema,
    { country: me.profile?.country ?? '', city: me.profile?.city ?? '', phone: me.phone ?? '' },
    onSaved,
    ({ phone, ...rest }) => ({ ...rest, ...(phone && { phone }) }),
  );

  return (
    <>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Where do you trade?</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Listings show your city, never your street.
      </p>
      <Form {...form}>
        <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
          <FormAlert>{error}</FormAlert>
          <div className="grid gap-5 sm:grid-cols-[1fr_0.8fr]">
            <FormField
              control={form.control}
              name="country"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Country</FormLabel>
                  <FormControl>
                    <NativeSelect autoComplete="country" {...field}>
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
                    <Input autoComplete="address-level2" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Phone <span className="font-normal text-muted-foreground">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="+254712345678"
                    {...field}
                  />
                </FormControl>
                <FormDescription>Kept private. Used later to verify your account.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <StepFooter busy={form.formState.isSubmitting} onSkip={onSkip} />
        </form>
      </Form>
    </>
  );
}

export function AboutStep({ me, onSaved, onSkip }: StepProps) {
  const p = me.profile;
  const { form, onSubmit, error } = useStepForm(
    aboutSchema,
    {
      bio: p?.bio ?? '',
      profession: p?.profession ?? '',
      company: p?.company ?? '',
      website: p?.website ?? '',
    },
    onSaved,
  );
  const bioLength = form.watch('bio')?.length ?? 0;

  return (
    <>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Tell buyers about yourself</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A line or two goes a long way — profiles with a bio get more replies.
      </p>
      <Form {...form}>
        <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
          <FormAlert>{error}</FormAlert>
          <FormField
            control={form.control}
            name="bio"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-baseline justify-between">
                  <FormLabel>Bio</FormLabel>
                  <span
                    className={cn(
                      'tabular text-xs text-muted-foreground',
                      bioLength > 500 && 'text-destructive',
                    )}
                  >
                    {bioLength}/500
                  </span>
                </div>
                <FormControl>
                  <Textarea
                    rows={4}
                    placeholder="What you sell, how you work, when you reply…"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="profession"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Profession</FormLabel>
                  <FormControl>
                    <Input autoComplete="organization-title" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="company"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business</FormLabel>
                  <FormControl>
                    <Input autoComplete="organization" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Website</FormLabel>
                <FormControl>
                  <Input type="url" inputMode="url" placeholder="https://" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <StepFooter busy={form.formState.isSubmitting} onSkip={onSkip} last />
        </form>
      </Form>
    </>
  );
}
