import { describe, expect, it } from 'vitest';
import { pushEndpointSchema, pushSubscriptionSchema } from './notifications';

// Shape of a real Chrome subscription (keys are random, not a live device).
const browser = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/dXk2b3RhOmFQQTkxYkg',
  expirationTime: null,
  keys: {
    p256dh:
      'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
    auth: 'tBHItJI5svbpez7KI4CCXg',
  },
};

describe('push schemas', () => {
  it('takes what the browser sends and keeps only what sending needs', () => {
    expect(pushSubscriptionSchema.parse(browser)).toEqual({
      endpoint: browser.endpoint,
      keys: browser.keys,
    });
  });

  it('rejects plain-http endpoints and keys that aren’t base64url', () => {
    expect(
      pushSubscriptionSchema.safeParse({ ...browser, endpoint: 'http://push.example/abc' }).success,
    ).toBe(false);
    expect(
      pushSubscriptionSchema.safeParse({ ...browser, keys: { ...browser.keys, auth: 'a b' } })
        .success,
    ).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: browser.endpoint }).success).toBe(false);
  });

  it('unsubscribing needs just the endpoint', () => {
    expect(pushEndpointSchema.safeParse({ endpoint: browser.endpoint }).success).toBe(true);
    expect(pushEndpointSchema.safeParse({ endpoint: 'nope' }).success).toBe(false);
  });
});
