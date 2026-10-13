import type { ClientToServerEvents, ServerToClientEvents } from '@markethub/shared';
import { io, type Socket } from 'socket.io-client';
import { refreshSession } from '@/lib/api';
import { useAuth } from '@/stores/auth';

export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const PING_MS = 30_000; // §5: refreshes the 60s presence TTL

let socket: ChatSocket | null = null;
let ping: ReturnType<typeof setInterval> | null = null;

/**
 * One socket per tab, straight to the API (§3 addendum). The token is read on
 * every (re)connect, so a refreshed access token is picked up automatically.
 */
export function getSocket(): ChatSocket {
  if (socket) return socket;
  socket = io(process.env.NEXT_PUBLIC_API_URL!, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    auth: (cb) => cb({ token: useAuth.getState().accessToken }),
  });

  socket.on('connect', () => {
    if (ping) clearInterval(ping);
    ping = setInterval(() => socket?.emit('ping:presence'), PING_MS);
  });
  socket.on('disconnect', () => {
    if (ping) clearInterval(ping);
    ping = null;
  });
  // Access tokens last 15 minutes; a rejected handshake usually just means "refresh".
  socket.on('connect_error', async (err) => {
    if (err.message !== 'unauthorized') return; // network trouble: socket.io retries itself
    if (await refreshSession()) socket?.connect();
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
}
