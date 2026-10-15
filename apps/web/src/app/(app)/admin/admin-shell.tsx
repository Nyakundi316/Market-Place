'use client';

import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/hooks/use-me';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { useAdminOverview } from '@/hooks/use-trust';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/reports', label: 'Reports', count: 'openReports' },
  { href: '/admin/disputes', label: 'Disputes', count: 'openDisputes' },
  { href: '/admin/verifications', label: 'Verifications', count: 'pendingVerifications' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/audit', label: 'Audit log' },
] as const;

/**
 * §6 /admin (role=admin). The API enforces the role on every call; this only
 * keeps non-admins from seeing an empty panel.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const ready = useRequireAuth();
  const { data: me } = useMe();
  const pathname = usePathname();
  const isAdmin = me?.user.role === 'admin';
  const overview = useAdminOverview();

  if (!ready || !me) return <Skeleton className="h-40 max-w-3xl" />;
  if (!isAdmin) {
    return (
      <div className="max-w-sm">
        <p className="flex items-center gap-2 font-medium">
          <ShieldAlert className="size-5 text-muted-foreground" aria-hidden /> Not available
        </p>
        <p className="mt-1 text-sm text-muted-foreground">This area is for the MarketHub team.</p>
      </div>
    );
  }

  return (
    <div className="animate-rise-in">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <nav
        aria-label="Admin sections"
        className="-mx-4 mt-4 flex gap-1 overflow-x-auto border-b px-4 [scrollbar-width:none]"
      >
        {TABS.map((t) => {
          const active = t.href === '/admin' ? pathname === t.href : pathname.startsWith(t.href);
          const n = 'count' in t ? overview.data?.[t.count] : undefined;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 text-sm',
                active
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {!!n && (
                <span className="tabular rounded-full bg-destructive/10 px-1.5 text-[11px] font-semibold text-destructive">
                  {n}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}
