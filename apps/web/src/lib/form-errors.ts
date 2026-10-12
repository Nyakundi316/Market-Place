import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { ApiError } from './api';

/**
 * Puts API field errors on their inputs and returns a banner message for
 * anything that isn't field-shaped (or null when every error found a home).
 */
export function applyApiErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  err: unknown,
): string | null {
  if (!(err instanceof ApiError)) return 'Network problem — check your connection and try again.';
  if (!err.fields) return err.message;

  const known = new Set(Object.keys(form.getValues()));
  let orphan: string | null = null;
  for (const [field, messages] of Object.entries(err.fields)) {
    if (known.has(field)) form.setError(field as Path<T>, { message: messages[0] });
    else orphan ??= messages[0] ?? err.message;
  }
  return orphan;
}
