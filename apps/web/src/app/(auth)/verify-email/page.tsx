import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyStatus } from './verify-status';

export const metadata: Metadata = { title: 'Confirm email' };

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyStatus />
    </Suspense>
  );
}
