/**
 * Ramp-to-break mode, shared by both scripts. With PEAK set, load climbs in
 * fifths of PEAK (30 s up, 2 min held at each step) and the thresholds abort
 * the run at the first step that breaks one. The summary's `vus` max is then
 * roughly the level the system held. Without PEAK the scripts keep their fixed
 * profiles, and thresholds only grade the run.
 */
export const PEAK = Number(__ENV.PEAK || 0);

/**
 * The load machine's round trip to the API, in ms (the Load test workflow
 * measures it). GitHub's runners are far from jnb, and that distance isn't the
 * system's fault, so latency budgets get it added: once per request/ack, more
 * for a fresh connection (TCP + TLS + upgrade).
 */
const RTT = Number(__ENV.RTT_MS || 0);
export const budget = (ms, trips = 1) => ms + trips * RTT;

/** `hold` (HOLD) is for quick local checks; staging runs keep the 2 min default. */
export function steps(peak, hold = '2m') {
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const target = Math.max(2, Math.round((peak * i) / 5 / 2) * 2); // even: chat pairs VUs
    out.push({ duration: '30s', target }, { duration: hold, target });
  }
  out.push({ duration: '30s', target: 0 });
  return out;
}

/**
 * In ramp mode a broken threshold ends the run. Judging starts after a minute, past
 * the first step's warm-up (fresh TLS, cold caches), where a handful of samples
 * would otherwise decide p95 on their own.
 */
export const limit = (expr) =>
  PEAK ? { threshold: expr, abortOnFail: true, delayAbortEval: '1m' } : expr;
