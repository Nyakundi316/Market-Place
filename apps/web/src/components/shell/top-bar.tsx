'use client';

import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { UnreadCount } from '@/components/chat/unread-count';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AccountMenu } from './account-menu';
import { NotificationBell } from './notification-bell';
import { isActive, NAV } from './nav-items';
import { Wordmark } from './wordmark';
import { t } from '@/i18n';

/** Desktop types straight into the bar; on a phone the pill opens the full search screen. */
function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  return (
    <>
      <Link
        href="/search"
        className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-full border bg-card px-3 text-[13px] text-muted-foreground lg:hidden"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{t('nav.search')}</span>
      </Link>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const term = q.trim();
          router.push(term ? `/search?q=${encodeURIComponent(term)}` : '/search');
          setQ('');
        }}
        className="relative hidden w-full max-w-sm lg:block xl:max-w-md"
      >
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          enterKeyHint="search"
          aria-label={t('nav.search')}
          placeholder={t('nav.searchHint')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
          className="h-10 w-full text-ellipsis rounded-full border bg-card pl-10 pr-4 text-sm transition-colors placeholder:text-muted-foreground hover:border-foreground/25 [&::-webkit-search-cancel-button]:hidden"
        />
      </form>
    </>
  );
}

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2.5 px-4 lg:h-16 lg:gap-8 lg:px-8">
        <Wordmark className="shrink-0" />
        {/* /search has its own big input; a second one up here would just compete. */}
        {pathname === '/search' ? <span className="flex-1" /> : <HeaderSearch />}

        <nav aria-label={t('nav.main')} className="hidden self-stretch lg:ml-auto lg:flex">
          {NAV.filter((n) => !n.primary).map(({ href, label }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 text-sm text-muted-foreground transition-colors hover:text-foreground',
                  active && 'border-foreground font-medium text-foreground',
                )}
              >
                {label}
                {href === '/chat' && <UnreadCount variant="count" />}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1 lg:gap-2">
          <Button asChild size="sm" className="mr-2 hidden gap-1.5 lg:inline-flex">
            <Link href="/create">
              <Plus /> {t('nav.sellSomething')}
            </Link>
          </Button>
          <NotificationBell />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
