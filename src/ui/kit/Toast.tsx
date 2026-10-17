import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './Icon';

/** A short notice above the sheet; announced politely, never steals focus. */
export function Toast({ tone = 'info', icon = 'info', children }: { tone?: 'info' | 'ok' | 'error'; icon?: IconName; children: ComponentChildren }) {
  return (
    <div class={`toast toast-${tone}`} role="status" aria-live="polite">
      <Icon name={icon} size={18} />
      <span>{children}</span>
    </div>
  );
}
