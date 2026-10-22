import { Compass, Handshake, Heart, MessageCircle, Plus, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** rendered as the raised centre action on mobile, a button on desktop */
  primary?: boolean;
}

// Search lives in the top bar on every screen size, so it isn't a tab.
export const NAV: NavItem[] = [
  { href: '/feed', label: t('nav.discover'), icon: Compass },
  { href: '/saved', label: t('nav.saved'), icon: Heart },
  { href: '/create', label: t('nav.sell'), icon: Plus, primary: true },
  { href: '/chat', label: t('nav.chats'), icon: MessageCircle },
  { href: '/deals', label: t('nav.deals'), icon: Handshake },
];

export const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);
