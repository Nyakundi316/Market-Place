/*
 * MarketHub service worker (§10 Phase 7 PWA). Deliberately small:
 *  - hashed build assets (/_next/static) and icons: cache-first, they never change;
 *  - page navigations: network-first, the offline page if the network is gone;
 *  - everything else (/api, sockets, signed-in data, uploads): not touched, so
 *    nothing personal is ever cached on the device;
 *  - Web Push: shows what the API sends (title, body, app-relative link, tag) and
 *    opens the link on click. Pushes only arrive while no tab holds a live socket.
 * Bump VERSION to drop old caches.
 */
const VERSION = 'v1';
const STATIC = `mh-static-${VERSION}`;
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/icons/192'];

// Best effort: a precache that fails (slow first icon render, a flaky disk cache)
// must not stop the whole worker installing, push included.
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

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // not JSON: show the generic notice below
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'MarketHub', {
      body: data.body || '',
      icon: '/icons/192',
      // A newer message in the same chat replaces the older one instead of stacking.
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { link: data.link || '/feed' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.link || '/feed', self.location.origin);
  // Only ever our own pages, whatever the payload says.
  const target = url.origin === self.location.origin ? url.href : self.location.origin;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const exact = windows.find((w) => w.url === target);
      if (exact) return exact.focus();
      const ours = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (ours) return ours.focus().then((w) => (w ? w.navigate(target) : undefined));
      return self.clients.openWindow(target);
    }),
  );
});
