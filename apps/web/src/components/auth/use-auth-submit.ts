'use client';

import type { AuthResponseDto } from '@markethub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { ApiError } from '@/lib/api';
import { afterAuth } from '@/lib/redirect';
import { useAuth } from '@/stores/auth';

/**
 * Shared by login/signup: maps API field errors onto the form, stores the
 * session, then routes (onboarding first if the profile isn't set up).
 */
export function useAuthSubmit<T extends FieldValues>(
  form: UseFormReturn<T>,
  call: (v: T) => Promise<AuthResponseDto>,
) {
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const next = useSearchParams().get('next');
  const queryClient = useQueryClient();

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const session = await call(values);
      useAuth.getState().setSession(session);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      router.replace(afterAuth(session.user.hasProfile, next));
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        for (const [field, messages] of Object.entries(err.fields)) {
          form.setError(field as Path<T>, { message: messages[0] });
        }
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Network problem — check your connection and try again.',
        );
      }
    }
  });

  return { onSubmit, error };
}
