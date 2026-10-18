'use client';

import { type MeDto, type UpdateProfileInput, updateProfileSchema } from '@markethub/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormAlert } from '@/components/auth/form-alert';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Button } from '@/components/ui/button';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { meKey, useMe } from '@/hooks/use-me';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { api, ApiError } from '@/lib/api';
import { countryOptions } from '@/lib/countries';
import { applyApiErrors } from '@/lib/form-errors';
import { NotificationsSection } from './notifications-section';
import { PayoutsSection } from './payouts-section';
import { VerificationSection } from './verification-section';
import { ACCEPTED_IMAGES, uploadAvatar } from '@/lib/images';
import { useAuth } from '@/stores/auth';

const f = updateProfileSchema.required().shape;
// Every field is editable here; empty optional strings are allowed and mean "clear".
const settingsSchema = z.object({
  displayName: f.displayName,
  username: f.username,
  bio: f.bio,
  profession: f.profession,
  company: f.company,
  website: f.website,
  country: f.country.or(z.literal('')),
  city: f.city,
  phone: f.phone.or(z.literal('')),
  role: f.role,
});
type Values = z.input<typeof settingsSchema>;

function AvatarPicker({ me }: { me: MeDto }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const name = me.profile?.displayName ?? me.user.email;

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadAvatar(file);
      qc.setQueryData(meKey, await api<MeDto>('/me/avatar', { method: 'POST', body: { url } }));
      toast.success('Photo updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Upload failed — try another photo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="group relative rounded-full"
        aria-label="Change profile photo"
        disabled={busy}
      >
        <ProfileAvatar name={name} src={me.profile?.avatarUrl} className="size-20 text-lg" />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-foreground/50 text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? <LoaderCircle className="size-5 animate-spin" /> : <Camera className="size-5" />}
        </span>
      </button>
      <div className="text-sm">
        <p className="font-medium">Profile photo</p>
        <p className="text-muted-foreground">A clear face or shop logo builds trust.</p>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_IMAGES}
        aria-label="Choose profile photo"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function SettingsForm({ me }: { me: MeDto }) {
  const qc = useQueryClient();
  const countries = useMemo(countryOptions, []);
  const [error, setError] = useState<string | null>(null);
  const p = me.profile;
  const defaults: Values = {
    displayName: p?.displayName ?? '',
    username: p?.username ?? '',
    bio: p?.bio ?? '',
    profession: p?.profession ?? '',
    company: p?.company ?? '',
    website: p?.website ?? '',
    country: p?.country ?? '',
    city: p?.city ?? '',
    phone: me.phone ?? '',
    role: me.user.role === 'admin' ? 'both' : me.user.role,
  };
  const form = useForm<Values>({ resolver: zodResolver(settingsSchema), defaultValues: defaults });
  useEffect(() => form.reset(defaults), [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    // Send only what changed; the API treats a PATCH as a partial update.
    const dirty = form.formState.dirtyFields as Partial<Record<keyof Values, boolean>>;
    const body: UpdateProfileInput = {};
    for (const k of Object.keys(dirty) as (keyof Values)[]) {
      if (!dirty[k] || (k === 'role' && me.user.role === 'admin')) continue;
      const v = values[k];
      if ((k === 'phone' || k === 'country') && !v) continue; // can't be cleared, only changed
      (body as Record<string, unknown>)[k] = v;
    }
    if (!Object.keys(body).length) return;
    try {
      const updated = await api<MeDto>('/me', { method: 'PATCH', body });
      qc.setQueryData(meKey, updated);
      useAuth.getState().setUser(updated.user);
      toast.success('Profile saved');
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  });

  const text = (name: keyof Values, label: string, props: React.ComponentProps<'input'> = {}) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...props} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-10">
        <FormAlert>{error}</FormAlert>

        <section className="space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Public profile
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {text('displayName', 'Display name', { autoComplete: 'name' })}
            {text('username', 'Username', { autoCapitalize: 'none', spellCheck: false })}
          </div>
          <FormField
            control={form.control}
            name="bio"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bio</FormLabel>
                <FormControl>
                  <Textarea rows={4} maxLength={500} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            {text('profession', 'Profession')}
            {text('company', 'Business')}
          </div>
          {text('website', 'Website', { type: 'url', placeholder: 'https://' })}
        </section>

        <section className="space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Location & contact
          </h2>
          <div className="grid gap-5 sm:grid-cols-[1fr_0.8fr]">
            <FormField
              control={form.control}
              name="country"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Country</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      <option value="">Choose…</option>
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
            {text('city', 'City or town')}
          </div>
          <div className="space-y-1.5">
            {text('phone', 'Phone', {
              type: 'tel',
              inputMode: 'tel',
              placeholder: '+254712345678',
            })}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {me.user.isPhoneVerified ? (
                <>
                  <CircleCheck className="size-3.5 text-primary" /> Verified · changing it needs
                  re-verification
                </>
              ) : (
                <>
                  <CircleAlert className="size-3.5" /> Not verified yet
                </>
              )}
            </p>
          </div>
        </section>

        {me.user.role !== 'admin' && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Account type
            </h2>
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <NativeSelect {...field} aria-label="Account type" className="max-w-xs">
                  <option value="buyer">Buying only</option>
                  <option value="seller">Selling only</option>
                  <option value="both">Buying and selling</option>
                </NativeSelect>
              )}
            />
          </section>
        )}

        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:p-0">
          <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
            {form.formState.isSubmitting ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export function SettingsView() {
  const ready = useRequireAuth();
  const { data: me } = useMe();
  return (
    <div className="max-w-xl animate-rise-in">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {!ready || !me ? (
        <div className="mt-8 space-y-4">
          <Skeleton className="size-20 rounded-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {me.user.email}
            {!me.user.isEmailVerified && ' · email not confirmed yet'}
          </p>
          <div className="mt-8 space-y-10">
            {me.profile && <AvatarPicker me={me} />}
            <SettingsForm me={me} />
            <NotificationsSection />
            {me.profile && <VerificationSection emailVerified={me.user.isEmailVerified} />}
            {me.profile && <PayoutsSection />}
          </div>
        </>
      )}
    </div>
  );
}
