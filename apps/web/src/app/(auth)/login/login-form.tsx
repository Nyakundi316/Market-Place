'use client';

import { type LoginInput, loginSchema } from '@markethub/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { FormAlert } from '@/components/auth/form-alert';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { PasswordInput } from '@/components/auth/password-input';
import { useAuthSubmit } from '@/components/auth/use-auth-submit';
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
import { api } from '@/lib/api';

// Codes the OAuth callback redirects back with.
const REDIRECT_ERRORS: Record<string, string> = {
  oauth_failed: "Sign-in didn't finish. Please try again.",
  oauth_no_verified_email:
    "That account doesn't have a verified email. Verify it with the provider, or sign up with email.",
  account_suspended:
    'This account has been suspended. Contact support if you think this is a mistake.',
  session_expired: 'Your session expired. Please log in again.',
};

export function LoginForm() {
  const params = useSearchParams();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { onSubmit, error } = useAuthSubmit(form, (body) =>
    api('/auth/login', { method: 'POST', body, retryOn401: false }),
  );
  const redirectError = REDIRECT_ERRORS[params.get('error') ?? ''];
  const signupHref = `/signup${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        New here?{' '}
        <Link
          href={signupHref}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>

      <div className="mt-8 space-y-6">
        <FormAlert>{error ?? redirectError}</FormAlert>
        <OAuthButtons verb="Continue" />

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
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
                  <div className="flex items-baseline justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link
                      href="/forgot-password"
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <PasswordInput autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Logging in…' : 'Log in'}
            </Button>
          </form>
        </Form>
      </div>
    </>
  );
}
