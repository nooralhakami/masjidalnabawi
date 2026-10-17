/** A loading placeholder in the shape of what is coming. */
export function Skeleton({ width = '100%', height = 14, round = false }: { width?: string | number; height?: number; round?: boolean }) {
  return <span class={`skeleton${round ? ' is-round' : ''}`} style={{ width: typeof width === 'number' ? `${width}px` : width, height: `${height}px` }} aria-hidden="true" />;
}

/** A place card while its details load. */
export function PlaceCardSkeleton({ label }: { label: string }) {
  return (
    <div class="place-card" aria-busy="true" aria-label={label}>
      <div class="pc-head">
        <Skeleton width={48} height={48} round />
        <div class="pc-titles" style={{ gap: '8px' }}>
          <Skeleton width="40%" height={12} />
          <Skeleton width="75%" height={20} />
        </div>
      </div>
      <Skeleton height={12} />
      <Skeleton width="85%" height={12} />
      <div class="chips">
        <Skeleton width={96} height={32} />
        <Skeleton width={72} height={32} />
        <Skeleton width={84} height={32} />
      </div>
    </div>
  );
}
