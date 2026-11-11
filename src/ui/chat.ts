// Chat with friends in the same room (allowed by the parent on 2026-11-10). Messages go only to
// the room, are never stored, and are rate limited by the room server. Text is shown with
// textContent, never as HTML.

import { CHAT_MAX_LENGTH } from '../logic/protocol';
import { t } from '../i18n';

const SHOW_SECONDS = 14;
const MAX_LINES = 6;

export class Chat {
  private log: HTMLDivElement;
  private form: HTMLFormElement;
  private input: HTMLInputElement;
  private hint: HTMLDivElement;
  isOpen = false;
  /** Called with the text when the player sends a message. */
  onSend: (text: string) => void = () => {};
  onClose: () => void = () => {};

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'chat';
    parent.appendChild(root);
    this.log = document.createElement('div');
    this.log.className = 'chat-log';
    this.form = document.createElement('form');
    this.form.className = 'chat-form hidden';
    this.input = document.createElement('input');
    this.input.maxLength = CHAT_MAX_LENGTH;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.form.appendChild(this.input);
    this.hint = document.createElement('div');
    this.hint.className = 'chat-hint hidden';
    root.append(this.log, this.form, this.hint);

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (text) this.onSend(text);
      this.close();
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
  }

  /** Show the "T – chat" hint only when there is someone to talk to. */
  setAvailable(on: boolean): void {
    this.hint.textContent = t('chatHint');
    this.hint.classList.toggle('hidden', !on || this.isOpen);
  }

  open(): void {
    this.isOpen = true;
    this.input.value = '';
    this.input.placeholder = t('chatPlaceholder');
    this.form.classList.remove('hidden');
    this.hint.classList.add('hidden');
    // Wait a moment so the key that opened the chat doesn't end up in the box.
    setTimeout(() => this.input.focus(), 0);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.input.blur();
    this.form.classList.add('hidden');
    this.onClose();
  }

  /** A message: a coloured dot for who sent it, then the text. */
  add(text: string, color: string, mine: boolean): void {
    const line = document.createElement('div');
    line.className = mine ? 'chat-line mine' : 'chat-line';
    const dot = document.createElement('span');
    dot.className = 'chat-dot';
    dot.style.background = color;
    const span = document.createElement('span');
    span.textContent = text;
    line.append(dot, span);
    this.log.appendChild(line);
    while (this.log.children.length > MAX_LINES) this.log.firstChild?.remove();
    setTimeout(() => line.classList.add('old'), SHOW_SECONDS * 1000);
  }
}
