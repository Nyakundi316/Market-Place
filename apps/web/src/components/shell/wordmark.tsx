import Link from 'next/link';

/** Text wordmark; the dot is the brand's saffron "market stall" accent. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <Link href="/feed" className={`text-lg font-bold tracking-tight ${className}`}>
      market<span className="text-primary">hub</span>
      <span
        aria-hidden
        className="ml-0.5 inline-block size-1.5 rounded-full bg-saffron align-super"
      />
    </Link>
  );
}
