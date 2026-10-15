'use client';

import type { AuditEntryDto } from '@markethub/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminList } from '@/hooks/use-trust';

const stamp = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** §9 audit viewer. Filters: action prefix ("order.", "user.ban") and entity id. */
export default function AdminAuditPage() {
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const [applied, setApplied] = useState('');
  const q = useAdminList<AuditEntryDto>('audit', applied);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="max-w-5xl">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const p = new URLSearchParams();
          if (action.trim()) p.set('action', action.trim());
          if (entityId.trim()) p.set('entityId', entityId.trim());
          setApplied(p.toString());
        }}
      >
        <Input
          aria-label="Action starts with"
          placeholder="Action, e.g. order. or user.ban"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="w-56"
        />
        <Input
          aria-label="Entity id"
          placeholder="Entity id"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          className="w-72 font-mono text-xs"
        />
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {q.isPending ? (
        <Skeleton className="mt-4 h-60" />
      ) : !items.length ? (
        <p className="mt-6 text-sm text-muted-foreground">No entries.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">On</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {stamp.format(new Date(a.createdAt))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{a.action}</td>
                  <td className="px-3 py-2 text-xs">
                    {a.actor?.label ?? <span className="text-muted-foreground">system</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <button
                      type="button"
                      title="Filter by this"
                      onClick={() => {
                        setEntityId(a.entityId);
                        setApplied(`entityId=${encodeURIComponent(a.entityId)}`);
                      }}
                      className="text-left hover:underline"
                    >
                      {a.entityType}{' '}
                      <span className="font-mono text-muted-foreground">
                        {a.entityId.slice(0, 8)}
                      </span>
                    </button>
                  </td>
                  <td className="max-w-md px-3 py-2">
                    {a.metadata ? (
                      <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                        {JSON.stringify(a.metadata)}
                      </pre>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.hasNextPage && (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void q.fetchNextPage()}>
          Older
        </Button>
      )}
    </div>
  );
}
