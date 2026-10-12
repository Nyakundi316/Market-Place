'use client';

import type { ListingImageDto } from '@markethub/shared';
import { ImageOff } from 'lucide-react';
import Image from 'next/image';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Swipeable on touch (CSS scroll-snap, no carousel library), thumbnails on
 * desktop. Bleeds to the screen edge on mobile.
 */
export function Gallery({ images, title }: { images: ListingImageDto[]; title: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  if (!images.length) {
    return (
      <div className="-mx-4 grid aspect-[4/3] place-items-center bg-muted text-muted-foreground sm:mx-0 sm:rounded-xl">
        <ImageOff className="size-8" strokeWidth={1.5} aria-hidden />
        <span className="sr-only">No photos</span>
      </div>
    );
  }

  const go = (i: number) => {
    const el = track.current;
    el?.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div>
      <div className="relative -mx-4 sm:mx-0">
        <div
          ref={track}
          onScroll={(e) => {
            const el = e.currentTarget;
            setIndex(Math.round(el.scrollLeft / el.clientWidth));
          }}
          className="flex aspect-[4/3] snap-x snap-mandatory overflow-x-auto bg-muted [scrollbar-width:none] sm:rounded-xl"
          aria-roledescription="carousel"
          aria-label={`Photos of ${title}`}
        >
          {images.map((img, i) => (
            <div
              key={img.id}
              className="relative h-full w-full shrink-0 snap-center"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${images.length}`}
            >
              <Image
                src={img.url}
                alt={i === 0 ? title : ''}
                fill
                unoptimized
                priority={i === 0}
                sizes="(min-width: 1024px) 60vw, 100vw"
                className="object-contain"
              />
            </div>
          ))}
        </div>
        {images.length > 1 && (
          <span className="tabular absolute bottom-3 right-3 rounded-full bg-foreground/70 px-2 py-0.5 text-xs text-background">
            {index + 1}/{images.length}
          </span>
        )}
      </div>

      {images.length > 1 && (
        <div className="mt-3 hidden gap-2 sm:flex">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === index}
              className={cn(
                'relative size-16 overflow-hidden rounded-md ring-offset-2 ring-offset-background',
                i === index ? 'ring-2 ring-primary' : 'opacity-70 hover:opacity-100',
              )}
            >
              <Image
                src={img.thumbUrl ?? img.url}
                alt=""
                fill
                unoptimized
                sizes="64px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
