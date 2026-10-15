import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OnboardingFlow } from './onboarding-flow';

export const metadata: Metadata = { title: 'Set up your profile', robots: { index: false } };

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingFlow />
    </Suspense>
  );
}
