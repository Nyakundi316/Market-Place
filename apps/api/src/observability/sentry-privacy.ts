import type { NodeOptions } from '@sentry/node';

/**
 * What error reports may carry (§9). Sentry 11 collects user info, cookies,
 * headers and request/response bodies by default; here bodies can hold
 * passwords, card-adjacent payment data and private chat, so everything is
 * off except a few headers that help debugging and say nothing about anyone.
 */
export const SENTRY_DATA_COLLECTION: NonNullable<NodeOptions['dataCollection']> = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { allow: ['user-agent', 'content-type', 'x-request-id'] },
    response: false,
  },
  httpBodies: [],
  urlQueryParams: false,
};
