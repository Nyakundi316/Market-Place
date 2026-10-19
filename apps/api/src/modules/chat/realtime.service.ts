import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type {
  ClientToServerEvents,
  MessageDto,
  PresenceStatus,
  ServerToClientEvents,
} from '@markethub/shared';
import type Redis from 'ioredis';
import type { Server } from 'socket.io';
import { InjectRedis } from '../../redis/redis.module';

export type ChatServer = Server<ClientToServerEvents, ServerToClientEvents>;

export const userRoom = (id: string) => `user:${id}`;
export const convRoom = (id: string) => `conv:${id}`;
const presenceKey = (id: string) => `presence:${id}`;
export const PRESENCE_TTL_S = 60;

/**
 * The seam between REST and sockets: services persist, then broadcast here.
 * The gateway hands over its server on init; until then (or in tests without
 * a gateway) broadcasts are no-ops. Rooms span instances via the Redis adapter.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private server: ChatServer | null = null;

  constructor(@InjectRedis() private readonly redis: Redis) {}

  attach(server: ChatServer) {
    this.server = server;
  }

  /**
   * Nest runs this before disposing the socket adapter; sockets closing after
   * that would otherwise publish through Redis clients that are already gone.
   */
  onModuleDestroy() {
    this.server = null;
  }

  toConversation<E extends keyof ServerToClientEvents>(
    conversationId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ) {
    this.server?.to(convRoom(conversationId)).emit(event, ...args);
  }

  /**
   * A sent message goes to the room minus the socket that sent it: that tab
   * already has it from the ack, and a second copy would land beside its
   * optimistic bubble until the ack arrived. The sender's other tabs still get it.
   */
  messageNew(message: MessageDto, senderSocketId?: string) {
    const room = this.server?.to(convRoom(message.conversationId));
    (senderSocketId ? room?.except(senderSocketId) : room)?.emit('message:new', message);
  }

  toUser<E extends keyof ServerToClientEvents>(
    userId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ) {
    this.server?.to(userRoom(userId)).emit(event, ...args);
  }

  /** Tells the people a user is talking to (not the user) that they came or went. */
  presence(userId: string, status: PresenceStatus, conversationIds: string[]) {
    if (!conversationIds.length) return;
    this.server
      ?.to(conversationIds.map(convRoom))
      .except(userRoom(userId))
      .emit('presence:update', { userId, status });
  }

  /** Drops a user's live sockets everywhere (a ban); the handshake refuses them after. */
  disconnectUser(userId: string) {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }

  /** Puts every live socket of these users into a conversation room. */
  joinConversation(conversationId: string, userIds: string[]) {
    this.server?.in(userIds.map(userRoom)).socketsJoin(convRoom(conversationId));
  }

  // ─── Presence (§5: SET presence:{uid} TTL 60s, refreshed by ping) ──────

  /**
   * A counter, not a flag: with two tabs open, closing one mustn't mark the
   * user offline. The TTL still clears it if an instance dies without cleanup.
   */
  async connected(userId: string) {
    const [[, n]] = (await this.redis
      .multi()
      .incr(presenceKey(userId))
      .expire(presenceKey(userId), PRESENCE_TTL_S)
      .exec()) as [[null, number], unknown];
    return n === 1; // first socket → came online
  }

  async disconnected(userId: string) {
    const n = await this.redis.decr(presenceKey(userId));
    if (n > 0) return false;
    await this.redis.del(presenceKey(userId));
    return true; // last socket → went offline
  }

  async refresh(userId: string) {
    // SET NX restores a key that expired while the socket stayed up.
    await this.redis
      .multi()
      .set(presenceKey(userId), 1, 'EX', PRESENCE_TTL_S, 'NX')
      .expire(presenceKey(userId), PRESENCE_TTL_S)
      .exec();
  }

  async online(userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const values = await this.redis.mget(userIds.map(presenceKey));
    return new Set(userIds.filter((_, i) => Number(values[i]) > 0));
  }
}
