import { el } from './dom';

let current: HTMLElement | null = null;
let timer = 0;

/** Brief status message, announced to screen readers. */
export function toast(text: string, ms = 4000): void {
  current?.remove();
  clearTimeout(timer);
  current = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  current.textContent = text;
  document.body.appendChild(current);
  timer = window.setTimeout(() => {
    current?.remove();
    current = null;
  }, ms);
}
