import { Compass, Handshake, MessageCircle, Plus, Search, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** rendered as the raised centre action on mobile */
  primary?: boolean;
}

export const NAV: NavItem[] = [
  { href: '/feed', label: t('nav.discover'), icon: Compass },
  { href: '/search', label: t('nav.search'), icon: Search },
  { href: '/create', label: t('nav.sell'), icon: Plus, primary: true },
  { href: '/chat', label: t('nav.chats'), icon: MessageCircle },
  { href: '/deals', label: t('nav.deals'), icon: Handshake },
];

export const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);
