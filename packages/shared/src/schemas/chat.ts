import { z } from 'zod';
import { cursorQuerySchema } from './pagination';
import { UPLOAD_TYPES } from './uploads';

export const MESSAGE_TYPES = [
  'text',
  'image',
  'file',
  'system',
  'offer',
  'offer_response',
] as const;
/** The rest are written by the server (system notices, Phase 4 offers). */
export const CLIENT_MESSAGE_TYPES = ['text', 'image', 'file'] as const;

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_ATTACHMENTS = 6;

export const attachmentSchema = z
  .object({
    url: z.string().url().max(500),
    contentType: z.enum(Object.keys(UPLOAD_TYPES) as [keyof typeof UPLOAD_TYPES]),
    size: z.number().int().positive(),
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
  })
  .strict();

const bodySchema = z.string().trim().max(MAX_MESSAGE_LENGTH, 'Keep it under 4000 characters');

export const sendMessageSchema = z
  .object({
    conversationId: z.string().uuid(),
    type: z.enum(CLIENT_MESSAGE_TYPES).default('text'),
    body: bodySchema.optional(),
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).default([]),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.type === 'text' && !m.body) {
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'Write a message' });
    }
    if (m.type !== 'text' && !m.attachments.length) {
      ctx.addIssue({ code: 'custom', path: ['attachments'], message: 'Attach a file' });
    }
    if (m.type === 'image' && m.attachments.some((a) => !a.contentType.startsWith('image/'))) {
      ctx.addIssue({ code: 'custom', path: ['attachments'], message: 'Only images here' });
    }
  });

/** Opening a chat from a listing; an optional first message saves a round trip. */
export const startConversationSchema = z
  .object({
    listingId: z.string().uuid(),
    body: bodySchema.min(1).optional(),
  })
  .strict();

/** Marks everything up to and including `upTo` (default: latest) as read. */
export const readConversationSchema = z.object({ upTo: z.string().uuid().optional() }).strict();

export const typingSchema = z
  .object({ conversationId: z.string().uuid(), isTyping: z.boolean() })
  .strict();

export const conversationQuerySchema = cursorQuerySchema.extend({
  archived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type MessageType = (typeof MESSAGE_TYPES)[number];
export type Attachment = z.infer<typeof attachmentSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type StartConversationInput = z.infer<typeof startConversationSchema>;
export type ReadConversationInput = z.infer<typeof readConversationSchema>;
export type TypingInput = z.infer<typeof typingSchema>;
export type ConversationQuery = z.infer<typeof conversationQuerySchema>;
