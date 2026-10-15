import { describe, expect, it } from 'vitest';
import { LOCALES, type Messages, t, translate } from '.';

describe('i18n', () => {
  it('reads nested keys and fills parameters', () => {
    expect(t('nav.discover')).toBe('Discover');
    expect(t('notifications.unread', { count: 3 })).toBe('Notifications, 3 unread');
  });

  it('leaves unknown parameters visible and shows missing keys as themselves', () => {
    expect(t('notifications.unread')).toBe('Notifications, {count} unread');
    const partial = { ...LOCALES.en, nav: {} } as unknown as Messages;
    expect(translate(partial, 'nav.discover')).toBe('nav.discover');
  });

  it('every locale has every English key', () => {
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'string' ? [`${p}${k}`] : keys(v as object, `${p}${k}.`),
      );
    const english = keys(LOCALES.en).sort();
    for (const messages of Object.values(LOCALES)) expect(keys(messages).sort()).toEqual(english);
  });
});
