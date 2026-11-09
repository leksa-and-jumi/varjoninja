// Title screen, outfit colours, joining a friend, pause menu and settings.

import type { NinjaColors } from '../render/characters';
import type { Settings } from '../data/storage';

export const SUIT_COLORS = [
  '#1b1c22',
  '#2d3e78',
  '#1f5f4a',
  '#5b1f2a',
  '#4a2d6b',
  '#e8e8ee',
  '#c9a227',
  '#7a4b2a',
  '#3d4450',
  '#b8326b',
];
export const ACCENT_COLORS = [
  '#d42a2a',
  '#f2c14e',
  '#3ea3ff',
  '#3ecf8e',
  '#ff7a1a',
  '#c56bff',
  '#ffffff',
  '#ff5fa2',
  '#20e3d2',
  '#9be15d',
];

export interface MenuActions {
  play(): void;
  host(): void;
  join(code: string): void;
  colors(c: NinjaColors): void;
  settings(s: Settings): void;
  resume(): void;
  quit(): void;
  click(): void;
  /** The outfit screen opened (true) or closed (false). */
  outfit(open: boolean): void;
}

function html(parent: HTMLElement, cls: string, inner: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = inner;
  parent.appendChild(d);
  return d;
}

export class Menus {
  private title: HTMLDivElement;
  private outfit: HTMLDivElement;
  private pause: HTMLDivElement;
  private settingsPanel: HTMLDivElement;
  private ko: HTMLDivElement;
  private loading: HTMLDivElement;
  private colors: NinjaColors;
  private settings: Settings;

