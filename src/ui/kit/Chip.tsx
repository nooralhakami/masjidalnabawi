import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './Icon';

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'sub';

/** A piece of information on a card: side (with its colour dot), status, number, access. */
export function Chip({ tone = 'neutral', dot, icon, children }: { tone?: Tone; dot?: string; icon?: IconName; children: ComponentChildren }) {
  return (
    <span class={`chip chip-${tone}`}>
      {dot ? <span class="chip-dot" style={{ '--c': dot }} aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} size={14} /> : null}
      <span>{children}</span>
    </span>
  );
}
