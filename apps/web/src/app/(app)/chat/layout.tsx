import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ChatShell } from './chat-shell';

export const metadata: Metadata = { title: 'Chats', robots: { index: false } };

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <ChatShell>{children}</ChatShell>
    </Suspense>
  );
}
