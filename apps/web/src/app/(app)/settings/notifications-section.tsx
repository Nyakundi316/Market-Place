'use client';

import { useQuery } from '@tanstack/react-query';
import { BellOff, BellRing, Loader2, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  currentPushSubscription,
  forgetPushDevice,
  pushConfig,
  type PushSupport,
  pushSupport,
  subscribeThisDevice,
} from '@/lib/push';

type Device = 'checking' | 'on' | 'off' | 'blocked';

/** Push on this device. In-app and email need no setup, so they're only described. */
export function NotificationsSection() {
  const config = useQuery({ queryKey: ['push-config'], queryFn: pushConfig, staleTime: Infinity });
  // Browser-only facts: read after mount so the server render and hydration agree.
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [device, setDevice] = useState<Device>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = pushSupport();
    setSupport(s);
    if (s !== 'ok') return;
    if (Notification.permission === 'denied') return setDevice('blocked');
    void currentPushSubscription().then((sub) => setDevice(sub ? 'on' : 'off'));
  }, []);

  async function turnOn(publicKey: string) {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return setDevice(permission === 'denied' ? 'blocked' : 'off');
      await subscribeThisDevice(publicKey);
      setDevice('on');
      toast.success('Notifications are on for this device');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t turn notifications on');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    await forgetPushDevice();
    setBusy(false);
    setDevice('off');
  }

  const publicKey = config.data?.publicKey;
  let body: React.ReactNode;
  if (!support || config.isPending || (support === 'ok' && device === 'checking')) {
    body = <Skeleton className="h-10 w-full" />;
  } else if (support === 'ios-browser') {
    body = (
      <p className="text-sm text-muted-foreground">
        On iPhone and iPad, tap <span className="font-medium text-foreground">Share</span> →{' '}
        <span className="font-medium text-foreground">Add to Home Screen</span>, open MarketHub from
        there and switch this on.
      </p>
    );
  } else if (support === 'unsupported') {
    body = <p className="text-sm text-muted-foreground">This browser can’t show notifications.</p>;
  } else if (!publicKey) {
    body = <p className="text-sm text-muted-foreground">Not switched on yet.</p>;
  } else if (device === 'blocked') {
    body = (
      <p className="text-sm text-muted-foreground">
        Blocked for MarketHub in this browser. Allow notifications in the site settings (the icon
        beside the address), then reload.
      </p>
    );
  } else {
    const on = device === 'on';
    body = (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">
          {on
            ? 'On. Messages, offers and order updates reach this device while MarketHub is closed.'
            : 'Get messages, offers and order updates on this device while MarketHub is closed.'}
        </p>
        <Button
          variant={on ? 'outline' : 'default'}
          size="sm"
          disabled={busy}
          onClick={() => void (on ? turnOff() : turnOn(publicKey))}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : on ? (
            <BellOff className="size-4" />
          ) : (
            <BellRing className="size-4" />
          )}
          {on ? 'Turn off' : 'Turn on'}
        </Button>
      </div>
    );
  }

  return (
    <section id="notifications" className="scroll-mt-20">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Notifications
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything shows up under the bell, and by email when you’re away.
      </p>
      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 rounded-lg border bg-card p-4">
        <Smartphone className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-medium">Push on this device</h3>
          {body}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </section>
  );
}
