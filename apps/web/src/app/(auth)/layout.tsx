import { BadgeCheck, MessagesSquare, ShieldCheck } from 'lucide-react';
import { Wordmark } from '@/components/shell/wordmark';

const PROMISES = [
  {
    icon: BadgeCheck,
    title: 'People you can check',
    body: 'Verified emails, phones and IDs, plus reviews from real completed deals.',
  },
  {
    icon: ShieldCheck,
    title: 'Money held in escrow',
    body: 'Sellers get paid when you confirm delivery — not before.',
  },
  {
    icon: MessagesSquare,
    title: 'Haggle in the chat',
    body: 'Make, counter and accept offers right in the conversation.',
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden bg-foreground px-12 py-10 text-background lg:flex lg:flex-col">
        <Wordmark className="text-background [&_span.text-primary]:text-[hsl(160_60%_55%)]" />
        <div className="mt-auto max-w-sm">
          <p className="text-3xl font-semibold leading-tight tracking-tight">
            Trade with people who are who they say they are.
          </p>
          <ul className="mt-10 space-y-6">
            {PROMISES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="grid grid-cols-[auto_1fr] gap-x-3">
                <Icon className="mt-0.5 size-5 text-saffron" strokeWidth={1.75} />
                <span className="font-medium">{title}</span>
                <span className="col-start-2 text-sm text-background/70">{body}</span>
              </li>
            ))}
          </ul>
        </div>
        {/* soft saffron glow, bottom-left — decorative only */}
        <div
          aria-hidden
          className="absolute -bottom-32 -left-24 size-80 rounded-full bg-saffron/20 blur-3xl"
        />
      </aside>

      <main className="flex flex-col px-5 pb-10 pt-6 sm:px-10 lg:px-16 lg:pt-10">
        <Wordmark className="lg:hidden" />
        <div className="w-full max-w-sm flex-1 pt-10 sm:pt-16 lg:mx-0 lg:ml-[8%] lg:pt-[12vh]">
          {children}
        </div>
      </main>
    </div>
  );
}
