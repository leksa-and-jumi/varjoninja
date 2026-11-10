// Connection to the room server (WebSocket). Sends our ninja a few times a second, and only
// when it moved and someone else is there to see it.

import { NET } from '../config';
import {
  encodeClient,
  parseServer,
  type ClientMessage,
  type NetColors,
  type NetState,
  type ServerMessage,
} from '../logic/protocol';

export const ROOM_URL: string = import.meta.env.VITE_ROOM_URL ?? '';

export interface RoomEvents {
  message(m: ServerMessage): void;
  status(s: 'connecting' | 'open' | 'closed' | 'full'): void;
}

export class RoomClient {
  private ws: WebSocket | null = null;
  private last: NetState | null = null;
  private lastSent = 0;
  private closedByUs = false;
  private retry = 0;
  /** Other players in the room (we skip sending when alone). */
  others = 0;
  myId = 0;

  constructor(
    readonly code: string,
    private colors: NetColors,
    private readonly events: RoomEvents,
  ) {}

  static available(): boolean {
    return ROOM_URL.length > 0;
  }

  connect(): void {
    this.closedByUs = false;
    const url = `${ROOM_URL.replace(/^http/, 'ws')}/room/${encodeURIComponent(this.code)}/ws`;
    this.events.status('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.send({ t: 'hello', colors: this.colors });
      this.events.status('open');
    };
    ws.onmessage = (e) => {
      const m = parseServer(String(e.data));
      if (!m) return;
      if (m.t === 'welcome') {
        this.myId = m.id;
        this.others = m.players.length;
      }
      if (m.t === 'join') this.others++;
      if (m.t === 'leave') this.others = Math.max(0, this.others - 1);
      if (m.t === 'full') {
        this.closedByUs = true;
        this.events.status('full');
      }
      this.events.message(m);
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.closedByUs) return;
      this.events.status('closed');
      // Reconnect with a growing pause.
      this.retry = Math.min(this.retry + 1, 6);
      setTimeout(
        () => {
          if (!this.closedByUs) this.connect();
        },
        1000 * this.retry * this.retry,
      );
    };
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
  }

  private send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeClient(m));
  }

  setColors(c: NetColors): void {
    this.colors = c;
    this.send({ t: 'hello', colors: c });
  }

  solved(crime: number): void {
    this.send({ t: 'solved', crime });
  }

  chat(text: string): void {
    if (this.others > 0) this.send({ t: 'chat', text });
  }

  smoke(x: number, y: number, z: number): void {
    if (this.others > 0) this.send({ t: 'smoke', x, y, z });
  }

  /** Call every frame; decides itself whether to send. */
  tick(s: NetState, nowMs: number): void {
    if (this.others === 0) return;
    const since = nowMs - this.lastSent;
    if (since < 1000 / NET.sendRate) return;
    const l = this.last;
    const moved =
      !l ||
      Math.hypot(s.x - l.x, s.y - l.y, s.z - l.z) > NET.moveDeadZone ||
      Math.abs(s.yaw - l.yaw) > NET.turnDeadZone ||
      s.mode !== l.mode ||
      s.attack !== l.attack ||
      (s.ax === null) !== (l.ax === null) ||
      s.car !== l.car;
    if (!moved && since < NET.heartbeat * 1000) return;
    this.last = { ...s };
    this.lastSent = nowMs;
    this.send({ t: 'state', s });
  }
}
