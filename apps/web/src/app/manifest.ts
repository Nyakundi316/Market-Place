import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MarketHub',
    short_name: 'MarketHub',
    description: 'Buy and sell with verified people, real-time chat and escrow.',
    start_url: '/feed',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f3ee',
    theme_color: '#0f7b5f',
    categories: ['shopping', 'business'],
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/512-maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Sell something', url: '/create' },
      { name: 'Chats', url: '/chat' },
      { name: 'Deals', url: '/deals' },
    ],
  };
}
