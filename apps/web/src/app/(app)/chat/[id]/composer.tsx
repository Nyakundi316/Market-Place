'use client';

import { type Attachment, MAX_ATTACHMENTS, MAX_MESSAGE_LENGTH } from '@markethub/shared';
import { Handshake, ImagePlus, Loader2, SendHorizontal, X } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ACCEPTED_IMAGES, uploadChatPhoto } from '@/lib/images';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';

const TYPING_EVERY_MS = 3_000; // re-announce while typing; stop after this much quiet

type Pending = { key: string; preview: string; attachment?: Attachment };

export function Composer({
  conversationId,
  disabled,
  onSend,
  onMakeOffer,
}: {
  conversationId: string;
  disabled?: boolean;
  onSend: (draft: { body?: string; attachments?: Attachment[] }) => Promise<void>;
  /** Absent when the listing can't take offers (sold, job post). */
  onMakeOffer?: () => void;
}) {
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<Pending[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const typing = useRef<{ since: number; timer?: ReturnType<typeof setTimeout> }>({ since: 0 });

  const uploading = photos.some((p) => !p.attachment);
  const canSend = !disabled && !uploading && (text.trim().length > 0 || photos.length > 0);

  const stopTyping = () => {
    clearTimeout(typing.current.timer);
    if (typing.current.since) getSocket().emit('typing', { conversationId, isTyping: false });
    typing.current = { since: 0 };
  };

  // Leaving the thread mid-sentence shouldn't leave the dots up for the other person.
  useEffect(() => () => stopTyping(), [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (value: string) => {
    setText(value);
    const el = area.current!;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;

    if (!value.trim()) return stopTyping();
    const now = Date.now();
    if (now - typing.current.since > TYPING_EVERY_MS) {
      getSocket().emit('typing', { conversationId, isTyping: true });
      typing.current.since = now;
    }
    clearTimeout(typing.current.timer);
    typing.current.timer = setTimeout(stopTyping, TYPING_EVERY_MS);
  };

  const addPhotos = async (files: FileList | null) => {
    const picked = Array.from(files ?? []).slice(0, MAX_ATTACHMENTS - photos.length);
    if (file.current) file.current.value = '';
    const pending = picked.map((f) => ({
      key: crypto.randomUUID(),
      preview: URL.createObjectURL(f),
    }));
    setPhotos((p) => [...p, ...pending]);
    await Promise.all(
      picked.map(async (f, i) => {
        const { key } = pending[i]!;
        try {
          const attachment = await uploadChatPhoto(f);
          setPhotos((p) => p.map((x) => (x.key === key ? { ...x, attachment } : x)));
        } catch {
          toast.error(`Couldn't upload ${f.name}`);
          setPhotos((p) => p.filter((x) => x.key !== key));
        }
      }),
    );
  };

  const submit = () => {
    if (!canSend) return;
    const draft = {
      body: text.trim() || undefined,
      attachments: photos.map((p) => p.attachment!),
    };
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setText('');
    setPhotos([]);
    if (area.current) area.current.style.height = 'auto';
    stopTyping();
    void onSend(draft);
    area.current?.focus();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="pb-safe border-t bg-background/95 px-2 pt-2 backdrop-blur lg:px-4 lg:pb-3"
    >
      {photos.length > 0 && (
        <ul className="mb-2 flex gap-2 overflow-x-auto px-1">
          {photos.map((p) => (
            <li key={p.key} className="relative shrink-0">
              <Image
                src={p.preview}
                alt=""
                width={64}
                height={64}
                unoptimized
                className={cn('size-16 rounded-lg object-cover', !p.attachment && 'opacity-50')}
              />
              {!p.attachment ? (
                <Loader2
                  className="absolute inset-0 m-auto size-5 animate-spin"
                  aria-label="Uploading"
                />
              ) : (
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => setPhotos((all) => all.filter((x) => x.key !== p.key))}
                  className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background"
                >
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-1.5 pb-2">
        <input
          ref={file}
          type="file"
          accept={ACCEPTED_IMAGES}
          multiple
          hidden
          aria-label="Choose photos to send"
          onChange={(e) => void addPhotos(e.target.files)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Attach photos"
          disabled={disabled || photos.length >= MAX_ATTACHMENTS}
          onClick={() => file.current?.click()}
          className="shrink-0 rounded-full text-muted-foreground"
        >
          <ImagePlus className="size-5" />
        </Button>
        {onMakeOffer && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Make an offer"
            title="Make an offer"
            disabled={disabled}
            onClick={onMakeOffer}
            className="-ml-1.5 shrink-0 rounded-full text-muted-foreground"
          >
            <Handshake className="size-5" />
          </Button>
        )}
        <textarea
          ref={area}
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          aria-label="Message"
          placeholder="Write a message…"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={stopTyping}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line; IME composition is left alone.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-input bg-card px-4 py-2.5 text-[15px] leading-snug shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send"
          disabled={!canSend}
          className="shrink-0 rounded-full"
        >
          <SendHorizontal className="size-[18px]" />
        </Button>
      </div>
    </form>
  );
}
