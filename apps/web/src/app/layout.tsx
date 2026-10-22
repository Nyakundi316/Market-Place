import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { SITE_URL } from '@/lib/seo';
import './globals.css';
import { SentryClient } from '@/components/sentry-client';
import { ServiceWorker } from '@/components/service-worker';
import { Providers } from './providers';

const sans = localFont({ src: './fonts/GeistVF.woff', variable: '--font-sans', weight: '100 900' });
const mono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-mono',
  weight: '100 900',
});
// Editorial serif for headings and headline prices; the wordmark and UI stay in Geist.
// Fraunces (SIL OFL), latin, all axes incl. SOFT/opsz. Self-hosted like Geist so a build
// never depends on reaching Google Fonts (next/font/google fails the build when it can't).
const display = localFont({
  src: './fonts/FrauncesVF.woff2',
  variable: '--font-display',
  weight: '100 900',
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
});

const DESCRIPTION =
  'Buy and sell products and services with verified people, real-time chat and escrow-protected payments.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: 'MarketHub',
  appleWebApp: { capable: true, title: 'MarketHub', statusBarStyle: 'default' },
  title: { default: 'MarketHub', template: '%s · MarketHub' },
  description: DESCRIPTION,
  openGraph: { siteName: 'MarketHub', type: 'website', locale: 'en', description: DESCRIPTION },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f3ee' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1714' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${sans.variable} ${mono.variable} ${display.variable} font-sans antialiased`}
      >
        <Providers>{children}</Providers>
        <ServiceWorker />
        <SentryClient />
      </body>
    </html>
  );
}
