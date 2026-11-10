// Room server for playing with a friend. Every room code has its own Durable Object, which only
// passes messages between the players in the room. Nothing is stored (no SQLite, no storage
// writes), and the room sleeps (hibernates) when nobody sends anything, so it fits the free plan.
//
// Players are only ninja colours: no names, no chat. Only the game's own pages may connect.

import { DurableObject } from 'cloudflare:workers';
import {
  encodeServer,
  isValidRoomCode,
  LIMITS,
  parseClient,
  type NetColors,
  type ServerMessage,
} from '../src/logic/protocol';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  /** Comma-separated list of web pages allowed to connect. */
  ALLOWED_ORIGINS: string;
}

const ROOM_PATH = /^\/room\/([^/]+)\/ws$/;

function isAllowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  return env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .includes(origin);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    const match = ROOM_PATH.exec(url.pathname);
    if (!match) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('Expected WebSocket', { status: 426 });
    if (!isAllowedOrigin(request.headers.get('Origin'), env))
      return new Response('Forbidden', { status: 403 });
    const code = decodeURIComponent(match[1]!);
    if (!isValidRoomCode(code)) return new Response('Bad room code', { status: 400 });
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** Remembered per connection; survives hibernation. */
interface Attachment {
  id: number;
  colors: NetColors | null;
  /** Token bucket for the rate limit. */
  tokens: number;
  last: number;
  /** Separate, slower bucket for chat messages. */
  chatTokens?: number;
  chatLast?: number;
}

export class Room extends DurableObject<Env> {
  /** Crimes solved in this room (kept only in memory: losing it after a nap is harmless). */
  private solved: number[] = [];

  async fetch(): Promise<Response> {
    const sockets = this.ctx.getWebSockets();
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    if (sockets.length >= LIMITS.maxPlayers) {
      server.send(encodeServer({ t: 'full' }));
      server.close(4000, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    const used = new Set(sockets.map((ws) => this.att(ws)?.id));
    let id = 1;
    while (used.has(id)) id++;
    const att: Attachment = { id, colors: null, tokens: LIMITS.burst, last: Date.now() };
    server.serializeAttachment(att);
    return new Response(null, { status: 101, webSocket: client });
  }

  private att(ws: WebSocket): Attachment | null {
    return (ws.deserializeAttachment() as Attachment | null) ?? null;
  }

  private broadcast(m: ServerMessage, except?: WebSocket): void {
    const data = encodeServer(m);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        // Closing socket: ignore.
      }
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    const att = this.att(ws);
    if (!att) return;
    // Rate limit: refill tokens over time.
    const now = Date.now();
    att.tokens = Math.min(LIMITS.burst, att.tokens + ((now - att.last) / 1000) * LIMITS.rate);
    att.last = now;
    if (att.tokens < 1) return;
    att.tokens -= 1;

    const m = parseClient(raw);
    if (!m) return;
    switch (m.t) {
      case 'hello': {
        const first = att.colors === null;
        att.colors = m.colors;
        if (first) {
          const players: [number, NetColors][] = [];
          for (const other of this.ctx.getWebSockets()) {
            const o = this.att(other);
            if (other !== ws && o?.colors) players.push([o.id, o.colors]);
          }
          ws.send(
            encodeServer({
              t: 'welcome',
              id: att.id,
              time: now,
              players,
              solved: this.solved.slice(-20),
            }),
          );
        }
        this.broadcast({ t: 'join', id: att.id, colors: m.colors }, ws);
        break;
      }
      case 'state':
        if (att.colors) this.broadcast({ t: 'state', id: att.id, s: m.s }, ws);
        break;
      case 'solved':
        if (!this.solved.includes(m.crime)) {
          this.solved.push(m.crime);
          if (this.solved.length > 50) this.solved.shift();
          this.broadcast({ t: 'solved', crime: m.crime, by: att.id }, ws);
        }
        break;
      case 'smoke':
        this.broadcast({ t: 'smoke', id: att.id, x: m.x, y: m.y, z: m.z }, ws);
        break;
      case 'chat': {
        // Chat is only passed on to the others in this room, never stored. Max ~1 per 2 s.
        const since = (now - (att.chatLast ?? 0)) / 1000;
        const tokens = Math.min(
          LIMITS.chatBurst,
          (att.chatTokens ?? LIMITS.chatBurst) + since * LIMITS.chatRate,
        );
        att.chatLast = now;
        if (tokens >= 1 && att.colors) {
          att.chatTokens = tokens - 1;
          this.broadcast({ t: 'chat', id: att.id, text: m.text }, ws);
        } else {
          att.chatTokens = tokens;
        }
        break;
      }
    }
    ws.serializeAttachment(att);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const att = this.att(ws);
    if (att) this.broadcast({ t: 'leave', id: att.id }, ws);
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011);
  }
}
