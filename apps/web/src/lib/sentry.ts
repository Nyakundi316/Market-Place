/**
 * Shared Sentry options for the web app (server and browser). Off unless a
 * DSN is set. Like the API, nothing personal goes out with an error (§9):
 * no user info, cookies, headers, bodies or query strings — search terms and
 * chat text included.
 */
export const sentryOptions = (dsn: string) => ({
  dsn,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_GIT_SHA,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
  },
});
