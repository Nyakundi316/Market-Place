'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface ReasonPrompt {
  title: string;
  description?: string;
  label: string;
  confirm: string;
  minLength: number;
  destructive?: boolean;
  run: (text: string) => Promise<unknown>;
}

/** Every moderation action asks why; the answer goes into the audit log. */
export function ReasonDialog({
  prompt,
  onClose,
}: {
  prompt: ReasonPrompt | null;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => {
    setText('');
    onClose();
  };
  return (
    <Dialog open={!!prompt} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        {prompt && (
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await prompt.run(text.trim());
                close();
              } catch {
                // The action already toasted why; keep the dialog open to retry.
              } finally {
                setBusy(false);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{prompt.title}</DialogTitle>
              {prompt.description && <DialogDescription>{prompt.description}</DialogDescription>}
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="reason-text">{prompt.label}</Label>
              <Textarea
                id="reason-text"
                rows={3}
                maxLength={1000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={prompt.destructive ? 'destructive' : 'default'}
                disabled={busy || text.trim().length < prompt.minLength}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {prompt.confirm}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
