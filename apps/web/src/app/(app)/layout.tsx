import { RealtimeBridge } from '@/components/chat/realtime-bridge';
import { BottomNav } from '@/components/shell/bottom-nav';
import { TopBar } from '@/components/shell/top-bar';
import { t } from '@/i18n';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow-lift"
      >
        {t('nav.skipToContent')}
      </a>
      <TopBar />

      {/* Bottom padding clears the fixed mobile nav. */}
      <main
        id="main"
        className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 lg:px-8 lg:pb-12 lg:pt-8"
      >
        {children}
      </main>

      <BottomNav />
      <RealtimeBridge />
    </div>
  );
}
