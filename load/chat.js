import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import ws from 'k6/ws';
import { API, data, tokenFor } from './lib/env.js';
import { budget, latency, limit, PEAK, steps } from './lib/ramp.js';

/**
 * Real-time chat under load. VUs pair up on the seeded conversations (even VU
 * = buyer, odd VU = seller) and talk over Socket.IO's websocket transport,
 * spoken by hand (Engine.IO v4 framing): 0 open · 2/3 ping/pong · 40 connect
 * (with the JWT in the auth payload, §5) · 42 event · 43 ack.
 *
 * Measures send→ack (persisted, §5 "persist then broadcast") and send→seen by
 * the other side (Redis adapter fan-out across instances).
 *
 *   k6 run -e API_URL=https://api.staging… -e JWT_ACCESS_SECRET=… load/chat.js
 *   … -e PEAK=1000 load/chat.js     ramp until something breaks (lib/ramp.js)
 */
export const options = {
  scenarios: {
    chat: PEAK
      ? {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: steps(PEAK, __ENV.HOLD),
          gracefulRampDown: '70s', // longer than one 60 s session, so ramp-down doesn't cut sockets
        }
      : {
          executor: 'constant-vus',
          vus: Number(__ENV.VUS || (__ENV.SMOKE ? 2 : 100)), // keep even: two per conversation
          duration: __ENV.DURATION || (__ENV.SMOKE ? '15s' : '5m'),
        },
  },
  thresholds: {
    chat_ack_ms: latency(`p(95)<${budget(250)}`),
    chat_delivery_ms: latency(`p(95)<${budget(500)}`),
    chat_errors: [limit('count<10')],
    ws_connecting: latency(`p(95)<${budget(1000, 3)}`),
  },
};

const ackMs = new Trend('chat_ack_ms', true);
const deliveryMs = new Trend('chat_delivery_ms', true);
const errors = new Counter('chat_errors');

// Under the §9 limit of 20 messages / 10 s per user, with headroom.
const SEND_EVERY_MS = 3000;
const SESSION_MS = __ENV.SMOKE ? 12_000 : 60_000;

export default function () {
  const { conversations } = data();
  const pair = conversations[Math.floor((__VU - 1) / 2) % conversations.length];
  const me = __VU % 2 === 1 ? pair.buyerId : pair.sellerId;
  const url = `${API.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;

  const res = ws.connect(url, {}, (socket) => {
    let ackId = 0;
    const pending = new Map(); // ackId → sent at
    const inFlight = new Map(); // body → sent at, for delivery timing on the other side

    socket.on('message', (raw) => {
      if (raw === '2') return socket.send('3'); // Engine.IO ping → pong
      if (raw.startsWith('0')) return socket.send(`40${JSON.stringify({ token: tokenFor(me) })}`);
      if (raw.startsWith('44')) {
        errors.add(1); // connect refused (bad token, banned…)
        return socket.close();
      }
      if (raw.startsWith('40')) {
        // Connected: start talking.
        socket.setInterval(() => {
          const body = `load ${__VU}-${__ITER}-${Date.now()}`;
          const id = ackId++;
          pending.set(id, Date.now());
          socket.send(
            `42${id}${JSON.stringify(['message:send', { conversationId: pair.id, type: 'text', body, attachments: [] }])}`,
          );
        }, SEND_EVERY_MS);
        return;
      }
      const ack = /^43(\d+)(.*)$/.exec(raw);
      if (ack) {
        const sentAt = pending.get(Number(ack[1]));
        pending.delete(Number(ack[1]));
        const [result] = JSON.parse(ack[2]);
        if (!result || !result.ok) errors.add(1);
        else if (sentAt) {
          ackMs.add(Date.now() - sentAt);
          inFlight.set(result.data.body, sentAt);
        }
        return;
      }
      if (raw.startsWith('42')) {
        const [event, payload] = JSON.parse(raw.slice(2));
        if (event === 'message:new' && payload.senderId !== me) {
          // The sender's clock started it; both VUs run on the same k6 host.
          const sentAt = Number(String(payload.body).split('-').pop());
          if (sentAt) deliveryMs.add(Date.now() - sentAt);
        }
      }
    });

    socket.on('error', () => errors.add(1));
    socket.setTimeout(() => socket.close(), SESSION_MS);
  });

  check(res, { 'upgraded to websocket': (r) => r && r.status === 101 });
}
