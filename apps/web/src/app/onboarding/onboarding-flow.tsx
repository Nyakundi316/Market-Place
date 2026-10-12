'use client';

import type { MeDto } from '@markethub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Wordmark } from '@/components/shell/wordmark';
import { Skeleton } from '@/components/ui/skeleton';
import { meKey, useMe } from '@/hooks/use-me';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { safeNext } from '@/lib/redirect';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { AboutStep, IdentityStep, LocationStep } from './steps';

const STEPS = [
  { title: 'Who you are', hint: 'Name and handle buyers will see' },
  { title: 'Where you trade', hint: 'So nearby buyers find you' },
  { title: 'Your story', hint: 'Optional, but it builds trust' },
];

export function OnboardingFlow() {
  const ready = useRequireAuth();
  const { data: me } = useMe();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);

  // Someone with a profile who reloads mid-flow resumes past the identity step.
  const hasProfile = Boolean(me?.profile);
  useEffect(() => {
    if (hasProfile) setStep((s) => Math.max(s, 1));
  }, [hasProfile]);

  function saved(updated: MeDto) {
    queryClient.setQueryData(meKey, updated);
    useAuth.getState().setUser(updated.user);
    if (step < STEPS.length - 1) setStep(step + 1);
    else router.replace(next);
  }
  const skip = () => (step < STEPS.length - 1 ? setStep(step + 1) : router.replace(next));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[18rem_1fr]">
      <aside className="border-b bg-card/60 px-5 py-4 lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r lg:px-8 lg:py-10">
        <Wordmark />
        <ol className="mt-5 flex gap-1.5 lg:mt-16 lg:flex-col lg:gap-7" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              aria-current={i === step ? 'step' : undefined}
              className="flex-1 lg:flex lg:gap-3"
            >
              {/* Mobile: segmented bar. Desktop: numbered rail with labels. */}
              <span
                className={cn(
                  'block h-1 rounded-full bg-border transition-colors lg:hidden',
                  i <= step && 'bg-primary',
                )}
              />
              <span
                className={cn(
                  'hidden size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold lg:grid',
                  i < step && 'border-primary bg-primary text-primary-foreground',
                  i === step && 'border-primary text-primary',
                )}
              >
                {i < step ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className="hidden lg:block">
                <span
                  className={cn('block text-sm font-medium', i > step && 'text-muted-foreground')}
                >
                  {s.title}
                </span>
                <span className="block text-xs text-muted-foreground">{s.hint}</span>
              </span>
            </li>
          ))}
        </ol>
      </aside>

      <main className="px-5 pb-16 pt-8 sm:px-10 lg:pl-[10%] lg:pt-[14vh]">
        <div className="max-w-md">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </p>
          {!ready || !me ? (
            <div className="mt-4 space-y-4">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <div key={step} className="animate-rise-in">
              {step === 0 && <IdentityStep me={me} onSaved={saved} />}
              {step === 1 && <LocationStep me={me} onSaved={saved} onSkip={skip} />}
              {step === 2 && <AboutStep me={me} onSaved={saved} onSkip={skip} />}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
