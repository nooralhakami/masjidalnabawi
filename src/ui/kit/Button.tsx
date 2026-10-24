import type { ComponentChildren, JSX } from 'preact';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon' | 'loading'> {
  variant?: Variant;
  icon?: IconName;
  block?: boolean;
  /** Busy: keeps its width, shows a spinner and is announced as busy. */
  loading?: boolean;
  disabled?: boolean;
  children?: ComponentChildren;
}

/** 48 px tall; primary green, secondary surface with a gold hairline, ghost, danger. */
export function Button({ variant = 'primary', icon, block, loading, disabled, children, class: cls, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      class={`btn btn-${variant}${block ? ' btn-block' : ''}${loading ? ' is-loading' : ''}${cls ? ` ${cls}` : ''}`}
      disabled={disabled}
      aria-busy={loading ? 'true' : undefined}
    >
      {loading ? <span class="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      <span class="btn-label">{children}</span>
    </button>
  );
}

export interface IconButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon'> {
  icon: IconName;
  /** Required: an icon alone says nothing to a screen reader. */
  label: string;
  /** Floating over the map (round, panel surface, soft shadow). */
  floating?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  flip?: boolean;
}

/** 44 × 44 px, always labelled. */
export function IconButton({ icon, label, floating, pressed, flip, class: cls, ...rest }: IconButtonProps) {
  return (
    <button type="button" {...rest} class={`icon-btn${floating ? ' is-floating' : ''}${cls ? ` ${cls}` : ''}`} aria-label={label} title={label} aria-pressed={pressed}>
      <Icon name={icon} flip={flip} />
    </button>
  );
}
