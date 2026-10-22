/**
 * English, the source catalogue (§10 Phase 7 i18n scaffold). Other locales
 * mirror this shape exactly; the type check enforces it. `{name}` marks a
 * parameter filled in by t().
 */
export const en = {
  nav: {
    discover: 'Discover',
    search: 'Search',
    searchHint: 'Search phones, sofas, plumbers…',
    saved: 'Saved',
    sell: 'Sell',
    sellSomething: 'Sell something',
    chats: 'Chats',
    deals: 'Deals',
    main: 'Main',
    skipToContent: 'Skip to content',
  },
  account: {
    profile: 'Profile',
    setUpProfile: 'Set up profile',
    listings: 'Your listings',
    saved: 'Saved',
    settings: 'Settings',
    admin: 'Admin',
    logIn: 'Log in',
    signUp: 'Sign up',
    logOut: 'Log out',
  },
  notifications: {
    title: 'Notifications',
    unread: 'Notifications, {count} unread',
    markAllRead: 'Mark all read',
    empty: 'You’re all caught up.',
    older: 'Show older',
  },
  offline: {
    title: 'You’re offline',
    body: 'MarketHub needs a connection for chats, offers and payments. We’ll pick up where you left off as soon as you’re back.',
    retry: 'Try again',
  },
} as const;
