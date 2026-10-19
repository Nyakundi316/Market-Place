import { check, group, sleep } from 'k6';
import http from 'k6/http';
import { Trend } from 'k6/metrics';
import { API, auth, data, tokenFor } from './lib/env.js';
import { budget, limit, PEAK, steps } from './lib/ramp.js';

/**
 * Browsing as signed-in users: feed → search → listing → sometimes save it.
 * Each VU is a different seeded user, so per-user rate limits (100/min) are
 * exercised the way real traffic would, not tripped by one shared caller.
 * A VU makes roughly one request every 2 s, so 300 VUs ≈ 150 req/s.
 *
 *   k6 run -e API_URL=https://api.staging… -e JWT_ACCESS_SECRET=… load/listings.js
 *   … -e PEAK=300 load/listings.js     ramp until something breaks (lib/ramp.js)
 */
const fixed = [
  { duration: '1m', target: 50 },
  { duration: '3m', target: 50 },
  { duration: '1m', target: 150 },
  { duration: '3m', target: 150 },
  { duration: '1m', target: 0 },
];

export const options = {
  scenarios: __ENV.SMOKE
    ? { browse: { executor: 'per-vu-iterations', vus: 2, iterations: 1 } } // SMOKE=1: does it work at all
    : {
        browse: {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: PEAK ? steps(PEAK, __ENV.HOLD) : fixed,
          gracefulRampDown: '30s',
        },
      },
  thresholds: {
    http_req_failed: [limit('rate<0.01')],
    'http_req_duration{name:feed}': [limit(`p(95)<${budget(400)}`)],
    'http_req_duration{name:search}': [limit(`p(95)<${budget(600)}`)], // FTS + trigram
    'http_req_duration{name:listing}': [limit(`p(95)<${budget(300)}`)],
    checks: ['rate>0.99'],
  },
};

const searchResults = new Trend('search_results');

export default function () {
  const { users, listings, terms } = data();
  const me = users[(__VU - 1) % users.length];
  const as = auth(tokenFor(me));

  group('feed', () => {
    const res = http.get(`${API}/listings?sort=newest&limit=24`, { ...as, tags: { name: 'feed' } });
    check(res, { 'feed 200': (r) => r.status === 200 });
  });
  sleep(1 + Math.random() * 2);

  group('search', () => {
    const q = terms[Math.floor(Math.random() * terms.length)];
    const res = http.get(`${API}/listings?q=${q}&limit=24`, { ...as, tags: { name: 'search' } });
    check(res, { 'search 200': (r) => r.status === 200 });
    if (res.status === 200) searchResults.add(res.json('items').length);
  });
  sleep(1 + Math.random() * 2);

  group('listing', () => {
    const l = listings[Math.floor(Math.random() * listings.length)];
    const res = http.get(`${API}/listings/${l.slug}`, { ...as, tags: { name: 'listing' } });
    check(res, { 'listing 200': (r) => r.status === 200 });
    // One visitor in ten saves it, then changes their mind: a write path under load.
    // Never their own listing: that 400 is correct, but http_req_failed would count it
    // and a ramp run would stop on it.
    if (res.status === 200 && l.sellerId !== me && Math.random() < 0.1) {
      const id = res.json('id');
      check(
        http.post(`${API}/listings/${id}/favorite`, null, { ...as, tags: { name: 'favorite' } }),
        { 'favorite ok': (r) => r.status < 300 },
      );
      http.del(`${API}/listings/${id}/favorite`, null, { ...as, tags: { name: 'favorite' } });
    }
  });
  sleep(2 + Math.random() * 3);
}
