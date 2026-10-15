import { ImageResponse } from 'next/og';
import { BrandMark } from './icons/brand-mark';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';
export const runtime = 'edge';

export default function Icon() {
  return new ImageResponse(<BrandMark size={64} />, size);
}
