// Touch controls for tablets and phones: a stick on the left, look by dragging on the right,
// and big buttons for the ninja moves.

import type { Action, Input } from './input';

const BUTTONS: { a: Action; label: string; cls: string }[] = [
  { a: 'jump', label: '⤒', cls: 'b-jump' },
  { a: 'rope', label: '🪢', cls: 'b-rope' },
  { a: 'attack', label: '👊', cls: 'b-attack' },
  { a: 'zip', label: '➶', cls: 'b-zip' },
  { a: 'shuriken', label: '✴️', cls: 'b-shuriken' },
  { a: 'smoke', label: '💨', cls: 'b-smoke' },
  { a: 'car', label: '🚗', cls: 'b-car' },
  { a: 'sprint', label: '⚡', cls: 'b-sprint' },
  { a: 'pause', label: '⏸', cls: 'b-pause' },
];

export class TouchControls {
  readonly root: HTMLDivElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private knob: HTMLDivElement;
  private base: HTMLDivElement;
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };

  constructor(parent: HTMLElement, input: Input) {
    this.root = document.createElement('div');
    this.root.className = 'touch hidden';
    parent.appendChild(this.root);
    const zone = document.createElement('div');
    zone.className = 'touch-zone';
    this.root.appendChild(zone);
    this.base = document.createElement('div');
    this.base.className = 'stick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';
    this.base.appendChild(this.knob);
    this.root.appendChild(this.base);

    for (const b of BUTTONS) {
      const el = document.createElement('button');
      el.className = `tbtn ${b.cls}`;
      el.textContent = b.label;
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (b.a === 'sprint') {
          if (input.held.has('sprint')) input.release('sprint');
          else input.press('sprint');
          el.classList.toggle('on', input.held.has('sprint'));
          return;
        }
        input.press(b.a);
        el.classList.add('down');
      });
      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (b.a !== 'sprint') input.release(b.a);
        el.classList.remove('down');
      });
      this.root.appendChild(el);
    }

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < window.innerWidth * 0.4 && this.stickId === null) {
          this.stickId = t.identifier;
          this.stickOrigin = { x: t.clientX, y: t.clientY };
          this.base.style.left = `${t.clientX - 60}px`;
          this.base.style.top = `${t.clientY - 60}px`;
          this.base.classList.add('active');
        } else if (this.lookId === null) {
          this.lookId = t.identifier;
          this.lookLast = { x: t.clientX, y: t.clientY };
        }
      }
    });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickId) {
          const dx = t.clientX - this.stickOrigin.x;
          const dy = t.clientY - this.stickOrigin.y;
          const len = Math.min(55, Math.hypot(dx, dy));
          const a = Math.atan2(dy, dx);
          this.knob.style.transform = `translate(${Math.cos(a) * len}px, ${Math.sin(a) * len}px)`;
          input.stickX = (Math.cos(a) * len) / 55;
          input.stickY = (-Math.sin(a) * len) / 55;
        } else if (t.identifier === this.lookId) {
          input.lookX += t.clientX - this.lookLast.x;
          input.lookY += t.clientY - this.lookLast.y;
          this.lookLast = { x: t.clientX, y: t.clientY };
        }
      }
    });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickId) {
          this.stickId = null;
          input.stickX = 0;
          input.stickY = 0;
          this.knob.style.transform = '';
          this.base.classList.remove('active');
        } else if (t.identifier === this.lookId) {
          this.lookId = null;
        }
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }
}

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window && matchMedia('(pointer: coarse)').matches;
}
