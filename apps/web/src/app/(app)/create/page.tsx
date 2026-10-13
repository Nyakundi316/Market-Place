import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CreateListingWizard } from './wizard';

export const metadata: Metadata = { title: 'Sell something' };

export default function CreatePage() {
  return (
    <Suspense>
      <CreateListingWizard />
    </Suspense>
  );
}
