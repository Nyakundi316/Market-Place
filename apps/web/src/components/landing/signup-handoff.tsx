'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/stores/auth';

// The wordmark's intro is done by ~2.1s (the brief pill pops in last), then it holds.
const INTRO_MS = 2100;
const HOLD_MS = 4000;

// Once per tab. Without it, Back from /signup lands here and gets bounced forward again.
const SPENT_KEY = 'mh:landing-handoff';

// Crawlers fast-forward timers; they'd index the home page as /signup.
const CRAWLER = /bot|crawl|spider|slurp|facebookexternalhit|preview/i;

function spent() {
  try {
    return sessionStorage.getItem(SPENT_KEY) === '1';
  } catch {
    return false;
  }
}

function spend() {
  try {
    sessionStorage.setItem(SPENT_KEY, '1');
  } catch {
    // storage blocked: worst case the hand-off can run again
  }
}

/**
 * The header's Sign up pill. After the intro it fills up over HOLD_MS and then moves the
 * visitor on to /signup, or /feed if they're already signed in. A click, key or scroll
 * means they're looking around, so the hand-off stands down.
 */
export function SignupHandoff() {
  const router = useRouter();
  const [phase, setPhase] = useState<'intro' | 'holding' | 'off'>('intro');

  useEffect(() => {
    if (spent() || CRAWLER.test(navigator.userAgent)) {
      setPhase('off');
      return;
    }

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let hold: ReturnType<typeof setTimeout>;
    const intro = setTimeout(
      () => {
        setPhase('holding');
        hold = setTimeout(() => {
          spend();
          router.push(useAuth.getState().status === 'authenticated' ? '/feed' : '/signup');
        }, HOLD_MS);
      },
      reduced ? 0 : INTRO_MS,
    );

    const standDown = () => {
      spend();
      clearTimeout(intro);
      clearTimeout(hold);
      setPhase('off');
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchmove'] as const;
    for (const e of events) window.addEventListener(e, standDown, { once: true, passive: true });

    return () => {
      clearTimeout(intro);
      clearTimeout(hold);
      for (const e of events) window.removeEventListener(e, standDown);
    };
  }, [router]);

  return (
    <Button
      asChild
      size="sm"
      className="relative ml-1 overflow-hidden rounded-full bg-foreground px-4 text-background hover:bg-foreground/85"
    >
      <Link href="/signup">
        Sign up
        {phase === 'holding' && (
          <span
            aria-hidden
            className="absolute inset-x-3 bottom-[3px] h-0.5 origin-left animate-fill-x rounded-full bg-saffron"
            style={{ animationDuration: `${HOLD_MS}ms` }}
          />
        )}
      </Link>
    </Button>
  );
}
