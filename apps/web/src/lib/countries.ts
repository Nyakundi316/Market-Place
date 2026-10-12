import { COUNTRY_CODES } from '@markethub/shared';

let cached: { code: string; name: string }[] | null = null;

/** Country options sorted by display name in the user's locale. */
export function countryOptions() {
  if (cached) return cached;
  const names = new Intl.DisplayNames(undefined, { type: 'region' });
  cached = COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return cached;
}

export const countryName = (code: string | null | undefined) =>
  code ? (new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code) : '';
