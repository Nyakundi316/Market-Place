/*
 * MarketHub service worker (§10 Phase 7 PWA). Deliberately small:
 *  - hashed build assets (/_next/static) and icons: cache-first, they never change;
 *  - page navigations: network-first, the offline page if the network is gone;
 *  - everything else (/api, sockets, signed-in data, uploads): not touched, so
 *    nothing personal is ever cached on the device.
 * Bump VERSION to drop old caches.
 */
const VERSION = 'v1';
const STATIC = `mh-static-${VERSION}`;
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/icons/192'];

// Best effort: a precache that fails (slow first icon render, a flaky disk cache)
// must not stop the whole worker installing.
const precache = () =>
  caches
    .open(STATIC)
    .then((cache) =>
      Promise.all(PRECACHE.map((url) => cache.match(url).then((hit) => hit || cache.add(url)))),
    )
    .catch(() => undefined);

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC).map((k) => caches.delete(k))))
      .then(precache) // second chance for anything install couldn't fetch
      .then(() => self.clients.claim()),
  );
});

const isStaticAsset = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/'));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches
                .open(STATIC)
                .then((cache) => cache.put(request, copy))
                .catch(() => undefined); // a missed cache write just means a network hit next time
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: always fresh from the network; only the offline page as a fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((page) => page || Response.error()),
      ),
    );
  }
});
