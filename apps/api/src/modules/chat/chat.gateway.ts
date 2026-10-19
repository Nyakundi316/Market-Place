import { HttpException, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import {
  type ClientToServerEvents,
  type MessageDto,
  type ReadReceipt,
  readConversationSchema,
  sendMessageSchema,
  type ServerToClientEvents,
  typingSchema,
} from '@markethub/shared';
import type { Socket } from 'socket.io';
import { z, ZodError } from 'zod';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.module';
import { TokenService } from '../auth/token.service';
import { ChatService } from './chat.service';
import { type ChatServer, convRoom, RealtimeService, userRoom } from './realtime.service';

type SocketData = { user: RequestUser };
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type Ack<T> = { ok: true; data: T } | { ok: false; error: string; retryAfterMs?: number };

const conversationRef = z.object({ conversationId: z.string().uuid() });
const readSchema = readConversationSchema.extend(conversationRef.shape);

/** §5. Every event re-checks membership through ChatService or the socket's rooms. */
@WebSocketGateway()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chat: ChatService,
    private readonly realtime: RealtimeService,
    private readonly tokens: TokenService,
    private readonly db: PrismaService,
  ) {}

  afterInit(server: ChatServer) {
    this.realtime.attach(server);
    // §5: JWT in the handshake; anything invalid never gets a connection.
    server.use((socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string') return next(new Error('unauthorized'));
      this.loadUser(token)
        .then((user) => {
          (socket as ChatSocket).data.user = user;
          next();
        })
        .catch(() => next(new Error('unauthorized')));
    });
  }

  async handleConnection(socket: ChatSocket) {
    const { id } = socket.data.user;
    const conversations = await this.chat.conversationIds(id);
    await socket.join([userRoom(id), ...conversations.map(convRoom)]);
    if (await this.realtime.connected(id)) this.realtime.presence(id, 'online', conversations);
  }

  async handleDisconnect(socket: ChatSocket) {
    const user = socket.data.user;
    if (!user) return; // rejected in the handshake
    try {
      if (await this.realtime.disconnected(user.id)) {
        this.realtime.presence(user.id, 'offline', await this.chat.conversationIds(user.id));
      }
    } catch (err) {
      // Also runs during shutdown, after Redis/Prisma have closed; the presence TTL cleans up.
      this.logger.warn({ err }, 'presence cleanup on disconnect failed');
    }
  }

  @SubscribeMessage('message:send')
  async send(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<MessageDto>> {
    return this.run(socket, async (user) =>
      this.chat.send(user, sendMessageSchema.parse(body), socket.id),
    );
  }

  @SubscribeMessage('message:read')
  async read(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<ReadReceipt | null>> {
    return this.run(socket, async (user) => {
      const { conversationId, upTo } = readSchema.parse(body);
      return this.chat.read(user.id, conversationId, upTo);
    });
  }

  @SubscribeMessage('typing')
  typing(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    const parsed = typingSchema.safeParse(body);
    // Room membership was decided server-side, so it doubles as the authz check.
    if (!parsed.success || !socket.rooms.has(convRoom(parsed.data.conversationId))) return;
    socket
      .to(convRoom(parsed.data.conversationId))
      .emit('typing', { ...parsed.data, userId: socket.data.user.id });
  }

  @SubscribeMessage('ping:presence')
  async ping(@ConnectedSocket() socket: ChatSocket) {
    await this.realtime.refresh(socket.data.user.id);
  }

  @SubscribeMessage('conversation:join')
  async join(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<null>> {
    return this.run(socket, async (user) => {
      const { conversationId } = conversationRef.parse(body);
      await this.chat.membership(user.id, conversationId);
      await socket.join(convRoom(conversationId));
      return null;
    });
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private async loadUser(token: string): Promise<RequestUser> {
    const { sub } = this.tokens.verifyAccess(token);
    const user = await this.db.user.findUnique({
      where: { id: sub },
      select: { id: true, role: true, isEmailVerified: true, isBanned: true, isActive: true },
    });
    if (!user || !user.isActive || user.isBanned) throw new Error('unauthorized');
    return { id: user.id, role: user.role, isEmailVerified: user.isEmailVerified };
  }

  /**
   * Re-reads the user (bans and email verification apply mid-session, like
   * the HTTP guard) and turns errors into acks instead of dropping them.
   */
  private async run<T>(socket: ChatSocket, fn: (user: RequestUser) => Promise<T>): Promise<Ack<T>> {
    try {
      const user = await this.db.user.findUnique({
        where: { id: socket.data.user.id },
        select: { id: true, role: true, isEmailVerified: true, isBanned: true, isActive: true },
      });
      if (!user || !user.isActive || user.isBanned) {
        // Let the ack go out first, then drop the connection.
        setTimeout(() => socket.disconnect(true), 100);
        return { ok: false, error: 'This account has been suspended' };
      }
      socket.data.user = { id: user.id, role: user.role, isEmailVerified: user.isEmailVerified };
      return { ok: true, data: await fn(socket.data.user) };
    } catch (err) {
      if (err instanceof ZodError) return { ok: false, error: err.issues[0]?.message ?? 'Invalid' };
      if (err instanceof HttpException) {
        const res = err.getResponse() as string | { message?: string; retryAfterMs?: number };
        return typeof res === 'string'
          ? { ok: false, error: res }
          : { ok: false, error: res.message ?? err.message, retryAfterMs: res.retryAfterMs };
      }
      this.logger.error({ err }, 'chat event failed');
      return { ok: false, error: 'Something went wrong' };
    }
  }
}
