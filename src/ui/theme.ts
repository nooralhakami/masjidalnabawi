import { load, save } from '../state/persist';

/** Light or dark, remembered between pages (the live app's ui/theme.ts, key «theme»). */
export type Theme = 'light' | 'dark';

export function savedTheme(): Theme | null {
  const v = load('theme');
  return v === 'light' || v === 'dark' ? v : null;
}

/** Apply a theme to <html> (without a value the page follows the device setting) and remember it. */
export function applyTheme(theme: Theme | null, remember = true): void {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  if (remember && theme) save('theme', theme);
}

export const currentTheme = (): Theme => (document.documentElement.dataset.theme as Theme | undefined) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

/** Sun mode (high contrast), remembered as «contrast»; the device's own setting applies without it. */
export function applyContrast(on: boolean, remember = true): void {
  if (on) document.documentElement.dataset.contrast = 'more';
  else delete document.documentElement.dataset.contrast;
  if (remember) save('contrast', on ? 'more' : null);
}
export const savedContrast = (): boolean => load('contrast') === 'more';
