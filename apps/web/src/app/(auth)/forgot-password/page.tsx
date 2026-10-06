'use client';

import { type ForgotPasswordInput, forgotPasswordSchema } from '@markethub/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormAlert } from '@/components/auth/form-alert';
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
import { api, ApiError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (body) => {
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body, retryOn401: false });
      setSentTo(body.email);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network problem — try again.');
    }
  });

  if (sentTo) {
    // Same message whether or not the account exists (the API doesn't tell us either).
    return (
      <div className="animate-rise-in">
        <MailCheck className="size-10 text-primary" strokeWidth={1.5} />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          If <span className="font-medium text-foreground">{sentTo}</span> has a MarketHub account,
          a reset link is on its way. It expires in 1 hour.
        </p>
        <Button asChild variant="outline" className="mt-8">
          <Link href="/login">Back to log in</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your email and we&apos;ll send you a link to choose a new one.
      </p>
      <Form {...form}>
        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          <FormAlert>{error}</FormAlert>
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
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
          <p className="text-center text-sm">
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              Remembered it? Log in
            </Link>
          </p>
        </form>
      </Form>
    </>
  );
}
