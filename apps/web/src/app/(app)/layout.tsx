import { RealtimeBridge } from '@/components/chat/realtime-bridge';
import { AccountMenu } from '@/components/shell/account-menu';
import { BottomNav } from '@/components/shell/bottom-nav';
import { Sidebar } from '@/components/shell/sidebar';
import { Wordmark } from '@/components/shell/wordmark';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow-lift"
      >
        Skip to content
      </a>
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/90 px-4 backdrop-blur lg:hidden">
          <Wordmark />
          <AccountMenu compact />
        </header>

        {/* Bottom padding clears the fixed mobile nav. Content hugs left on desktop, capped for line length. */}
        <main
          id="main"
          className="w-full max-w-5xl flex-1 px-4 pb-28 pt-5 lg:px-10 lg:pb-12 lg:pt-8"
        >
          {children}
        </main>
      </div>

      <BottomNav />
      <RealtimeBridge />
    </div>
  );
}
