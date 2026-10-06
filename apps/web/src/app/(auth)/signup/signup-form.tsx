'use client';

import { registerSchema } from '@markethub/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormAlert } from '@/components/auth/form-alert';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { PasswordInput } from '@/components/auth/password-input';
import { useAuthSubmit } from '@/components/auth/use-auth-submit';
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
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type SignupValues = z.input<typeof registerSchema>;

const ROLES = [
  { value: 'buyer', label: 'Buy', hint: 'Find and pay safely' },
  { value: 'seller', label: 'Sell', hint: 'Post and get paid' },
  { value: 'both', label: 'Both', hint: 'Do a bit of each' },
] as const;

export function SignupForm() {
  const params = useSearchParams();
  const form = useForm<SignupValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', role: 'buyer' },
  });
  const { onSubmit, error } = useAuthSubmit(form, (body) =>
    api('/auth/register', { method: 'POST', body, retryOn401: false }),
  );
  const loginHref = `/login${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Already trading here?{' '}
        <Link
          href={loginHref}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Log in
        </Link>
      </p>

      <div className="mt-8 space-y-6">
        <FormAlert>{error}</FormAlert>
        <OAuthButtons verb="Sign up" />

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel asChild>
                    <legend>I&apos;m here to</legend>
                  </FormLabel>
                  <fieldset className="grid grid-cols-3 gap-2">
                    {ROLES.map((r) => (
                      <label
                        key={r.value}
                        className={cn(
                          'cursor-pointer rounded-lg border bg-card px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                          field.value === r.value
                            ? 'border-primary bg-primary/5'
                            : 'hover:border-foreground/30',
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
                        <span className="block text-sm font-medium">{r.label}</span>
                        <span className="block text-[11px] leading-tight text-muted-foreground">
                          {r.hint}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <FormDescription>You can change this later.</FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" inputMode="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>
                    At least 8 characters. A short phrase works well.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              We&apos;ll email you a link to confirm your address.
            </p>
          </form>
        </Form>
      </div>
    </>
  );
}
