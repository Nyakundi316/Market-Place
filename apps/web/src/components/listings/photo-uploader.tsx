'use client';

import { MAX_LISTING_IMAGES } from '@markethub/shared';
import { ArrowLeft, ImagePlus, LoaderCircle, RotateCw, X } from 'lucide-react';
import Image from 'next/image';
import { useRef } from 'react';
import { ACCEPTED_IMAGES, uploadListingPhoto } from '@/lib/images';
import { cn } from '@/lib/utils';

export interface Photo {
  key: string;
  preview: string;
  url?: string;
  thumbUrl?: string;
  state: 'uploading' | 'done' | 'failed';
  file?: File;
}

/**
 * Uploads start the moment photos are picked, so by the time the seller has
 * typed a price they're usually done. First photo is the cover.
 */
export function PhotoUploader({
  photos,
  onChange,
}: {
  photos: Photo[];
  onChange: (update: (prev: Photo[]) => Photo[]) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const room = MAX_LISTING_IMAGES - photos.length;

  const start = (photo: Photo) => {
    if (!photo.file) return;
    onChange((ps) => ps.map((p) => (p.key === photo.key ? { ...p, state: 'uploading' } : p)));
    uploadListingPhoto(photo.file).then(
      (up) =>
        onChange((ps) => ps.map((p) => (p.key === photo.key ? { ...p, ...up, state: 'done' } : p))),
      () => onChange((ps) => ps.map((p) => (p.key === photo.key ? { ...p, state: 'failed' } : p))),
    );
  };

  const add = (files: FileList | null) => {
    const picked = Array.from(files ?? [])
      .filter((f) => ACCEPTED_IMAGES.includes(f.type))
      .slice(0, room)
      .map<Photo>((file) => ({
        key: crypto.randomUUID(),
        preview: URL.createObjectURL(file),
        state: 'uploading',
        file,
      }));
    onChange((ps) => [...ps, ...picked]);
    picked.forEach(start);
  };

  const move = (i: number) =>
    onChange((ps) => {
      const next = [...ps];
      [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
      return next;
    });

  return (
    <div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((p, i) => (
          <li
            key={p.key}
            className="group relative aspect-square overflow-hidden rounded-lg bg-muted"
          >
            <Image
              src={p.thumbUrl ?? p.preview}
              alt=""
              fill
              unoptimized
              sizes="160px"
              className="object-cover"
            />
            {i === 0 && (
              <span className="absolute bottom-1 left-1 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-background">
                Cover
              </span>
            )}
            {p.state !== 'done' && (
              <span className="absolute inset-0 grid place-items-center bg-background/60">
                {p.state === 'uploading' ? (
                  <LoaderCircle className="size-5 animate-spin" aria-label="Uploading" />
                ) : (
                  <button
                    type="button"
                    onClick={() => start(p)}
                    className="flex items-center gap-1 rounded-md bg-card px-2 py-1 text-xs font-medium text-destructive shadow-card"
                  >
                    <RotateCw className="size-3.5" /> Retry
                  </button>
                )}
              </span>
            )}
            <div className="absolute right-1 top-1 flex gap-1">
              {i > 0 && (
                <button
                  type="button"
                  aria-label={`Move photo ${i + 1} earlier`}
                  onClick={() => move(i)}
                  className="grid size-7 place-items-center rounded-full bg-card/90 shadow-card"
                >
                  <ArrowLeft className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => onChange((ps) => ps.filter((x) => x.key !== p.key))}
                className="grid size-7 place-items-center rounded-full bg-card/90 shadow-card"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
        {room > 0 && (
          <li className={cn(photos.length === 0 && 'col-span-3 sm:col-span-4')}>
            <button
              type="button"
              onClick={() => picker.current?.click()}
              className={cn(
                'flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary',
                photos.length === 0 ? 'aspect-[3/1] sm:aspect-[4/1]' : 'aspect-square',
              )}
            >
              <ImagePlus className="size-6" strokeWidth={1.5} />
              {photos.length === 0 ? 'Add photos' : 'Add'}
            </button>
          </li>
        )}
      </ul>
      <input
        ref={picker}
        type="file"
        accept={ACCEPTED_IMAGES}
        multiple
        className="sr-only"
        aria-label="Choose photos"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        {photos.length}/{MAX_LISTING_IMAGES} · JPEG, PNG or WebP. Clear, daylight photos sell
        faster.
      </p>
    </div>
  );
}
