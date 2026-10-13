'use client';

import { usePathname } from 'next/navigation';
import { ConversationList } from '@/components/chat/conversation-list';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { cn } from '@/lib/utils';

/**
 * Desktop: inbox and thread side by side in one framed pane.
 * Mobile: the inbox is the page; a thread takes over the screen.
 */
export function ChatShell({ children }: { children: React.ReactNode }) {
  const ready = useRequireAuth();
  const pathname = usePathname();
  const match = /^\/chat\/([^/]+)/.exec(pathname);
  const activeId = match && match[1] !== 'new' ? match[1] : undefined;

  if (!ready) return null;
  return (
    <div className="-mx-4 lg:mx-0 lg:grid lg:h-[calc(100dvh-5rem)] lg:grid-cols-[20rem_minmax(0,1fr)] lg:overflow-hidden lg:rounded-xl lg:border lg:bg-card lg:shadow-card">
      <section
        aria-label="Conversations"
        className={cn('flex-col lg:flex lg:min-h-0 lg:border-r', match ? 'hidden' : 'flex')}
      >
        <ConversationList activeId={activeId} />
      </section>
      {children}
    </div>
  );
}
