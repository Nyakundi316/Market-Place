import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminShell } from './admin-shell';

export const metadata: Metadata = { title: 'Admin', robots: { index: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
