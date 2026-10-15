import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { SITE_URL } from '@/lib/seo';
import './globals.css';
import { Providers } from './providers';

const sans = localFont({ src: './fonts/GeistVF.woff', variable: '--font-sans', weight: '100 900' });
const mono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-mono',
  weight: '100 900',
});

const DESCRIPTION =
  'Buy and sell products and services with verified people, real-time chat and escrow-protected payments.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: 'MarketHub',
  title: { default: 'MarketHub', template: '%s · MarketHub' },
  description: DESCRIPTION,
  openGraph: { siteName: 'MarketHub', type: 'website', locale: 'en', description: DESCRIPTION },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
