'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AccountMenu } from './account-menu';
import { isActive, NAV } from './nav-items';
import { Wordmark } from './wordmark';

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-card/60 px-3 py-5 lg:flex">
      <Wordmark className="px-3" />

      <Button asChild className="mx-1 mt-7 justify-start gap-2 shadow-lift">
        <Link href="/create">
          <Plus className="size-4" /> Sell something
        </Link>
      </Button>

      <nav aria-label="Main" className="mt-6 flex flex-col gap-0.5">
        {NAV.filter((n) => !n.primary).map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                active && 'bg-accent font-medium text-foreground',
              )}
            >
              {active && <span className="absolute inset-y-2 -left-3 w-1 rounded-r bg-primary" />}
              <Icon className="size-[18px]" strokeWidth={active ? 2.25 : 1.75} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t pt-3">
        <AccountMenu />
      </div>
    </aside>
  );
}
