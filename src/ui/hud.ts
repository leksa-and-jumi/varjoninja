// On-screen info while playing: health, hero points, police stars, the mini map, messages.

import { CITY, CITY_HALF, COMBAT, PLAYER } from '../config';
import type { City } from '../logic/city';
import { CRIME_INFO, heroRank, type Crime } from '../logic/crimes';
import { clockText } from '../logic/daytime';
import { t, type TextKey } from '../i18n';

export interface HudState {
  hp: number;
  heroPoints: number;
  /** Points ever earned: the rank. */
  earned: number;
  wanted: number;
  tod: number;
  x: number;
  z: number;
  yaw: number;
  camYaw: number;
  crimes: Crime[];
  people: { x: number; z: number; kind: string; hostile: boolean }[];
  friends: { x: number; z: number; color: string }[];
  shurikenCooldown: number;
  smokeCooldown: number;
  hurt: number;
  speed: number;
  nearCar: boolean;
  driving: boolean;
  roomCode: string | null;
  players: number;
  collected: number;
  totalCollectibles: number;
  aimTarget: boolean;
}

const MAP_SIZE = 180;
const MAP_RANGE = 170; // metres shown from centre to edge
const WORLD = (CITY_HALF + CITY.roadWidth / 2 + CITY.shoreWidth) * 2;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent?: HTMLElement,
  html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