  constructor(
    parent: HTMLElement,
    colors: NinjaColors,
    settings: Settings,
    private readonly actions: MenuActions,
  ) {
    this.colors = { ...colors };
    this.settings = { ...settings };

    this.loading = html(
      parent,
      'screen loading',
      `<div class="logo">VARJONINJA</div><div class="spinner"></div><p>Rakennetaan kaupunkia…</p>`,
    );

    this.title = html(
      parent,
      'screen title hidden',
      `<div class="title-box">
        <div class="logo">VARJONINJA</div>
        <p class="tagline">Varjosaaren kaupunki tarvitsee sankaria. 🥷</p>
        <div class="buttons">
          <button class="big" data-a="play">▶ Pelaa</button>
          <button data-a="host">👥 Pelaa kaverin kanssa</button>
          <form class="join"><input maxlength="14" placeholder="KAVERIN KOODI" autocomplete="off" spellcheck="false" /><button>Liity</button></form>
          <div class="row">
            <button data-a="outfit">🎨 Ninjan asu</button>
            <button data-a="settings">⚙️ Asetukset</button>
          </div>
        </div>
        <p class="credits">Suunnittelu: Julius · Tehty Varjosaaren pelistudiossa</p>
      </div>`,
    );
    this.title.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset['a'];
      if (!a) return;
      actions.click();
      if (a === 'play') actions.play();
      if (a === 'host') actions.host();
      if (a === 'outfit') this.showOutfit();
      if (a === 'settings') this.showSettings('title');
    });
    this.title.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.title.querySelector('input')!;
      const code = input.value.trim().toUpperCase();
      if (code) actions.join(code);
    });

    this.outfit = html(parent, 'screen outfit hidden', '');
    this.renderOutfit();

    this.pause = html(
      parent,
      'screen pause hidden',
      `<div class="panel">
        <h2>Tauko</h2>
        <button class="big" data-a="resume">▶ Jatka</button>
        <button data-a="outfit">🎨 Ninjan asu</button>
        <button data-a="settings">⚙️ Asetukset</button>
        <button data-a="quit">🏠 Päävalikkoon</button>
      </div>`,
    );
    this.pause.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset['a'];
      if (!a) return;
      actions.click();
      if (a === 'resume') actions.resume();
      if (a === 'quit') actions.quit();
      if (a === 'outfit') this.showOutfit('pause');
      if (a === 'settings') this.showSettings('pause');
    });

    this.settingsPanel = html(parent, 'screen settings hidden', '');
    this.ko = html(
      parent,
      'screen ko hidden',
      `<div class="ko-text">Tyrmätty! 💫</div><p>Ninja herää katolta…</p>`,
    );
  }

  private back: 'title' | 'pause' = 'title';

  hideLoading(): void {
    this.loading.classList.add('hidden');
  }

  showTitle(on: boolean): void {
    this.title.classList.toggle('hidden', !on);
  }

  showPause(on: boolean): void {
    this.pause.classList.toggle('hidden', !on);
    if (!on) {
      this.outfit.classList.add('hidden');
      this.settingsPanel.classList.add('hidden');
    }
  }

  showKo(on: boolean): void {
    this.ko.classList.toggle('hidden', !on);
  }

  get anyOpen(): boolean {
    return [this.title, this.outfit, this.pause, this.settingsPanel].some(
      (e) => !e.classList.contains('hidden'),
    );
  }

  private showOutfit(from: 'title' | 'pause' = 'title'): void {
    this.back = from;
    this.title.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.outfit.classList.remove('hidden');
    this.renderOutfit();
    this.actions.outfit(true);
  }

  private closeSub(): void {
    if (!this.outfit.classList.contains('hidden')) this.actions.outfit(false);
    this.outfit.classList.add('hidden');
    this.settingsPanel.classList.add('hidden');
    if (this.back === 'title') this.title.classList.remove('hidden');
    else this.pause.classList.remove('hidden');
  }

  private renderOutfit(): void {
    const row = (label: string, key: keyof NinjaColors, list: string[]) =>
      `<div class="swatch-row"><span>${label}</span><div class="swatches">${list
        .map(
          (c) =>
            `<button class="swatch ${this.colors[key] === c ? 'on' : ''}" data-k="${key}" data-c="${c}" style="background:${c}"></button>`,
        )
        .join('')}</div></div>`;
    this.outfit.innerHTML = `<div class="panel side">
      <h2>🎨 Ninjan asu</h2>
      ${row('Asu', 'suit', SUIT_COLORS)}
      ${row('Huivi ja vyö', 'accent', ACCENT_COLORS)}
      ${row('Naamio', 'mask', SUIT_COLORS)}
      <button class="big" data-a="done">✔ Valmis</button>
    </div>`;
    this.outfit.onclick = (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.actions.click();
      if (b.dataset['a'] === 'done') {
        this.closeSub();
        return;
      }
      const k = b.dataset['k'] as keyof NinjaColors | undefined;
      if (k) {
        this.colors[k] = b.dataset['c']!;
        this.actions.colors({ ...this.colors });
        this.renderOutfit();
      }
    };
  }

  private showSettings(from: 'title' | 'pause'): void {
    this.back = from;
    this.title.classList.add('hidden');
    this.pause.classList.add('hidden');
    const s = this.settings;
    const q = (v: Settings['quality'], label: string) =>
      `<button class="${s.quality === v ? 'on' : ''}" data-q="${v}">${label}</button>`;
    this.settingsPanel.innerHTML = `<div class="panel">
      <h2>⚙️ Asetukset</h2>
      <div class="setting"><span>Grafiikka</span><div class="seg">${q('low', 'Kevyt')}${q('medium', 'Keski')}${q('high', 'Hieno')}</div></div>
      <div class="setting"><span>Äänet</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-s="volume" /></div>
      <div class="setting"><span>Hiiren herkkyys</span><input type="range" min="0.3" max="2.5" step="0.05" value="${s.sensitivity}" data-s="sensitivity" /></div>
      <div class="setting"><span>Ohjeet näkyvissä</span><div class="seg"><button class="${s.showHelp ? 'on' : ''}" data-h="1">Kyllä</button><button class="${!s.showHelp ? 'on' : ''}" data-h="0">Ei</button></div></div>
      <p class="note">Grafiikan muutos tulee voimaan, kun sivu ladataan uudelleen.</p>
      <button class="big" data-a="done">✔ Valmis</button>
    </div>`;
    this.settingsPanel.classList.remove('hidden');
    this.settingsPanel.onclick = (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.actions.click();
      if (b.dataset['a'] === 'done') {
        this.closeSub();
        return;
      }
      if (b.dataset['q']) s.quality = b.dataset['q'] as Settings['quality'];
      if (b.dataset['h']) s.showHelp = b.dataset['h'] === '1';
      this.actions.settings({ ...s });
      this.showSettings(from);
    };
    this.settingsPanel.oninput = (e) => {
      const i = e.target as HTMLInputElement;
      const key = i.dataset['s'] as 'volume' | 'sensitivity' | undefined;
      if (!key) return;
      s[key] = Number(i.value);
      this.actions.settings({ ...s });
    };
  }

  setJoinError(text: string): void {
    const input = this.title.querySelector('input')!;
    input.value = '';
    input.placeholder = text;
  }
}
