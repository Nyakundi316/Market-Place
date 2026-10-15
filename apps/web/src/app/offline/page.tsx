import { WifiOff } from 'lucide-react';
import type { Metadata } from 'next';
import { Wordmark } from '@/components/shell/wordmark';

export const metadata: Metadata = { title: 'Offline', robots: { index: false } };
export const dynamic = 'force-static';

/** Served by the service worker when a page can't be reached. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <Wordmark />
      <WifiOff className="mt-10 size-8 text-muted-foreground" aria-hidden />
      <h1 className="mt-3 text-xl font-semibold">You&apos;re offline</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        MarketHub needs a connection for chats, offers and payments. We&apos;ll pick up where you
        left off as soon as you&apos;re back.
      </p>
      <a
        href="/feed"
        className="mt-6 inline-flex h-10 w-fit items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        Try again
      </a>
    </main>
  );
}
