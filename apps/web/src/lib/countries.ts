import { COUNTRY_CODES } from '@markethub/shared';

/**
 * Names are server-rendered and then hydrated, so they must come out the same in
 * Node and every browser. Fixed locale (the UI is English) plus overrides where
 * ICU builds disagree — e.g. Node says "Hong Kong SAR China", Chrome "Hong Kong".
 */
const LOCALE = 'en';
const OVERRIDES: Record<string, string> = {
  FK: 'Falkland Islands',
  HK: 'Hong Kong',
  MO: 'Macao',
  PS: 'Palestine',
};

let names: Intl.DisplayNames | null = null;
let cached: { code: string; name: string }[] | null = null;

export const countryName = (code: string | null | undefined) => {
  if (!code) return '';
  names ??= new Intl.DisplayNames(LOCALE, { type: 'region' });
  return OVERRIDES[code] ?? names.of(code) ?? code;
};

/** Country options sorted by display name. */
export function countryOptions() {
  cached ??= COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name, LOCALE),
  );
  return cached;
}
