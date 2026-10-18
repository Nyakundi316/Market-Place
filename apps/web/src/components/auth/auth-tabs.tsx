import Link from 'next/link';
import { cn } from '@/lib/utils';

/** The Sign up / Log in switch on top of the auth card. Real links, so `next` rides along. */
export function AuthTabs({ current, next }: { current: 'signup' | 'login'; next: string | null }) {
  const query = next ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <nav aria-label="Sign up or log in" className="grid grid-cols-2 rounded-full bg-muted p-1">
      {(['signup', 'login'] as const).map((tab) => (
        <Link
          key={tab}
          href={`/${tab}${query}`}
          replace
          aria-current={tab === current ? 'page' : undefined}
          className={cn(
            'grid h-9 place-items-center rounded-full text-sm font-medium transition-colors',
            tab === current
              ? 'bg-card text-foreground shadow-card'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab === 'signup' ? 'Sign up' : 'Log in'}
        </Link>
      ))}
    </nav>
  );
}
