import { MessageCircle } from 'lucide-react';

/** Desktop's empty right-hand pane; on mobile the inbox (from the layout) is the page. */
export default function ChatIndexPage() {
  return (
    <div className="hidden flex-col justify-end bg-muted/30 p-10 lg:flex">
      <MessageCircle className="size-8 text-muted-foreground/60" strokeWidth={1.5} aria-hidden />
      <p className="mt-4 max-w-xs text-lg font-medium leading-snug">
        Pick a conversation to carry on where you left off.
      </p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        Keep deals in chat — payments made here are protected by escrow.
      </p>
    </div>
  );
}
