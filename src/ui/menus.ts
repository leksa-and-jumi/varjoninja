// Title screen, outfit colours, joining a friend, pause menu and settings.

import type { NinjaColors } from '../render/characters';
import type { Settings } from '../data/storage';
import { getLang, LANGS, t, type Lang } from '../i18n';
import { OUTFITS, type OutfitId } from '../logic/outfits';

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
  language(l: Lang): void;
  /** Open the invite panel (starts a room first if playing alone). */
  invite(): void;
  /** Outfit shop: current points, owned outfits and the one being worn. */
  shopState(): { points: number; owned: string[]; outfit: string | null };
  /** Buy an outfit (returns false if not possible). */
  buy(id: OutfitId): boolean;
  /** Wear an outfit (null = own colours). */
  wear(id: OutfitId | null): void;
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

    this.loading = html(parent, 'screen loading', '');
    this.title = html(parent, 'screen title hidden', '');
    this.title.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      const a = b?.dataset['a'];
      if (!b || b.closest('form')) return;
      actions.click();
      if (a === 'play') actions.play();
      if (a === 'joinInvite' && this.invitedCode) actions.join(this.invitedCode);
      if (a === 'host') actions.host();
      if (a === 'outfit') this.showOutfit();
      if (a === 'shop') this.showShop('title');
      if (a === 'settings') this.showSettings('title');
      if (b.dataset['lang']) this.setLanguage(b.dataset['lang'] as Lang);
    });
    // Delegated, so it keeps working after the title is re-rendered in another language.
    this.title.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.title.querySelector('input')!;
      const code = input.value.trim().toUpperCase();
      if (code) actions.join(code);
    });

    this.outfit = html(parent, 'screen outfit hidden', '');
    this.pause = html(parent, 'screen pause hidden', '');
    this.pause.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset['a'];
      if (!a) return;
      actions.click();
      if (a === 'resume') actions.resume();
      if (a === 'quit') actions.quit();
      if (a === 'invite') actions.invite();
      if (a === 'outfit') this.showOutfit('pause');
      if (a === 'shop') this.showShop('pause');
      if (a === 'settings') this.showSettings('pause');
    });
    this.settingsPanel = html(parent, 'screen settings hidden', '');
    this.invitePanel = html(parent, 'screen invite hidden', '');
    this.shopPanel = html(parent, 'screen outfit shop hidden', '');
    this.ko = html(parent, 'screen ko hidden', '');
    this.renderTexts();
  }

  /** Fill every menu with texts in the current language. */
  renderTexts(): void {
    this.loading.innerHTML = `<div class="logo">VARJONINJA</div><div class="spinner"></div><p>${t('loading')}</p>`;
    const typed = this.title.querySelector('input')?.value ?? '';
    const lang = getLang();
    this.title.innerHTML = `<div class="title-box">
        <div class="logo">VARJONINJA</div>
        <p class="tagline">${t('tagline')}</p>
        <div class="buttons">
          ${
            this.invitedCode
              ? `<div class="invited"><b>${t('invited')}</b><span>${this.invitedCode}</span><button class="big" data-a="joinInvite">${t('joinInvite')}</button></div>`
              : ''
          }
          <button class="${this.invitedCode ? '' : 'big'}" data-a="play">${t('play')}</button>
          <button data-a="host">${t('host')}</button>
          <form class="join"><input maxlength="32" placeholder="${t('joinPlaceholder')}" autocomplete="off" spellcheck="false" /><button type="submit">${t('join')}</button></form>
          <div class="row">
            <button data-a="outfit">${t('outfitButton')}</button>
            <button data-a="shop">${t('shop')}</button>
          </div>
          <button data-a="settings">${t('settingsButton')}</button>
          <div class="langs" aria-label="${t('language')}">${LANGS.map(
            (l) =>
              `<button class="lang ${l.id === lang ? 'on' : ''}" data-lang="${l.id}">${l.flag} ${l.label}</button>`,
          ).join('')}</div>
        </div>
        <p class="credits">${t('credits')}</p>
      </div>`;
    this.title.querySelector('input')!.value = typed;
    this.pause.innerHTML = `<div class="panel">
        <h2>${t('pauseTitle')}</h2>
        <button class="big" data-a="resume">${t('resume')}</button>
        <button data-a="invite">${t('invite')}</button>
        <button data-a="outfit">${t('outfitButton')}</button>
        <button data-a="shop">${t('shop')}</button>
        <button data-a="settings">${t('settingsButton')}</button>
        <button data-a="quit">${t('quit')}</button>
      </div>`;
    this.ko.innerHTML = `<div class="ko-text">${t('koTitle')}</div><p>${t('koText')}</p>`;
    this.renderOutfit();
    if (!this.settingsPanel.classList.contains('hidden')) this.showSettings(this.back);
  }

  private setLanguage(l: Lang): void {
    this.settings.language = l;
    this.actions.language(l);
    this.renderTexts();
  }

  private back: 'title' | 'pause' = 'title';
  private invitePanel: HTMLDivElement;
  private shopPanel: HTMLDivElement;

  /** The outfit shop: four special suits for hero points, plus your own colours. */
  private showShop(from: 'title' | 'pause'): void {
    this.back = from;
    this.title.classList.add('hidden');
    this.pause.classList.add('hidden');
    if (this.shopPanel.classList.contains('hidden')) this.actions.outfit(true);
    const st = this.actions.shopState();
    const card = (o: (typeof OUTFITS)[number]) => {
      const owned = st.owned.includes(o.id);
      const worn = st.outfit === o.id;
      const button = worn
        ? `<button class="on" disabled>${t('wearing')}</button>`
        : owned
          ? `<button data-wear="${o.id}">${t('wear')}</button>`
          : st.points >= o.price
            ? `<button class="big" data-buy="${o.id}">${t('buy', { price: `⭐ ${o.price}` })}</button>`
            : `<button disabled>${t('needMore', { n: o.price - st.points })}</button>`;
      const swatch = `background: linear-gradient(135deg, ${o.suit} 0%, ${o.suit} 45%, ${o.patternColor} 50%, ${o.suit} 55%, ${o.accent} 100%)`;
      return `<div class="shop-item ${o.id}"><div class="shop-swatch" style="${swatch}"></div><div class="shop-info"><b>${t(o.nameKey)}</b><span>⭐ ${o.price}</span></div>${button}</div>`;
    };
    const ownWorn = st.outfit === null;
    this.shopPanel.innerHTML = `<div class="panel side">
      <h2>${t('shop')}</h2>
      <p class="shop-points">${t('shopPoints', { n: st.points })}</p>
      <div class="shop-item"><div class="shop-swatch own"></div><div class="shop-info"><b>${t('ownColors')}</b></div>${
        ownWorn
          ? `<button class="on" disabled>${t('wearing')}</button>`
          : `<button data-wear="">${t('wear')}</button>`
      }</div>
      ${OUTFITS.map(card).join('')}
      <button class="big" data-a="done">${t('done')}</button>
    </div>`;
    this.shopPanel.classList.remove('hidden');
    this.shopPanel.onclick = (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || b.disabled) return;
      this.actions.click();
      if (b.dataset['a'] === 'done') {
        this.shopPanel.classList.add('hidden');
        this.actions.outfit(false);
        if (this.back === 'title') this.title.classList.remove('hidden');
        else this.pause.classList.remove('hidden');
        return;
      }
      if (b.dataset['buy']) {
        const id = b.dataset['buy'] as OutfitId;
        if (this.actions.buy(id)) this.actions.wear(id);
      } else if (b.dataset['wear'] !== undefined) {
        this.actions.wear((b.dataset['wear'] || null) as OutfitId | null);
      }
      this.showShop(from);
    };
  }
  /** Room code from an invite link (?huone=…). */
  private invitedCode: string | null = null;

  setInvited(code: string): void {
    this.invitedCode = code;
    this.renderTexts();
  }

  /** Show the room code and a link that joins it. */
  showInvite(code: string, link: string): void {
    this.pause.classList.add('hidden');
    this.invitePanel.innerHTML = `<div class="panel">
      <h2>${t('invite')}</h2>
      <p>${t('inviteText')}</p>
      <input class="invite-link" readonly value="${link}" />
      <button class="big" data-a="copy">${t('copyLink')}</button>
      <p>${t('inviteCode')}</p>
      <div class="invite-code">${code}</div>
      <button data-a="done">${t('done')}</button>
    </div>`;
    this.invitePanel.classList.remove('hidden');
    this.invitePanel.onclick = (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.actions.click();
      if (b.dataset['a'] === 'copy') {
        const input = this.invitePanel.querySelector('input')!;
        input.select();
        void navigator.clipboard?.writeText(link).catch(() => document.execCommand('copy'));
        b.textContent = t('copied');
      }
      if (b.dataset['a'] === 'done') {
        this.invitePanel.classList.add('hidden');
        this.shopPanel.classList.add('hidden');
        this.pause.classList.remove('hidden');
      }
    };
  }

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
      this.invitePanel.classList.add('hidden');
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
      <h2>${t('outfitTitle')}</h2>
      ${row(t('outfitSuit'), 'suit', SUIT_COLORS)}
      ${row(t('outfitAccent'), 'accent', ACCENT_COLORS)}
      ${row(t('outfitMask'), 'mask', SUIT_COLORS)}
      <button class="big" data-a="done">${t('done')}</button>
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
    const langs = LANGS.map(
      (l) =>
        `<button class="${s.language === l.id ? 'on' : ''}" data-lang="${l.id}">${l.flag} ${l.label}</button>`,
    ).join('');
    this.settingsPanel.innerHTML = `<div class="panel">
      <h2>${t('settingsTitle')}</h2>
      <div class="setting"><span>${t('language')}</span><div class="seg">${langs}</div></div>
      <div class="setting"><span>${t('graphics')}</span><div class="seg">${q('low', t('qualityLow'))}${q('medium', t('qualityMedium'))}${q('high', t('qualityHigh'))}</div></div>
      <div class="setting"><span>${t('sound')}</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-s="volume" /></div>
      <div class="setting"><span>${t('sensitivity')}</span><input type="range" min="0.3" max="2.5" step="0.05" value="${s.sensitivity}" data-s="sensitivity" /></div>
      <div class="setting"><span>${t('showHelp')}</span><div class="seg"><button class="${s.showHelp ? 'on' : ''}" data-h="1">${t('yes')}</button><button class="${!s.showHelp ? 'on' : ''}" data-h="0">${t('no')}</button></div></div>
      <p class="note">${t('graphicsNote')}</p>
      <button class="big" data-a="done">${t('done')}</button>
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
      if (b.dataset['lang']) {
        this.setLanguage(b.dataset['lang'] as Lang);
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
