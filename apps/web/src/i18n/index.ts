import { en } from './messages/en';

/** Same keys as English, any wording. */
type Shape<T> = { readonly [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type Messages = Shape<typeof en>;

export const LOCALES = { en } satisfies Record<string, Messages>;
export type Locale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: Locale = 'en';

/** "nav.discover" | "notifications.unread" | … */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;

type Params = Record<string, string | number>;

export function translate(messages: Messages, key: MessageKey, params?: Params): string {
  let node: unknown = messages;
  for (const part of key.split('.')) node = (node as Record<string, unknown>)?.[part];
  if (typeof node !== 'string') return key; // a missing key shows itself instead of crashing
  return params
    ? node.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in params ? String(params[name]) : whole,
      )
    : node;
}

/**
 * The app ships English only for now, so t() reads it directly and works in
 * server and client components alike. Adding a locale means choosing it per
 * request (cookie or Accept-Language) and passing the catalogue down.
 */
export const t = (key: MessageKey, params?: Params) =>
  translate(LOCALES[DEFAULT_LOCALE], key, params);
