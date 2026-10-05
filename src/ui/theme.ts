export type Theme = 'light' | 'dark';
const KEY = 'theme';

export function savedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** Apply a theme to <html> (without a value the page follows the device setting) and remember it. */
export function applyTheme(theme: Theme | null, remember = true): void {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  if (!remember || !theme) return;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable */
  }
}

export const currentTheme = (): Theme =>
  (document.documentElement.dataset.theme as Theme | undefined) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
