import type { INestApplication } from '@nestjs/common';
import type {
  ClientToServerEvents,
  ConversationDto,
  MessageDto,
  ServerToClientEvents,
} from '@markethub/shared';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, resetRateLimits, type TestUser } from './helpers';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Resolves with the next payload of `event`, or rejects after `ms`. */
function next<E extends keyof ServerToClientEvents>(socket: Client, event: E, ms = 3000) {
  return new Promise<Parameters<ServerToClientEvents[E]>[0]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms);
    socket.once(event, ((payload: Parameters<ServerToClientEvents[E]>[0]) => {
      clearTimeout(timer);
      resolve(payload);
    }) as never);
  });
}

/** True if `event` does NOT arrive within `ms`. */
async function silent(socket: Client, event: keyof ServerToClientEvents, ms = 400) {
  return next(socket, event, ms).then(
    () => false,
    () => true,
  );
}

describe('Chat gateway (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let url: string;
  let categoryId: string;
  let seller: TestUser;
  let buyer: TestUser;
  let listingId: string;
  const sockets: Client[] = [];
  const http = () => request(app.getHttpServer());

  async function connect(user: TestUser | { auth: string }): Promise<Client> {
    const socket: Client = io(url, {
      auth: { token: user.auth.replace('Bearer ', '') },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    // handleConnection joins rooms asynchronously; give it a beat.
    await new Promise((r) => setTimeout(r, 150));
    return socket;
  }

  async function openChat(): Promise<ConversationDto> {
    const res = await http()
      .post('/conversations')
      .set('Authorization', buyer.auth)
      .send({ listingId })
      .expect(201);
    return res.body;
  }

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    url = await app.getUrl();
    db = app.get(PrismaService);
    categoryId = (
      await db.category.create({ data: { name: 'Gateway', slug: `gw-${Date.now().toString(36)}` } })
    ).id;
  });
  beforeEach(async () => {
    await resetRateLimits();
    [seller, buyer] = await Promise.all([makeUser(app), makeUser(app)]);
    const slug = `gw-${Math.random().toString(36).slice(2, 10)}`;
    listingId = (
      await db.listing.create({
        data: {
          sellerId: seller.id,
          categoryId,
          type: 'product',
          title: `Gaming chair ${slug}`,
          slug,
          description: 'Ergonomic, reclining, armrests adjust in 4 directions.',
          price: 15000,
          currency: 'KES',
          status: 'active',
          publishedAt: new Date(),
        },
      })
    ).id;
  });
  afterEach(() => {
    while (sockets.length) sockets.pop()!.disconnect();
  });
  afterAll(() => app.close());

  it('rejects a handshake without a valid token', async () => {
    for (const auth of [{}, { token: 'nope' }]) {
      const socket = io(url, {
        auth,
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(socket as Client);
      const err = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
      expect(err.message).toBe('unauthorized');
    }
  });

  it('message:send persists, acks, and reaches the other member', async () => {
    const conversation = await openChat();
    const [b, s] = await Promise.all([connect(buyer), connect(seller)]);

    const arriving = next(s, 'message:new');
    const ack = await b.emitWithAck('message:send', {
      conversationId: conversation.id,
      type: 'text',
      body: 'Can you do 13k?',
      attachments: [],
    });
    expect(ack).toMatchObject({ ok: true, data: { body: 'Can you do 13k?', senderId: buyer.id } });
    const delivered = (await arriving) as MessageDto;
    expect(delivered.id).toBe((ack as { data: MessageDto }).data.id);
    expect(await db.message.count({ where: { conversationId: conversation.id } })).toBe(1);
  });

  it('REST sends are broadcast to sockets too', async () => {
    const conversation = await openChat();
    const s = await connect(seller);
    const arriving = next(s, 'message:new');
    await http()
      .post('/messages')
      .set('Authorization', buyer.auth)
      .send({ conversationId: conversation.id, body: 'via REST' })
      .expect(201);
    expect(await arriving).toMatchObject({ body: 'via REST' });
  });

  it('a conversation opened after connecting reaches the seller and joins their room', async () => {
    const s = await connect(seller);
    const announced = next(s, 'conversation:new');
    const conversation = await openChat();
    expect(await announced).toMatchObject({ id: conversation.id, role: 'seller' });

    const b = await connect(buyer);
    const arriving = next(s, 'message:new');
    await b.emitWithAck('message:send', {
      conversationId: conversation.id,
      type: 'text',
      body: 'hello',
      attachments: [],
    });
    expect(await arriving).toMatchObject({ body: 'hello' });
  });

  it('outsiders can’t send, type or join', async () => {
    const conversation = await openChat();
    const s = await connect(seller);
    const outsider = await connect(await makeUser(app));

    const ack = await outsider.emitWithAck('message:send', {
      conversationId: conversation.id,
      type: 'text',
      body: 'spam',
      attachments: [],
    });
    expect(ack).toEqual({ ok: false, error: 'Conversation not found' });
    outsider.emit('typing', { conversationId: conversation.id, isTyping: true });
    expect(await silent(s, 'typing')).toBe(true);
    expect(
      await outsider.emitWithAck('conversation:join', { conversationId: conversation.id }),
    ).toMatchObject({ ok: false });
  });

  it('typing goes to the other member only', async () => {
    const conversation = await openChat();
    const [b, s] = await Promise.all([connect(buyer), connect(seller)]);
    const seen = next(s, 'typing');
    b.emit('typing', { conversationId: conversation.id, isTyping: true });
    expect(await seen).toEqual({
      conversationId: conversation.id,
      isTyping: true,
      userId: buyer.id,
    });
    expect(await silent(b, 'typing')).toBe(true);
  });

  it('read receipts are broadcast', async () => {
    const conversation = await openChat();
    const [b, s] = await Promise.all([connect(buyer), connect(seller)]);
    const sent = await b.emitWithAck('message:send', {
      conversationId: conversation.id,
      type: 'text',
      body: 'ping',
      attachments: [],
    });
    const receipt = next(b, 'message:read');
    const ack = await s.emitWithAck('message:read', { conversationId: conversation.id });
    expect(ack).toMatchObject({ ok: true, data: { upTo: (sent as { data: MessageDto }).data.id } });
    expect(await receipt).toMatchObject({ byUser: seller.id });
  });

  it('presence: online on first socket, offline only when the last one closes', async () => {
    await openChat();
    const b = await connect(buyer);
    const online = next(b, 'presence:update');
    const s1 = await connect(seller);
    expect(await online).toEqual({ userId: seller.id, status: 'online' });

    const s2 = await connect(seller);
    s1.disconnect();
    expect(await silent(b, 'presence:update')).toBe(true);

    const offline = next(b, 'presence:update');
    s2.disconnect();
    expect(await offline).toEqual({ userId: seller.id, status: 'offline' });

    const list = await http().get('/conversations').set('Authorization', buyer.auth);
    expect(list.body.items[0].counterpart.online).toBe(false);
  });

  it('shares the 20/10s message budget and reports retryAfterMs', async () => {
    const conversation = await openChat();
    const b = await connect(buyer);
    const acks = [];
    for (let i = 0; i < 21; i++) {
      acks.push(
        await b.emitWithAck('message:send', {
          conversationId: conversation.id,
          type: 'text',
          body: `#${i}`,
          attachments: [],
        }),
      );
    }
    expect(acks.slice(0, 20).every((a) => a.ok)).toBe(true);
    expect(acks[20]).toMatchObject({ ok: false, retryAfterMs: expect.any(Number) });
  });

  it('a user banned mid-session is cut off on their next event', async () => {
    const conversation = await openChat();
    const b = await connect(buyer);
    await db.user.update({ where: { id: buyer.id }, data: { isBanned: true } });
    const dropped = new Promise((resolve) => b.once('disconnect', resolve));
    const ack = await b.emitWithAck('message:send', {
      conversationId: conversation.id,
      type: 'text',
      body: 'still here?',
      attachments: [],
    });
    expect(ack).toMatchObject({ ok: false });
    await dropped;
  });
});
