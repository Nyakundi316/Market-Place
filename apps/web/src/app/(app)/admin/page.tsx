'use client';

import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminOverview } from '@/hooks/use-trust';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function AdminOverviewPage() {
  const { data: o } = useAdminOverview();
  if (!o) return <Skeleton className="h-48 max-w-3xl" />;

  const queues = [
    { label: 'Open reports', n: o.openReports, href: '/admin/reports' },
    { label: 'Disputes', n: o.openDisputes, href: '/admin/disputes' },
    { label: 'Verifications waiting', n: o.pendingVerifications, href: '/admin/verifications' },
  ];
  return (
    <div className="grid max-w-4xl gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section aria-labelledby="queues">
        <h2 id="queues" className="text-sm font-semibold">
          Needs attention
        </h2>
        <ul className="mt-3 divide-y rounded-xl border bg-card">
          {queues.map((q) => (
            <li key={q.href}>
              <Link
                href={q.href}
                className="flex items-center justify-between px-4 py-3.5 hover:bg-accent/40"
              >
                <span className="text-sm">{q.label}</span>
                <span
                  className={cn(
                    'tabular text-lg font-semibold',
                    q.n ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {q.n}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{o.bannedUsers} accounts suspended.</p>
      </section>

      <section aria-labelledby="week">
        <h2 id="week" className="text-sm font-semibold">
          Last 7 days
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <dt className="text-xs text-muted-foreground">New users</dt>
            <dd className="tabular text-xl font-semibold">{o.newUsers}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">New listings</dt>
            <dd className="tabular text-xl font-semibold">{o.newListings}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Completed orders</dt>
            <dd className="tabular text-xl font-semibold">{o.completedOrders}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Sales volume</dt>
            <dd className="tabular font-semibold">
              {o.gmv.length
                ? o.gmv.map((g) => (
                    <span key={g.currency} className="block">
                      {formatMoney(g.amount, g.currency)}
                    </span>
                  ))
                : '—'}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
