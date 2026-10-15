import { ImageResponse } from 'next/og';
import { BrandMark } from './icons/brand-mark';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';
export const runtime = 'edge';

// iOS rounds the corners itself; give it a full square.
export default function AppleIcon() {
  return new ImageResponse(<BrandMark size={180} maskable />, size);
}
