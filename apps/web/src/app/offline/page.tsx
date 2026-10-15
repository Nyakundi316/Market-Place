import { WifiOff } from 'lucide-react';
import type { Metadata } from 'next';
import { Wordmark } from '@/components/shell/wordmark';
import { t } from '@/i18n';

export const metadata: Metadata = { title: 'Offline', robots: { index: false } };
export const dynamic = 'force-static';

/** Served by the service worker when a page can't be reached. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <Wordmark />
      <WifiOff className="mt-10 size-8 text-muted-foreground" aria-hidden />
      <h1 className="mt-3 text-xl font-semibold">{t('offline.title')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('offline.body')}</p>
      <a
        href="/feed"
        className="mt-6 inline-flex h-10 w-fit items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        {t('offline.retry')}
      </a>
    </main>
  );
}
