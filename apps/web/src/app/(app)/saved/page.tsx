import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SavedView } from './saved-view';

export const metadata: Metadata = { title: 'Saved', robots: { index: false } };

export default function SavedPage() {
  return (
    <Suspense>
      <SavedView />
    </Suspense>
  );
}
