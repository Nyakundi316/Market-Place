'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UnreadCount } from '@/components/chat/unread-count';
import { cn } from '@/lib/utils';
import { isActive, NAV } from './nav-items';
import { t } from '@/i18n';

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('nav.main')}
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur lg:hidden"
    >
      <ul className="grid h-16 grid-cols-5">
        {NAV.map(({ href, label, icon: Icon, primary }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground',
                  active && 'font-medium text-foreground',
                )}
              >
                {active && !primary && (
                  <span
                    aria-hidden
                    className="absolute inset-x-5 top-0 h-0.5 rounded-b bg-foreground"
                  />
                )}
                {primary ? (
                  <span className="-mt-6 grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lift ring-4 ring-background">
                    <Icon className="size-5" strokeWidth={2.5} />
                  </span>
                ) : (
                  <span className="relative">
                    <Icon
                      className={cn('size-5', active && href === '/saved' && 'fill-current')}
                      strokeWidth={active ? 2.25 : 1.75}
                    />
                    {href === '/chat' && (
                      <UnreadCount variant="dot" className="absolute -right-0.5 -top-0.5" />
                    )}
                  </span>
                )}
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
