import type { Currency } from '../schemas/catalog';
import type {
  Attachment,
  MessageType,
  ReadConversationInput,
  SendMessageInput,
  TypingInput,
} from '../schemas/chat';
import type { ListingStatus } from './catalog';

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  type: MessageType;
  /** Raw text — escape on render (§5). */
  body: string | null;
  attachments: Attachment[];
  offerId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface ConversationDto {
  id: string;
  /** Which side of the deal the viewer is on. */
  role: 'buyer' | 'seller';
  listing: {
    id: string;
    slug: string;
    title: string;
    status: ListingStatus;
    price: string | null;
    currency: Currency;
    coverThumbUrl: string | null;
  };
  counterpart: {
    userId: string;
    username: string | null;
    displayName: string;
    avatarUrl: string | null;
    idVerified: boolean;
    online: boolean;
  };
  lastMessage: MessageDto | null;
  lastMessageAt: string | null;
  unread: number;
  isArchived: boolean;
  createdAt: string;
}

export type PresenceStatus = 'online' | 'offline';

export interface ReadReceipt {
  conversationId: string;
  /** Last message id now read. */
  upTo: string;
  byUser: string;
  readAt: string;
}

export type SocketAck<T> = (
  res: { ok: true; data: T } | { ok: false; error: string; retryAfterMs?: number },
) => void;

/** §5 events, typed for both socket.io server and client. */
export interface ClientToServerEvents {
  'message:send': (msg: SendMessageInput, ack: SocketAck<MessageDto>) => void;
  'message:read': (
    msg: ReadConversationInput & { conversationId: string },
    ack?: SocketAck<ReadReceipt | null>,
  ) => void;
  typing: (msg: TypingInput) => void;
  'ping:presence': () => void;
  /** Join the room of a conversation created after connecting. */
  'conversation:join': (msg: { conversationId: string }, ack?: SocketAck<null>) => void;
}

export interface ServerToClientEvents {
  'message:new': (msg: MessageDto) => void;
  'message:read': (receipt: ReadReceipt) => void;
  typing: (msg: TypingInput & { userId: string }) => void;
  'presence:update': (msg: { userId: string; status: PresenceStatus }) => void;
  'conversation:new': (conversation: ConversationDto) => void;
}
