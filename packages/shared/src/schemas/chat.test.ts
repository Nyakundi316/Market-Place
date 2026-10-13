import { describe, expect, it } from 'vitest';
import {
  conversationQuerySchema,
  MAX_MESSAGE_LENGTH,
  sendMessageSchema,
  startConversationSchema,
} from './chat';
import { signUploadSchema } from './uploads';

const conversationId = '6f1c2f8e-1b7a-4c35-9a59-0d7b8f0a2c11';
const photo = { url: 'https://cdn.test/chat/u/a.jpg', contentType: 'image/jpeg', size: 1200 };

describe('sendMessageSchema', () => {
  it('defaults to a trimmed text message with no attachments', () => {
    expect(sendMessageSchema.parse({ conversationId, body: '  Still available?  ' })).toEqual({
      conversationId,
      type: 'text',
      body: 'Still available?',
      attachments: [],
    });
  });

  it('text needs a body that is not just whitespace', () => {
    expect(sendMessageSchema.safeParse({ conversationId, body: '   ' }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ conversationId }).success).toBe(false);
  });

  it('caps length', () => {
    const body = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
    expect(sendMessageSchema.safeParse({ conversationId, body }).success).toBe(false);
  });

  it('image needs an image attachment; caption optional', () => {
    expect(
      sendMessageSchema.safeParse({ conversationId, type: 'image', attachments: [photo] }).success,
    ).toBe(true);
    expect(sendMessageSchema.safeParse({ conversationId, type: 'image' }).success).toBe(false);
    const video = { ...photo, contentType: 'video/mp4' };
    expect(
      sendMessageSchema.safeParse({ conversationId, type: 'image', attachments: [video] }).success,
    ).toBe(false);
    expect(
      sendMessageSchema.safeParse({ conversationId, type: 'file', attachments: [video] }).success,
    ).toBe(true);
  });

  it('clients cannot forge system or offer messages, or smuggle fields', () => {
    for (const type of ['system', 'offer', 'offer_response']) {
      expect(sendMessageSchema.safeParse({ conversationId, type, body: 'x' }).success).toBe(false);
    }
    expect(
      sendMessageSchema.safeParse({ conversationId, body: 'hi', senderId: conversationId }).success,
    ).toBe(false);
  });
});

describe('startConversationSchema', () => {
  it('first message is optional but cannot be empty', () => {
    expect(startConversationSchema.safeParse({ listingId: conversationId }).success).toBe(true);
    expect(
      startConversationSchema.safeParse({ listingId: conversationId, body: ' ' }).success,
    ).toBe(false);
  });
});

describe('conversationQuerySchema', () => {
  it('parses the archived flag from the query string', () => {
    expect(conversationQuerySchema.parse({ archived: 'true' })).toMatchObject({
      archived: true,
      limit: 20,
    });
    expect(conversationQuerySchema.parse({}).archived).toBeUndefined();
  });
});

describe('chat uploads', () => {
  it('allows images and mp4 for chat', () => {
    for (const contentType of ['image/png', 'video/mp4']) {
      expect(signUploadSchema.safeParse({ purpose: 'chat', contentType, size: 10 }).success).toBe(
        true,
      );
    }
  });
});
