'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Heart, LayoutList, LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/hooks/use-me';
import { logout } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { t } from '@/i18n';

/** `compact` = mobile top bar (avatar only); otherwise the sidebar footer row. */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const status = useAuth((s) => s.status);
  const { data: me } = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();

  if (status === 'unknown')
    return <Skeleton className={compact ? 'size-9 rounded-full' : 'h-11 w-full'} />;

  if (status === 'anonymous') {
    return (
      <div className={compact ? 'flex gap-1.5' : 'grid grid-cols-2 gap-2'}>
        <Button asChild variant="ghost" size="sm">
          <Link href="/login">{t('account.logIn')}</Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/signup">{t('account.signUp')}</Link>
        </Button>
      </div>
    );
  }

  const name = me?.profile?.displayName ?? me?.user.email ?? '';
  const profileHref = me?.profile ? `/u/${me.profile.username}` : '/onboarding';

  async function signOut() {
    await logout();
    queryClient.clear();
    router.push('/feed');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          compact
            ? 'rounded-full'
            : 'flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-accent'
        }
        aria-label="Account menu"
      >
        <ProfileAvatar name={name} src={me?.profile?.avatarUrl} />
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name || 'Your account'}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {me?.profile ? `@${me.profile.username}` : 'Finish your profile'}
            </span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? 'end' : 'start'} className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {me?.user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={profileHref}>
            <UserRound /> {me?.profile ? t('account.profile') : t('account.setUpProfile')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/seller">
            <LayoutList /> {t('account.listings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/saved">
            <Heart /> {t('account.saved')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> {t('account.settings')}
          </Link>
        </DropdownMenuItem>
        {me?.user.role === 'admin' && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <ShieldCheck /> {t('account.admin')}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut /> {t('account.logOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
