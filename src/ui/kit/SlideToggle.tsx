import { useRef } from 'preact/hooks';
import { SPRINGS, springEasing } from '../sheet/physics';
import { Icon, type IconName } from './Icon';

const MOTION = springEasing(SPRINGS.toggle);

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** The colour the chosen option takes (walking green, driving blue, level A yellow, level B green). */
  tone: 'walk' | 'drive' | 'level-a' | 'level-b';
}

/**
 * Two or more choices with a thumb that slides under the chosen one (spring easing from the sheet's
 * physics). A radio group: arrow keys move the choice, as screen readers expect.
 */
export function SlideToggle<T extends string>({ label, options, value, onChange, disabled }: { label: string; options: readonly ToggleOption<T>[]; value: T; onChange(v: T): void; disabled?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (to: number) => {
    const k = (to + options.length) % options.length;
    onChange(options[k].value);
    refs.current[k]?.focus();
  };
  return (
    <div
      class={`slide-toggle tone-${options[i].tone}${disabled ? ' is-disabled' : ''}`}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled ? 'true' : undefined}
      style={{ '--n': options.length, '--i': i, '--toggle-ease': MOTION.easing, '--toggle-ms': `${MOTION.ms}ms` }}
      onKeyDown={(e) => {
        if (disabled) return;
        const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          move(i + ((e.key === 'ArrowRight') !== rtl ? 1 : -1));
        }
      }}
    >
      <span class="slide-thumb" aria-hidden="true" />
      {options.map((o, k) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[k] = el;
          }}
          type="button"
          role="radio"
          aria-checked={k === i}
          tabIndex={k === i ? 0 : -1}
          disabled={disabled}
          class="slide-opt"
          onClick={() => onChange(o.value)}
        >
          {o.icon ? <Icon name={o.icon} /> : null}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
