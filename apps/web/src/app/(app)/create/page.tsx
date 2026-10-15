import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CreateListingWizard } from './wizard';

export const metadata: Metadata = { title: 'Sell something', robots: { index: false } };

export default function CreatePage() {
  return (
    <Suspense>
      <CreateListingWizard />
    </Suspense>
  );
}
