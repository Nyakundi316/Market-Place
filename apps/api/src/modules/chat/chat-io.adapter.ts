import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Env } from '@markethub/shared';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO with §9 CORS (web origin only) and the §5 Redis adapter so rooms
 * span API instances. Lives here rather than in @WebSocketGateway() options
 * because decorators are evaluated before the env is validated.
 */
export class ChatIoAdapter extends IoAdapter {
  private clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly env: Env,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.env.WEB_URL, credentials: true },
      // Token-only auth, no cookies needed; long-polling stays as a fallback.
      transports: ['websocket'], // no polling: it would need sticky sessions across machines
    }) as Server;

    const pub = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 2 });
    const sub = pub.duplicate();
    this.clients = [pub, sub];
    // Pub/sub ignores the DB number, so separate environments by channel prefix.
    server.adapter(createAdapter(pub, sub, { key: `socket.io:${this.env.NODE_ENV}` }));
    return server;
  }

  override async dispose() {
    await super.dispose();
    await Promise.all(this.clients.map((c) => c.quit().catch(() => c.disconnect())));
  }
}
