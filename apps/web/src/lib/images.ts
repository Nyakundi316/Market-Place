import type { PresignedUploadDto } from '@markethub/shared';
import { api } from './api';

const FULL_EDGE = 1600;
const THUMB_EDGE = 480;

/**
 * Downscales in the browser before upload: phones shoot 4–12 MB photos and
 * buyers on mobile data shouldn't pay for that. Honours EXIF rotation.
 */
async function resize(file: File, maxEdge: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', quality));
  // Safari < 17 can't encode WebP and silently returns PNG or null; fall back to JPEG.
  if (blob && blob.type === 'image/webp') return blob;
  return new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', quality),
  );
}

async function signAndPut(blob: Blob, purpose: 'listing' | 'avatar' | 'chat' | 'verification') {
  const contentType = blob.type as 'image/webp' | 'image/jpeg';
  const signed = await api<PresignedUploadDto>('/images/sign', {
    method: 'POST',
    body: { purpose, contentType, size: blob.size },
  });
  const res = await fetch(signed.uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': contentType },
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return signed;
}

const put = async (blob: Blob, purpose: 'listing' | 'avatar' | 'chat') =>
  (await signAndPut(blob, purpose)).publicUrl!; // public purposes always get one

export async function uploadListingPhoto(file: File) {
  const [full, thumb] = await Promise.all([
    resize(file, FULL_EDGE, 0.82),
    resize(file, THUMB_EDGE, 0.75),
  ]);
  const [url, thumbUrl] = await Promise.all([put(full, 'listing'), put(thumb, 'listing')]);
  return { url, thumbUrl };
}

export async function uploadAvatar(file: File) {
  return put(await resize(file, 512, 0.85), 'avatar');
}

/** Chat photos: one resized copy, with dimensions so the bubble can reserve space. */
export async function uploadChatPhoto(file: File) {
  const blob = await resize(file, FULL_EDGE, 0.8);
  const { width, height } = await createImageBitmap(blob).then((b) => {
    const size = { width: b.width, height: b.height };
    b.close();
    return size;
  });
  const url = await put(blob, 'chat');
  return {
    url,
    contentType: blob.type as 'image/webp' | 'image/jpeg',
    size: blob.size,
    width,
    height,
  };
}

/**
 * ID / business documents go to the private bucket: we keep only the key,
 * there is no public URL. Sharp enough to read, not phone-camera huge.
 */
export async function uploadVerificationDocument(file: File) {
  return (await signAndPut(await resize(file, 2000, 0.88), 'verification')).key;
}

export const ACCEPTED_IMAGES = 'image/jpeg,image/png,image/webp';
