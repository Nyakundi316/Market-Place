import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DealsView } from './deals-view';

export const metadata: Metadata = { title: 'Deals', robots: { index: false } };

export default function DealsPage() {
  return (
    <Suspense>
      <DealsView />
    </Suspense>
  );
}
