import { describe, expect, it } from 'vitest';
import { afterAuth, safeNext } from './redirect';

describe('safeNext', () => {
  it.each(['/chat/123', '/orders/ORD-2026-000001?tab=timeline'])('keeps %s', (p) =>
    expect(safeNext(p)).toBe(p),
  );
  it.each(['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '', null])(
    'rejects %s',
    (p) => expect(safeNext(p)).toBe('/feed'),
  );
});

describe('afterAuth', () => {
  it('sends unfinished profiles to onboarding, preserving next', () => {
    expect(afterAuth(false, '/chat')).toBe('/onboarding?next=%2Fchat');
    expect(afterAuth(false, null)).toBe('/onboarding');
    expect(afterAuth(true, '/chat')).toBe('/chat');
  });
});
