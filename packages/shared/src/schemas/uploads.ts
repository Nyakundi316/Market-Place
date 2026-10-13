import { z } from 'zod';

// §9: the only types we accept, and the hard size cap.
export const UPLOAD_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
} as const;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const signUploadSchema = z
  .object({
    purpose: z.enum(['listing', 'avatar', 'cover', 'chat']),
    contentType: z.enum(Object.keys(UPLOAD_TYPES) as [keyof typeof UPLOAD_TYPES]),
    size: z.number().int().positive().max(MAX_UPLOAD_BYTES, 'Files must be 20 MB or smaller'),
  })
  .strict()
  .refine((v) => ['listing', 'chat'].includes(v.purpose) || v.contentType.startsWith('image/'), {
    path: ['contentType'],
    message: 'Profile pictures must be images',
  });

export const setAvatarSchema = z.object({ url: z.string().url().max(500) }).strict();

export type SignUploadInput = z.infer<typeof signUploadSchema>;
export type UploadContentType = keyof typeof UPLOAD_TYPES;
