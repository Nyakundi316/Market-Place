'use client';

import type { AdminUserDto } from '@markethub/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { type ReasonPrompt, ReasonDialog } from '@/components/admin/reason-dialog';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { VerificationBadge } from '@/components/verification-badge';
import { useAdminAction, useAdminList } from '@/hooks/use-trust';
import { ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/format';

export default function AdminUsersPage() {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  // Search as you type, but not on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);

  const q = useAdminList<AdminUserDto>('users', query ? `q=${encodeURIComponent(query)}` : '');
  const act = useAdminAction();
  const [prompt, setPrompt] = useState<ReasonPrompt | null>(null);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const run = (label: string, a: Parameters<typeof act.mutateAsync>[0]) =>
    act.mutateAsync(a).then(
      () => toast.success(label),
      (err: unknown) => {
        toast.error(err instanceof ApiError ? err.message : 'Failed');
        throw err;
      },
    );

  return (
    <div className="max-w-4xl">
      <Input
        type="search"
        aria-label="Search users"
        placeholder="Email, username, name or id"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        className="max-w-sm"
      />

      {q.isPending ? (
        <Skeleton className="mt-4 h-40" />
      ) : !items.length ? (
        <p className="mt-6 text-sm text-muted-foreground">No users match.</p>
      ) : (
        <ul className="mt-4 divide-y rounded-lg border bg-card">
          {items.map((u) => (
            <li
              key={u.id}
              className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="flex min-w-0 items-center gap-3">
                <ProfileAvatar
                  name={u.profile?.displayName ?? u.email}
                  src={u.profile?.avatarUrl ?? null}
                  className="size-9"
                />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {u.profile?.username ? (
                      <Link
                        href={`/u/${u.profile.username}`}
                        target="_blank"
                        className="hover:underline"
                      >
                        {u.profile.displayName}
                      </Link>
                    ) : (
                      u.email
                    )}
                    {u.profile && (
                      <VerificationBadge
                        idVerified={u.profile.idVerified}
                        businessVerified={u.profile.businessVerified}
                        compact
                      />
                    )}
                    {u.role === 'admin' && (
                      <span className="rounded bg-primary/10 px-1.5 text-[10px] uppercase text-primary">
                        admin
                      </span>
                    )}
                    {u.isBanned && (
                      <span className="rounded bg-destructive px-1.5 text-[10px] uppercase text-destructive-foreground">
                        banned
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.email} · joined {timeAgo(u.createdAt)}
                    {u.warnings > 0 && (
                      <span className="text-destructive">
                        {' '}
                        · {u.warnings} warning{u.warnings > 1 ? 's' : ''}
                      </span>
                    )}
                    {u.openReports > 0 && (
                      <span className="text-destructive">
                        {' '}
                        · {u.openReports} open report{u.openReports > 1 ? 's' : ''}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {u.role !== 'admin' && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPrompt({
                        title: `Warn ${u.profile?.displayName ?? u.email}`,
                        description: 'Sent to them as a notification.',
                        label: 'Message',
                        confirm: 'Send warning',
                        minLength: 10,
                        run: (message) => run('Warning sent', { kind: 'warn', id: u.id, message }),
                      })
                    }
                  >
                    Warn
                  </Button>
                  <Button
                    size="sm"
                    variant={u.isBanned ? 'outline' : 'destructive'}
                    onClick={() =>
                      setPrompt(
                        u.isBanned
                          ? {
                              title: 'Lift the suspension?',
                              label: 'Reason (audit log)',
                              confirm: 'Unban',
                              minLength: 3,
                              run: (reason) => run('Unbanned', { kind: 'unban', id: u.id, reason }),
                            }
                          : {
                              title: `Suspend ${u.profile?.displayName ?? u.email}?`,
                              description:
                                'They’re signed out everywhere and can’t log in, post or chat.',
                              label: 'Reason (audit log)',
                              confirm: 'Ban',
                              minLength: 3,
                              destructive: true,
                              run: (reason) => run('Banned', { kind: 'ban', id: u.id, reason }),
                            },
                      )
                    }
                  >
                    {u.isBanned ? 'Unban' : 'Ban'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void q.fetchNextPage()}>
          Load more
        </Button>
      )}
      <ReasonDialog prompt={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}
