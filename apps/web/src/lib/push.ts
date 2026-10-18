import type { PushConfigDto } from '@markethub/shared';
import { api } from '@/lib/api';

export type PushSupport = 'ok' | 'ios-browser' | 'unsupported';

/**
 * iOS only exposes PushManager to web apps added to the Home Screen (16.4+), so
 * Safari tabs get a hint instead of a dead switch.
 */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)
    return 'ok';
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return ios && !matchMedia('(display-mode: standalone)').matches ? 'ios-browser' : 'unsupported';
}

/**
 * The worker registers itself from the root layout (production builds only), so
 * on a first visit it can still be on its way. Null if it never shows up.
 */
export async function workerRegistration(waitMs = 10_000) {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), waitMs)),
  ]);
}

export async function currentPushSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  return (await reg?.pushManager?.getSubscription().catch(() => null)) ?? null;
}

// PushManager wants the VAPID key as raw bytes, not base64url.
export function keyBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export const pushConfig = () => api<PushConfigDto>('/push/config');

export async function subscribeThisDevice(publicKey: string) {
  const reg = await workerRegistration();
  if (!reg)
    throw new Error('This browser hasn’t finished setting up MarketHub yet. Reload and try again.');
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  await api('/me/push-subscriptions', { method: 'POST', body: sub.toJSON() });
  return sub;
}

/**
 * Whoever is signed in owns this device's subscription. Re-registering it moves it
 * off a previous account (a shared device whose last session lapsed without a sign-out)
 * and restores a row the server dropped. Never throws.
 */
export async function claimPushDevice() {
  const sub = await currentPushSubscription();
  if (sub) {
    await api('/me/push-subscriptions', { method: 'POST', body: sub.toJSON() }).catch(
      () => undefined,
    );
  }
}

/** Turns push off for this device, both at the push service and on our side. Never throws. */
export async function forgetPushDevice() {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await api('/me/push-subscriptions', {
    method: 'DELETE',
    body: { endpoint: sub.endpoint },
    retryOn401: false,
  }).catch(() => undefined); // if this fails, the push service's 410 cleans our row up later
  await sub.unsubscribe().catch(() => undefined);
}
