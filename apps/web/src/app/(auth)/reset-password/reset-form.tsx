'use client';

import { passwordSchema } from '@markethub/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormAlert } from '@/components/auth/form-alert';
import { PasswordInput } from '@/components/auth/password-input';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: "Passwords don't match" });

export function ResetForm() {
  const token = useSearchParams().get('token');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  if (!token) {
    return (
      <FormAlert>
        This reset link is incomplete.{' '}
        <Link href="/forgot-password" className="underline">
          Request a new one
        </Link>
        .
      </FormAlert>
    );
  }

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { token, password },
        retryOn401: false,
      });
      toast.success('Password updated. Log in with your new password.');
      router.replace('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network problem — try again.');
    }
  });

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        You&apos;ll be signed out on every other device.
      </p>
      <Form {...form}>
        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          <FormAlert>
            {error}
            {error && (
              <>
                {' '}
                <Link href="/forgot-password" className="underline">
                  Get a new link
                </Link>
              </>
            )}
          </FormAlert>
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving…' : 'Update password'}
          </Button>
        </form>
      </Form>
    </>
  );
}
