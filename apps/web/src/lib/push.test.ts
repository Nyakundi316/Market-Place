import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyBytes, pushSupport } from './push';

afterEach(() => vi.unstubAllGlobals());

describe('keyBytes', () => {
  it('decodes unpadded base64url into the raw key bytes', () => {
    const raw = Uint8Array.from({ length: 65 }, (_, i) => (i * 37 + 251) % 256);
    const b64url = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(b64url).toMatch(/[-_]/); // exercises both substitutions
    expect(keyBytes(b64url)).toEqual(raw);
  });
});

describe('pushSupport', () => {
  it('points iPhone Safari tabs at Add to Home Screen instead of a dead switch', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1',
    });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(pushSupport()).toBe('ios-browser');
  });

  it('says plainly when a desktop browser has no push', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    expect(pushSupport()).toBe('unsupported');
  });
});
