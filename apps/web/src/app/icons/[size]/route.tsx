import { ImageResponse } from 'next/og';
import { notFound } from 'next/navigation';
import { BrandMark } from '../brand-mark';

// /icons/192, /icons/512, /icons/512-maskable — what the web manifest asks for.
const SIZES: Record<string, { px: number; maskable: boolean }> = {
  '192': { px: 192, maskable: false },
  '512': { px: 512, maskable: false },
  '512-maskable': { px: 512, maskable: true },
};

// next/og is happiest on the edge runtime; responses are cached for a year.
export const runtime = 'edge';

export function GET(_req: Request, { params }: { params: { size: string } }) {
  const spec = SIZES[params.size];
  if (!spec) notFound();
  return new ImageResponse(<BrandMark size={spec.px} maskable={spec.maskable} />, {
    width: spec.px,
    height: spec.px,
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
