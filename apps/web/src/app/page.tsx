import { ArrowRight, BadgeCheck, Check, MessagesSquare, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { JsonLd } from '@/components/json-ld';
import { Wordmark } from '@/components/shell/wordmark';
import { siteJsonLd } from '@/lib/seo';
import { Button } from '@/components/ui/button';

const ESCROW_STEPS = [
  { label: 'Offer accepted', detail: 'KES 45,000 · agreed in chat', done: true },
  { label: 'Paid into escrow', detail: 'Held by MarketHub, not the seller', done: true },
  { label: 'Delivered', detail: 'Buyer checks the item', done: true },
  { label: 'Released to seller', detail: 'After the buyer confirms', done: false },
];

const HOW = [
  {
    icon: BadgeCheck,
    title: 'Post or browse',
    body: 'Products, services, jobs and requests — sorted by category and close to you.',
  },
  {
    icon: MessagesSquare,
    title: 'Chat and make offers',
    body: 'Ask questions, send photos, counter until the price is right.',
  },
  {
    icon: ShieldCheck,
    title: 'Pay through escrow',
    body: 'Your money waits safely until you confirm the deal went through.',
  },
];

export default function Landing() {
  return (
    <>
      <JsonLd data={siteJsonLd()} />
      <div className="min-h-dvh">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 lg:px-8">
          <Wordmark />
          <nav className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Sign up</Link>
            </Button>
          </nav>
        </header>

        <main>
          <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-16 pt-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-16 lg:px-8 lg:pb-24 lg:pt-16">
            <div className="animate-rise-in">
              <p className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-saffron" /> Escrow on every paid deal
              </p>
              <h1 className="mt-5 max-w-xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                Buy and sell with people you can actually trust.
              </h1>
              <p className="mt-5 max-w-md text-base text-muted-foreground sm:text-lg">
                Post anything from a phone to a plumbing job. Chat, haggle, and pay — the seller
                only gets the money once you&apos;re happy.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg" className="gap-2 shadow-lift">
                  <Link href="/feed">
                    Browse listings <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="bg-card">
                  <Link href="/signup?next=%2Fcreate">Start selling</Link>
                </Button>
              </div>
            </div>

            {/* Illustrative escrow timeline — shows how a deal moves, not a real order. */}
            <figure
              className="relative rounded-2xl border bg-card p-6 shadow-lift lg:translate-y-6 lg:rotate-[0.6deg]"
              aria-label="Example: how an escrow deal progresses"
            >
              <figcaption className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">Refurbished iPhone 13</span>
                <span className="font-mono text-xs text-muted-foreground">example</span>
              </figcaption>
              <ol className="mt-6 space-y-5">
                {ESCROW_STEPS.map((s, i) => (
                  <li key={s.label} className="relative grid grid-cols-[auto_1fr] gap-x-3">
                    {i < ESCROW_STEPS.length - 1 && (
                      <span
                        aria-hidden
                        className={`absolute left-[11px] top-6 h-[calc(100%+0.25rem)] w-px ${s.done ? 'bg-primary/40' : 'bg-border'}`}
                      />
                    )}
                    <span
                      className={`grid size-6 place-items-center rounded-full ${s.done ? 'bg-primary text-primary-foreground' : 'border-2 border-dashed border-saffron bg-saffron/10'}`}
                    >
                      {s.done && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                    <span className="text-sm font-medium">{s.label}</span>
                    <span className="col-start-2 text-xs text-muted-foreground">{s.detail}</span>
                  </li>
                ))}
              </ol>
            </figure>
          </section>

          <section className="border-t bg-card/60">
            <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-3 lg:px-8 lg:py-20">
              {HOW.map(({ icon: Icon, title, body }, i) => (
                <div key={title}>
                  <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
                  <Icon className="mt-3 size-6 text-primary" strokeWidth={1.75} />
                  <h2 className="mt-3 font-semibold">{title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </section>
        </main>

        <footer className="mx-auto max-w-6xl px-5 py-8 text-xs text-muted-foreground lg:px-8">
          © {new Date().getFullYear()} MarketHub
        </footer>
      </div>
    </>
  );
}
