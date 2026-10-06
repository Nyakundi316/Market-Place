import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page isn&apos;t here</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The listing may have sold, or the link is wrong.
      </p>
      <Button asChild variant="outline" className="mt-6 self-start">
        <Link href="/feed">Back to Discover</Link>
      </Button>
    </main>
  );
}
