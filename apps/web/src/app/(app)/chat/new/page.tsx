'use client';

import type { ConversationDto } from '@markethub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { chatKeys } from '@/hooks/use-chat';
import { api, ApiError } from '@/lib/api';

/** /chat/new?listing=… — find-or-create, then hand over to the thread. */
export default function NewChatPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const search = useSearchParams();
  const listingId = search.get('listing');
  const [error, setError] = useState<{ message: string; fix?: { href: string; label: string } }>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev
    started.current = true;
    if (!listingId) {
      setError({ message: 'That link is missing the listing.' });
      return;
    }
    api<ConversationDto>('/conversations', { method: 'POST', body: { listingId } })
      .then((c) => {
        qc.setQueryData(chatKeys.one(c.id), c);
        void qc.invalidateQueries({ queryKey: chatKeys.list });
        const offer = search.get('offer') ? '?offer=1' : ''; // Phase 4 opens the offer sheet
        router.replace(`/chat/${c.id}${offer}`);
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : 'Something went wrong';
        let fix: { href: string; label: string } | undefined;
        if (/confirm your email/i.test(message))
          fix = { href: '/settings', label: 'Account settings' };
        if (/profile/i.test(message))
          fix = {
            href: `/onboarding?next=${encodeURIComponent(`/chat/new?listing=${listingId}`)}`,
            label: 'Set up your profile',
          };
        setError({ message, fix });
      });
  }, [listingId, qc, router, search]);

  return (
    <div className="flex flex-col justify-center p-6 lg:p-10">
      {error ? (
        <div className="max-w-sm">
          <p className="font-medium">We couldn&apos;t open this chat</p>
          <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
          <div className="mt-4 flex gap-4 text-sm">
            {error.fix && (
              <Link
                href={error.fix.href}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {error.fix.label}
              </Link>
            )}
            <button
              type="button"
              onClick={() => router.back()}
              className="text-muted-foreground hover:text-foreground"
            >
              Go back
            </button>
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Opening chat…
        </p>
      )}
    </div>
  );
}