export class Hud {
  readonly root: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private points: HTMLDivElement;
  private rank: HTMLDivElement;
  private stars: HTMLDivElement;
  private clock: HTMLDivElement;
  private map: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private cityMap: HTMLCanvasElement;
  private toasts: HTMLDivElement;
  private popups: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private prompt: HTMLDivElement;
  private abilities: HTMLDivElement;
  private flash: HTMLDivElement;
  private speedLines: HTMLDivElement;
  private room: HTMLDivElement;
  private help: HTMLDivElement;
  private bigMap: HTMLCanvasElement;
  private lastStars = -1;
  private lastPoints = -1;
  bigMapOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly city: City,
  ) {
    this.root = el('div', 'hud hidden', parent);
    this.speedLines = el('div', 'speed-lines', this.root);
    this.flash = el('div', 'hurt-flash', this.root);

    const tl = el('div', 'hud-tl', this.root);
    const hp = el('div', 'hp', tl);
    el('span', 'hp-icon', hp, '❤️');
    const bar = el('div', 'hp-bar', hp);
    this.hpFill = el('div', 'hp-fill', bar);
    this.points = el('div', 'points', tl);
    this.rank = el('div', 'rank', tl);

    const tr = el('div', 'hud-tr', this.root);
    this.stars = el('div', 'stars', tr);
    this.clock = el('div', 'clock', tr);
    this.room = el('div', 'room-code', tr);

    this.toasts = el('div', 'toasts', this.root);
    this.popups = el('div', 'popups', this.root);
    this.crosshair = el('div', 'crosshair', this.root);
    this.prompt = el('div', 'prompt', this.root);

    const bl = el('div', 'hud-bl', this.root);
    this.map = el('canvas', 'minimap', bl);
    this.map.width = MAP_SIZE * 2;
    this.map.height = MAP_SIZE * 2;
    this.mapCtx = this.map.getContext('2d')!;
    this.cityMap = this.drawCityMap();

    this.abilities = el('div', 'abilities', this.root);
    this.help = el('div', 'help', this.root);
    this.refreshTexts();
    this.bigMap = el('canvas', 'bigmap hidden', this.root);
    this.bigMap.width = 900;
    this.bigMap.height = 900;
  }

  /** Re-draw the texts that don't change every frame (after a language change). */
  refreshTexts(): void {
    const lines: TextKey[] = [
      'helpMove',
      'helpJump',
      'helpRope',
      'helpZip',
      'helpAttack',
      'helpTools',
      'helpCar',
      'helpMisc',
    ];
    this.help.innerHTML =
      `<b>${t('helpTitle')}</b>` + lines.map((k) => `<div>${t(k)}</div>`).join('');
    this.lastPoints = -1;
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  setHelp(on: boolean): void {
    this.help.classList.toggle('hidden', !on);
  }

  toggleBigMap(): void {
    this.bigMapOpen = !this.bigMapOpen;
    this.bigMap.classList.toggle('hidden', !this.bigMapOpen);
  }

  private drawCityMap(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    const size = 1024;
    c.width = size;
    c.height = size;
    const g = c.getContext('2d')!;
    const s = size / WORLD;
    const tx = (x: number) => (x + WORLD / 2) * s;
    g.fillStyle = '#1d5d7a';
    g.fillRect(0, 0, size, size);
    const edge = CITY_HALF + CITY.roadWidth / 2 + CITY.shoreWidth;
    g.fillStyle = '#9b927f';
    g.fillRect(tx(-edge), tx(-edge), edge * 2 * s, edge * 2 * s);
    const road = CITY_HALF + CITY.roadWidth / 2;
    g.fillStyle = '#3a3d42';
    g.fillRect(tx(-road), tx(-road), road * 2 * s, road * 2 * s);
    for (const b of this.city.blocks) {
      g.fillStyle = b.kind === 'park' ? '#4f8a3a' : b.kind === 'plaza' ? '#c9b98f' : '#77736b';
      g.fillRect(tx(b.minX), tx(b.minZ), (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
    }
    for (const bd of this.city.buildings) {
      const t = Math.min(1, bd.height / 200);
      const l = Math.round(70 + t * 90);
      g.fillStyle = `rgb(${l},${l + 6},${l + 18})`;
      for (const bx of bd.boxes)
        g.fillRect(tx(bx.minX), tx(bx.minZ), (bx.maxX - bx.minX) * s, (bx.maxZ - bx.minZ) * s);
    }
    return c;
  }

  notify(title: string, text: string, icon: string): void {
    const t = el(
      'div',
      'toast',
      this.toasts,
      `<span class="toast-icon">${icon}</span><div><b>${title}</b><span>${text}</span></div>`,
    );
    setTimeout(() => t.classList.add('out'), 4500);
    setTimeout(() => t.remove(), 5200);
    while (this.toasts.children.length > 3) this.toasts.firstChild?.remove();
  }

  reward(points: number, text: string): void {
    const p = el('div', 'popup', this.popups, `<b>+${points}</b><span>${text}</span>`);
    setTimeout(() => p.remove(), 2600);
  }

  /** Finishing move name, comic style, with a white flash. */
  finisher(text: string): void {
    const m = el('div', 'finisher-text', this.root, text);
    setTimeout(() => m.remove(), 1500);
    this.flash.classList.remove('white');
    void this.flash.offsetWidth;
    this.flash.classList.add('white');
  }

  bigMessage(text: string, sub = ''): void {
    const m = el('div', 'big-message', this.root, `<b>${text}</b><span>${sub}</span>`);
    setTimeout(() => m.remove(), 2600);
  }

  update(s: HudState): void {
    this.hpFill.style.width = `${(s.hp / PLAYER.maxHealth) * 100}%`;
    this.hpFill.classList.toggle('low', s.hp < 30);
    if (s.heroPoints + s.earned * 1e6 !== this.lastPoints) {
      this.lastPoints = s.heroPoints + s.earned * 1e6;
      const r = heroRank(s.earned);
      this.points.innerHTML = `⭐ <b>${s.heroPoints}</b> <small>${t('heroPoints')}</small>`;
      const title = t(`rank${r.rank}` as TextKey);
      this.rank.textContent = r.next ? `${title} · ${t('nextRank', { n: r.next })}` : title;
    }
    if (s.wanted !== this.lastStars) {
      this.lastStars = s.wanted;
      this.stars.innerHTML =
        s.wanted > 0
          ? '🚨 ' +
            '★'.repeat(s.wanted) +
            '<span class="dim">' +
            '★'.repeat(5 - s.wanted) +
            '</span>'
          : '';
      this.stars.classList.toggle('active', s.wanted > 0);
    }
    this.clock.textContent = `🕒 ${clockText(s.tod)} · 🥷 ${s.collected}/${s.totalCollectibles}`;
    this.room.textContent = s.roomCode
      ? `👥 ${s.roomCode} · ${t('players', { n: s.players })}`
      : '';
    this.flash.style.opacity = String(Math.min(0.6, s.hurt * 0.6));
    this.speedLines.style.opacity = String(Math.max(0, Math.min(0.8, (s.speed - 22) / 30)));
    this.crosshair.classList.toggle('target', s.aimTarget);
    this.crosshair.classList.toggle('hidden', s.driving);
    this.prompt.textContent = s.driving ? t('exitCarPrompt') : s.nearCar ? t('enterCarPrompt') : '';
    this.prompt.classList.toggle('hidden', !this.prompt.textContent);
    const sh = s.shurikenCooldown > 0 ? 'cool' : '';
    const sm = s.smokeCooldown > 0 ? 'cool' : '';
    this.abilities.innerHTML = s.driving
      ? ''
      : `<div class="ability ${sh}"><span>✴️</span><kbd>R</kbd></div><div class="ability ${sm}"><span>💨</span><kbd>G</kbd>${
          s.smokeCooldown > 0 ? `<i>${Math.ceil(s.smokeCooldown)}</i>` : ''
        }</div>`;
    this.drawMinimap(s);
    if (this.bigMapOpen) this.drawBigMap(s);
  }

  private drawMinimap(s: HudState): void {
    const g = this.mapCtx;
    const size = this.map.width;
    const scale = size / 2 / MAP_RANGE;
    g.save();
    g.clearRect(0, 0, size, size);
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    g.clip();
    g.translate(size / 2, size / 2);
    // The map turns with the camera, so "up" on the map is where the camera looks.
    g.rotate(s.camYaw);
    const src = this.cityMap.width / WORLD;
    g.drawImage(
      this.cityMap,
      -(s.x + WORLD / 2) * scale,
      -(s.z + WORLD / 2) * scale,
      (this.cityMap.width / src) * scale,
      (this.cityMap.height / src) * scale,
    );
    const dot = (x: number, z: number, r: number, color: string) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc((x - s.x) * scale, (z - s.z) * scale, r, 0, Math.PI * 2);
      g.fill();
    };
    for (const p of s.people)
      dot(p.x, p.z, 5, p.kind === 'cop' ? '#3d7bff' : p.hostile ? '#ff3b3b' : '#ffb03b');
    for (const f of s.friends) dot(f.x, f.z, 8, f.color);
    g.restore();
    // Crimes: icons, clamped to the edge if far away.
    g.save();
    g.translate(size / 2, size / 2);
    g.font = '30px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const c of s.crimes) {
      let dx = (c.x - s.x) * scale;
      let dz = (c.z - s.z) * scale;
      const a = s.camYaw;
      const rx = dx * Math.cos(a) - dz * Math.sin(a);
      const rz = dx * Math.sin(a) + dz * Math.cos(a);
      dx = rx;
      dz = rz;
      const d = Math.hypot(dx, dz);
      const max = size / 2 - 20;
      if (d > max) {
        dx *= max / d;
        dz *= max / d;
      }
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.beginPath();
      g.arc(dx, dz, 19, 0, Math.PI * 2);
      g.fill();
      g.fillText(CRIME_INFO[c.kind].icon, dx, dz + 2);
    }
    // The ninja: an arrow.
    g.rotate(Math.PI + s.camYaw - s.yaw);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#d42a2a';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, -16);
    g.lineTo(11, 12);
    g.lineTo(0, 6);
    g.lineTo(-11, 12);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  private drawBigMap(s: HudState): void {
    const g = this.bigMap.getContext('2d')!;
    const size = this.bigMap.width;
    g.drawImage(this.cityMap, 0, 0, size, size);
    const tx = (v: number) => ((v + WORLD / 2) / WORLD) * size;
    g.font = '36px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const c of s.crimes) {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.beginPath();
      g.arc(tx(c.x), tx(c.z), 24, 0, Math.PI * 2);
      g.fill();
      g.fillText(CRIME_INFO[c.kind].icon, tx(c.x), tx(c.z) + 2);
    }
    for (const f of s.friends) {
      g.fillStyle = f.color;
      g.beginPath();
      g.arc(tx(f.x), tx(f.z), 10, 0, Math.PI * 2);
      g.fill();
    }
    g.save();
    g.translate(tx(s.x), tx(s.z));
    g.rotate(-s.yaw + Math.PI);
    g.fillStyle = '#fff';
    g.strokeStyle = '#d42a2a';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, -20);
    g.lineTo(14, 14);
    g.lineTo(0, 7);
    g.lineTo(-14, 14);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}

export const SMOKE_COOLDOWN = COMBAT.smokeCooldown;
