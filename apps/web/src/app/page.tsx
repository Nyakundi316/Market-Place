import Image from 'next/image';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { JsonLd } from '@/components/json-ld';
import { BriefPill } from '@/components/landing/brief-pill';
import { SignupHandoff } from '@/components/landing/signup-handoff';
import { Button } from '@/components/ui/button';
import { siteJsonLd } from '@/lib/seo';

const SHELL = 'mx-auto w-full max-w-[96rem] px-5 lg:px-10';

// Both lines of the wordmark share this so "Market" and "Hub" always match. The dvh
// cap keeps the whole display inside the first screen on short, wide windows.
const DISPLAY =
  'text-[length:min(26vw,31dvh)] font-extrabold leading-[0.8] tracking-[-0.055em] sm:text-[length:min(23vw,31dvh)] lg:text-[length:min(18.5vw,31dvh)] 2xl:text-[length:min(17.75rem,31dvh)]';

// How far each letter of "Market" leans while it falls. Uneven on purpose.
const TILT = [-14, 9, -6, 12, -10, 7];

// Overshoot for things that pop in. Inline (like the delays below) because
// arbitrary `ease-[…]`/`delay-[…]` classes collide with tailwindcss-animate.
const POP = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export default function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      <JsonLd data={siteJsonLd()} />
      <header className={`${SHELL} flex h-16 items-center lg:h-[4.5rem]`}>
        <p className="hidden items-center gap-2 text-xs font-medium text-muted-foreground sm:flex">
          <span className="size-1.5 rounded-full bg-saffron" /> Escrow on every paid deal
        </p>
        <nav className="ml-auto flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/feed">Browse</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Log in</Link>
          </Button>
          <SignupHandoff />
        </nav>
      </header>

      {/*
        The wordmark owns the first screen. It's anchored to the bottom of whatever the
        header leaves, so tall windows get air above it rather than below.
      */}
      <main className="flex flex-1 flex-col">
        <section
          className={`${SHELL} relative grid flex-1 grid-cols-12 content-end items-end overflow-x-clip pb-14 pt-16 sm:pt-20 lg:pb-20`}
        >
          <h1 className="sr-only">MarketHub</h1>

          <div aria-hidden className={`${DISPLAY} col-span-12 row-start-1 whitespace-nowrap`}>
            {[...'Market'].map((ch, i) => (
              <span
                key={i}
                className="relative inline-block origin-bottom animate-letter-drop motion-reduce:animate-none"
                style={
                  {
                    animationDelay: `${100 + i * 75}ms`,
                    '--tilt': `${TILT[i]}deg`,
                  } as CSSProperties
                }
              >
                {ch}
                {ch === 'a' && (
                  <span
                    className="absolute bottom-[0.44em] left-[-0.05em] w-[0.7em] -rotate-[8deg] duration-500 animate-in fade-in zoom-in-50 spin-in-[-24deg] fill-mode-both motion-reduce:animate-none"
                    style={{ animationDelay: '1150ms', animationTimingFunction: POP }}
                  >
                    <Image
                      src="/landing/stall.svg"
                      alt=""
                      width={260}
                      height={210}
                      className="h-auto w-full drop-shadow-[0_10px_18px_rgba(20,32,27,0.22)]"
                    />
                  </span>
                )}
              </span>
            ))}
          </div>

          <div
            aria-hidden
            className={`${DISPLAY} col-span-12 row-start-2 mt-[0.3em] justify-self-end pr-[0.5em] lg:col-span-7 lg:col-start-6 lg:mt-0 lg:justify-self-start lg:pr-0`}
          >
            <span className="relative inline-flex">
              {/* white on black, as sketched */}
              <span
                className="inline-flex animate-wipe-in overflow-hidden rounded-[0.12em] bg-foreground px-[0.08em] pb-[0.08em] pt-[0.02em] text-background motion-reduce:animate-none"
                style={{ animationDelay: '600ms' }}
              >
                {[...'Hub'].map((ch, i) => (
                  <span
                    key={i}
                    className="inline-block animate-letter-rise motion-reduce:animate-none"
                    style={{ animationDelay: `${900 + i * 90}ms` }}
                  >
                    {ch}
                  </span>
                ))}
              </span>
              <span
                className="absolute -right-[0.05em] -top-[0.05em] size-[0.13em] origin-bottom animate-letter-drop rounded-full bg-saffron motion-reduce:animate-none"
                style={{ animationDelay: '1350ms' }}
              />
              {/* the bag floats in front of the word, so "Hub" reads as sitting behind it */}
              <span
                className="absolute -right-[0.62em] top-[0.16em] z-10 w-[0.8em] duration-700 ease-out animate-in fade-in slide-in-from-bottom-[0.3em] fill-mode-both motion-reduce:animate-none"
                style={{ animationDelay: '1250ms' }}
              >
                <span
                  className="block rotate-[5deg] animate-float motion-reduce:animate-none"
                  style={{ animationDelay: '2s' }}
                >
                  <Image
                    src="/landing/bag.svg"
                    alt=""
                    width={300}
                    height={370}
                    priority
                    className="h-auto w-full drop-shadow-[0_24px_28px_rgba(20,32,27,0.3)]"
                  />
                </span>
              </span>
            </span>
          </div>

          <div className="col-span-12 col-start-1 row-start-3 mt-12 max-w-sm lg:col-span-5 lg:row-start-2 lg:mt-0 lg:self-end lg:pb-[0.5vw]">
            <p
              className="text-base text-muted-foreground duration-700 animate-in fade-in slide-in-from-bottom-3 fill-mode-both motion-reduce:animate-none sm:text-lg"
              style={{ animationDelay: '1400ms' }}
            >
              Buy, sell and haggle with people you can check. Your money waits in escrow until
              you&apos;re happy with the deal.
            </p>
            <BriefPill
              className="mt-6 duration-500 animate-in fade-in zoom-in-75 fill-mode-both motion-reduce:animate-none"
              style={{ animationDelay: '1600ms', animationTimingFunction: POP }}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
