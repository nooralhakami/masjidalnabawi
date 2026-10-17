import type { ComponentChildren } from 'preact';

/** A countdown ring: the coloured arc is the share of the current turn still left. */
export function Ring({ left, color, size = 56, stroke = 5, children }: { left: number; color: string; size?: number; stroke?: number; children?: ComponentChildren }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const share = Math.min(1, Math.max(0, left));
  return (
    <span class="ring" style={{ width: `${size}px`, height: `${size}px` }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" stroke-width={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          stroke-width={stroke}
          stroke-linecap="round"
          stroke-dasharray={`${c} ${c}`}
          stroke-dashoffset={c * (1 - share)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span class="ring-in">{children}</span>
    </span>
  );
}
