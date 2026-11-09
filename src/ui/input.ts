// Keyboard, mouse and touch. The game reads `held`, `pressed` (this frame only) and the look delta.

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'rope'
  | 'zip'
  | 'attack'
  | 'shuriken'
  | 'smoke'
  | 'car'
  | 'map'
  | 'pause';

const KEYS: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyE: 'rope',
  KeyQ: 'zip',
  KeyF: 'car',
  KeyR: 'shuriken',
  KeyG: 'smoke',
  KeyM: 'map',
  Escape: 'pause',
  KeyP: 'pause',
};

export class Input {
  readonly held = new Set<Action>();
  private pressedNow = new Set<Action>();
  lookX = 0;
  lookY = 0;
  /** Analog movement from the touch stick (-1..1). */
  stickX = 0;
  stickY = 0;
  touchMode = false;
  enabled = true;
  /** Pointer lock not available (e.g. inside an iframe): drag the mouse to look instead. */
  private dragLook = false;
  private dragging = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      const a = KEYS[e.code];
      if (!a || !this.enabled) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.held.has(a)) this.pressedNow.add(a);
      this.held.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYS[e.code];
      if (a) this.held.delete(a);
    });
    window.addEventListener('blur', () => this.held.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas && !this.dragLook) {
        const req = canvas.requestPointerLock?.() as Promise<void> | undefined;
        req?.catch(() => (this.dragLook = true));
        return;
      }
      if (this.dragLook) this.dragging = true;
      const a: Action | null =
        e.button === 0 ? 'attack' : e.button === 2 ? 'rope' : e.button === 1 ? 'zip' : null;
      if (a) {
        this.pressedNow.add(a);
        this.held.add(a);
      }
    });
    window.addEventListener('mouseup', (e) => {
      this.dragging = false;
      const a: Action | null =
        e.button === 0 ? 'attack' : e.button === 2 ? 'rope' : e.button === 1 ? 'zip' : null;
      if (a) this.held.delete(a);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas && !this.dragging) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas || this.dragLook;
  }

  pressed(a: Action): boolean {
    return this.pressedNow.has(a);
  }

  /** Simulate a button (touch controls, tests). */
  press(a: Action): void {
    if (!this.held.has(a)) this.pressedNow.add(a);
    this.held.add(a);
  }

  release(a: Action): void {
    this.held.delete(a);
  }

  /** Movement axes: x = right, y = forward. */
  move(): { x: number; y: number } {
    let x = this.stickX;
    let y = this.stickY;
    if (this.held.has('forward')) y += 1;
    if (this.held.has('back')) y -= 1;
    if (this.held.has('right')) x += 1;
    if (this.held.has('left')) x -= 1;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  /** Call at the end of each frame. */
  endFrame(): void {
    this.pressedNow.clear();
    this.lookX = 0;
    this.lookY = 0;
  }

  reset(): void {
    this.held.clear();
    this.pressedNow.clear();
    this.stickX = 0;
    this.stickY = 0;
  }
}
