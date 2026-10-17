import { icon, type IconName } from '../../presentation/icons';

/** One icon from the shared SVG set (24 px grid, 1.75 px stroke). Decorative unless labelled. */
export function Icon({ name, size = 20, flip = false, label }: { name: IconName; size?: number; flip?: boolean; label?: string }) {
  return (
    <span
      class={`ic${flip ? ' flip' : ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      // The SVG strings are static, from presentation/icons.ts.
      dangerouslySetInnerHTML={{ __html: icon(name, size) }}
    />
  );
}
export type { IconName };
