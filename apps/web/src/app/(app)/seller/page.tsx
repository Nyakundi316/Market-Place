import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SellerView } from './seller-view';

export const metadata: Metadata = { title: 'Your listings', robots: { index: false } };

export default function SellerPage() {
  return (
    <Suspense>
      <SellerView />
    </Suspense>
  );
}
