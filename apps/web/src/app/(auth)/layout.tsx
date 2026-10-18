import Link from 'next/link';
import { Wordmark } from '@/components/shell/wordmark';

const SHELL = 'mx-auto w-full max-w-[96rem] px-5 lg:px-10';

const TRUST = [
  { title: 'Escrow', detail: 'held until you confirm' },
  { title: 'Verified', detail: 'ID and phone badges' },
  { title: 'Reviews', detail: 'from completed orders' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-foreground text-background">
      <header className={`${SHELL} flex h-16 items-center lg:h-[4.5rem]`}>
        <Wordmark className="text-background [&_span.text-primary]:text-[hsl(160_60%_55%)]" />
        <Link
          href="/feed"
          className="ml-auto text-sm text-background/60 transition-colors hover:text-background"
        >
          Just browsing
        </Link>
      </header>

      {/*
        On lg the card spans both rows on the right, so the pitch sits level with its
        top and the trust row with its bottom. Phones keep pitch → card → trust.
      */}
      <main
        className={`${SHELL} grid flex-1 content-center gap-10 pb-16 pt-6 lg:grid-cols-12 lg:gap-x-6 lg:gap-y-12 lg:py-16`}
      >
        <div className="lg:col-span-6 lg:row-start-1">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-saffron">
            Join MarketHub
          </p>
          <p className="mt-4 max-w-lg text-balance text-4xl font-semibold leading-[1.02] tracking-tight sm:text-5xl lg:text-6xl">
            Your stall is a minute away.
          </p>
          <p className="mt-5 max-w-sm text-background/65">
            Create an account, set up your profile and post your first listing. Or just start
            browsing.
          </p>
        </div>

        <div className="w-full max-w-md animate-rise-in lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:max-w-none">
          <div className="rounded-[1.75rem] bg-card p-5 text-card-foreground shadow-lift sm:p-7">
            {children}
          </div>
        </div>

        <ul className="grid grid-cols-3 gap-4 border-t border-background/15 pt-6 lg:col-span-6 lg:row-start-2 lg:self-end">
          {TRUST.map(({ title, detail }) => (
            <li key={title}>
              <span className="block font-semibold sm:text-lg">{title}</span>
              <span className="mt-0.5 block text-xs text-background/60 sm:text-sm">{detail}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
