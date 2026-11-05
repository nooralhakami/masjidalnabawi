/** The canopy editor's pure parts (canopy-editor.ts), tested on their own. */

export interface Canopies {
  umbrellas: [number, number][];
  lamps: [number, number][];
}
export type Kind = keyof Canopies;

export const emptyCanopies = (): Canopies => ({ umbrellas: [], lamps: [] });

/** `n` points evenly spaced from `a` to `b`, both included: a straight row of canopies. */
export function rowBetween(a: readonly [number, number], b: readonly [number, number], n: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  });
}

/** The file as data/canopies.json keeps it: one point per line, seven decimals. */
export function toFile(c: Canopies): string {
  const list = (pts: [number, number][]) => pts.map(([lng, lat]) => `[${lng.toFixed(7)}, ${lat.toFixed(7)}]`).join(',\n');
  return `{"umbrellas":[\n${list(c.umbrellas)}\n],"lamps":[\n${list(c.lamps)}\n]}\n`;
}
