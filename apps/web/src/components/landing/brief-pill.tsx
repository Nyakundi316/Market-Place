'use client';

import { ArrowRight, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const POINTS = [
  ['Post or browse', 'Products, services, jobs and requests, sorted by category and close to you.'],
  ['Chat and haggle', 'Ask questions, swap photos and counter until the price feels right.'],
  [
    'Pay through escrow',
    'Your money waits with MarketHub until you confirm the deal went through.',
  ],
] as const;

type Ripple = { id: number; x: number; y: number };

// How long the pill splashes on its own before the brief starts pouring out.
const SPLASH_MS = 90;

// Panel content follows the liquid in, and leaves before it drains.
const REVEAL =
  'translate-y-2 opacity-0 transition duration-500 group-data-[open=true]:translate-y-0 group-data-[open=true]:opacity-100 motion-reduce:![transition-delay:0ms]';

/**
 * The hero's "What's MarketHub?" pill. A click ripples it like water and the
 * brief pours out of it; closing drains it back in. The wobble is an SVG
 * displacement filter that is only attached while it's moving.
 */
export function BriefPill({ className, style }: { className?: string; style?: CSSProperties }) {
  const [open, setOpen] = useState(false);
  // `up`: pour upward out of the pill, unless the page above it is too short to hold the brief.
  const [pill, setPill] = useState({ w: 0, h: 0, up: true });
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const liquidRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const noiseRef = useRef<SVGFETurbulenceElement>(null);
  const displaceRef = useRef<SVGFEDisplacementMapElement>(null);
  const frame = useRef(0);

  const slosh = useCallback((strength: number) => {
    const noise = noiseRef.current;
    const displace = displaceRef.current;
    const layers = [pillRef.current, liquidRef.current];
    if (!noise || !displace || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    cancelAnimationFrame(frame.current);
    for (const el of layers) el?.style.setProperty('filter', 'url(#brief-water)');
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / 1100, 1);
      // One splash that sloshes back and forth and dies out.
      displace.setAttribute(
        'scale',
        (strength * Math.exp(-4 * t) * Math.sin(t * Math.PI * 5)).toFixed(2),
      );
      noise.setAttribute(
        'baseFrequency',
        `${(0.009 + 0.006 * t).toFixed(4)} ${(0.028 - 0.01 * t).toFixed(4)}`,
      );
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else for (const el of layers) el?.style.removeProperty('filter');
    };
    frame.current = requestAnimationFrame(tick);
  }, []);

  const setBrief = useCallback(
    (next: boolean, refocus = false) => {
      setOpen(next);
      slosh(next ? 34 : 18);
      if (!next && refocus) pillRef.current?.focus();
    },
    [slosh],
  );

  function splash(x: number, y: number) {
    setRipples((r) => [...r.slice(-2), { id: performance.now(), x, y }]);
  }

  const step = (i: number): CSSProperties =>
    open ? { transitionDelay: `${280 + i * 70}ms` } : { transitionDuration: '160ms' };

  // The closed panel is clipped to exactly the pill, so it has to know the pill's size.
  useEffect(() => {
    const el = pillRef.current;
    const panel = panelRef.current;
    if (!el || !panel) return;
    const measure = () => {
      const roomAbove = el.getBoundingClientRect().bottom + window.scrollY;
      setPill({ w: el.offsetWidth, h: el.offsetHeight, up: panel.offsetHeight + 12 <= roomAbove });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(panel);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // Still visibility:hidden during the splash, and hidden elements can't take focus.
    const reveal = setTimeout(() => {
      panelRef.current?.focus({ preventScroll: true });
      panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, SPLASH_MS + 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBrief(false, true);
    };
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setBrief(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      clearTimeout(reveal);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, setBrief]);

  return (
    <div ref={wrapRef} className={cn('relative z-20 inline-block', className)} style={style}>
      <svg aria-hidden width="0" height="0" className="absolute">
        <filter
          id="brief-water"
          x="-20%"
          y="-40%"
          width="140%"
          height="180%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            ref={noiseRef}
            type="fractalNoise"
            baseFrequency="0.009 0.028"
            numOctaves={1}
            seed={7}
            result="noise"
          />
          <feDisplacementMap
            ref={displaceRef}
            in="SourceGraphic"
            in2="noise"
            scale={0}
            xChannelSelector="R"
            yChannelSelector="B"
          />
        </filter>
      </svg>

      <button
        ref={pillRef}
        type="button"
        aria-expanded={open}
        aria-controls="brief"
        aria-haspopup="dialog"
        onPointerDown={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          splash(e.clientX - box.left, e.clientY - box.top);
        }}
        onClick={(e) => {
          // detail 0 = Enter/Space, which has no pointer position
          if (e.detail === 0) splash(pill.w / 2, pill.h / 2);
          setBrief(!open);
        }}
        className="relative inline-flex h-12 items-center gap-3 overflow-hidden whitespace-nowrap rounded-full bg-foreground pl-5 pr-1.5 text-sm font-medium text-background shadow-lift transition-transform active:scale-[0.97]"
      >
        What&apos;s MarketHub?
        <span className="grid size-9 place-items-center rounded-full bg-saffron text-saffron-foreground">
          <Plus className="size-4" strokeWidth={2.5} />
        </span>
        {ripples.map((r) => (
          <span
            key={r.id}
            aria-hidden
            onAnimationEnd={() => setRipples((all) => all.filter((x) => x.id !== r.id))}
            className="pointer-events-none absolute size-64 animate-ripple rounded-full border-2 border-background/60 bg-background/10"
            style={{ left: r.x, top: r.y }}
          />
        ))}
      </button>

      {/* Filtered separately from the panel: a filter on the clipped element itself would leave its edges razor-straight. */}
      <div
        ref={liquidRef}
        className={cn(
          'pointer-events-none absolute left-0 w-[min(26rem,calc(100vw-2.5rem))]',
          pill.up ? 'bottom-0' : 'top-0',
        )}
      >
        <div
          ref={panelRef}
          id="brief"
          role="dialog"
          aria-labelledby="brief-title"
          tabIndex={-1}
          data-open={open}
          className="group pointer-events-auto border border-background/10 bg-foreground p-5 text-background outline-none sm:p-7"
          style={{
            clipPath: open
              ? 'inset(0 0 0 0 round 28px)'
              : pill.up
                ? `inset(calc(100% - ${pill.h}px) calc(100% - ${pill.w}px) 0 0 round ${pill.h / 2}px)`
                : `inset(0 calc(100% - ${pill.w}px) calc(100% - ${pill.h}px) 0 round ${pill.h / 2}px)`,
            visibility: open ? 'visible' : 'hidden',
            transition: open
              ? `clip-path 760ms cubic-bezier(0.22, 1.15, 0.36, 1) ${SPLASH_MS}ms, visibility 0s ${SPLASH_MS}ms`
              : 'clip-path 480ms cubic-bezier(0.6, 0, 0.8, 0.45) 60ms, visibility 0s 540ms',
          }}
        >
          <div className={cn('flex items-start justify-between gap-6', REVEAL)} style={step(0)}>
            <p className="pt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-background/55">
              What MarketHub does
            </p>
            <button
              type="button"
              onClick={() => setBrief(false, true)}
              aria-label="Close"
              className="-mr-2 -mt-2 grid size-9 shrink-0 place-items-center rounded-full text-background/70 hover:bg-background/10 hover:text-background"
            >
              <X className="size-4" />
            </button>
          </div>

          <h2
            id="brief-title"
            className={cn(
              'mt-2 text-balance text-xl font-semibold leading-[1.1] tracking-tight sm:text-2xl',
              REVEAL,
            )}
            style={step(1)}
          >
            A marketplace where the money waits until you&apos;re happy.
          </h2>

          <ol className="mt-5 space-y-3.5 sm:mt-6 sm:space-y-4">
            {POINTS.map(([title, body], i) => (
              <li
                key={title}
                className={cn('grid grid-cols-[2rem_1fr]', REVEAL)}
                style={step(2 + i)}
              >
                <span className="pt-0.5 font-mono text-xs text-saffron">0{i + 1}</span>
                <span className="font-medium">{title}</span>
                <span className="col-start-2 text-sm text-background/65">{body}</span>
              </li>
            ))}
          </ol>

          <div
            className={cn('mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 sm:mt-7', REVEAL)}
            style={step(5)}
          >
            <Link
              href="/feed"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-background/90"
            >
              Browse listings <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/signup?next=%2Fcreate"
              className="text-sm font-medium text-background/80 underline-offset-4 hover:text-background hover:underline"
            >
              Start selling
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
