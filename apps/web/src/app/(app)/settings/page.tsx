import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SettingsView } from './settings-view';

export const metadata: Metadata = { title: 'Settings', robots: { index: false } };

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}
