import { Compass, Handshake, MessageCircle, Plus, Search, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** rendered as the raised centre action on mobile */
  primary?: boolean;
}

export const NAV: NavItem[] = [
  { href: '/feed', label: 'Discover', icon: Compass },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/create', label: 'Sell', icon: Plus, primary: true },
  { href: '/chat', label: 'Chats', icon: MessageCircle },
  { href: '/deals', label: 'Deals', icon: Handshake },
];

export const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);
