/** Unified SVG icon set: 24px grid, 1.75px stroke, round caps (matches the design canvas). */
const PATHS = {
  gate: '<path d="M5 21V11a7 7 0 0 1 14 0v10"/><path d="M9 21v-7a3 3 0 0 1 6 0v7"/><path d="M3 21h18"/>',
  men: '<circle cx="12" cy="4.5" r="2"/><path d="M9.5 21v-6.5H8V10a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4.5h-1.5V21"/>',
  women: '<circle cx="12" cy="4.5" r="2"/><path d="M10 21v-4.5H7.5L10 8.5h4l2.5 8H14V21"/>',
  mixed:
    '<circle cx="7.5" cy="5" r="1.8"/><circle cx="16.5" cy="5" r="1.8"/><path d="M5.5 21v-6h-1v-4.5A1.5 1.5 0 0 1 6 9h3a1.5 1.5 0 0 1 1.5 1.5V15h-1v6"/><path d="M15 21v-4h-2l2-8h3l2 8h-2v4"/>',
  elevator: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M9 10l3-3 3 3"/><path d="M9 14l3 3 3-3"/>',
  accessible: '<circle cx="11" cy="4" r="1.8"/><path d="M11 7.5V13h5l2.5 6"/><path d="M8 10.5a5.5 5.5 0 1 0 7.5 7"/>',
  cart: '<circle cx="9" cy="16.5" r="4"/><circle cx="18" cy="19" r="1.5"/><path d="M5 4h2l2 8.5h7l2 6.5"/><path d="M9 8.5h6"/>',
  parking: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9.5 17V7h3.5a3 3 0 0 1 0 6H9.5"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  hotel: '<path d="M3 19V6"/><path d="M3 15h18v4"/><path d="M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11.5" r="1.8"/>',
  food: '<path d="M7 3v18"/><path d="M4.5 3v5a2.5 2.5 0 0 0 5 0V3"/><path d="M17 21V3c-2.2 1.2-3.5 4-3.5 8H17"/>',
  historic: '<path d="M4 21h16"/><path d="M6 21V11h12v10"/><path d="M9 11a3 3 0 0 1 6 0"/><path d="M12 4.5c1.2 1 1.8 2 1.8 3.2H10.2c0-1.2.6-2.2 1.8-3.2z"/><path d="M19.5 21V6"/><path d="M18.5 6h2"/><path d="M10.5 21v-4h3v4"/>',
  bag: '<path d="M5.5 8h13l-1 12.5h-11z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/>',
  landmark: '<path d="M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.3 6.8 19l1-5.8L3.6 9.1l5.8-.8z"/>',
  emergency: '<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z"/>',
  police: '<path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z"/><path d="M12 8.5l1.2 2.4 2.6.4-1.9 1.8.5 2.6L12 14.5l-2.4 1.2.5-2.6-1.9-1.8 2.6-.4z"/>',
  child: '<circle cx="12" cy="5" r="2.2"/><path d="M8 11l4-2.5 4 2.5"/><path d="M12 8.5V15"/><path d="M9.5 21l2.5-6 2.5 6"/>',
  lostfound: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M10.5 12.5a1.6 1.6 0 1 1 2.2 1.5c-.5.2-.7.6-.7 1.1M12 17.5h.01"/>',
  prayer: '<path d="M4 21h16"/><path d="M6 21v-7a6 6 0 0 1 12 0v7"/><path d="M12 8V3"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>',
  toilets:
    '<circle cx="7" cy="5" r="1.8"/><circle cx="17" cy="5" r="1.8"/><path d="M5 21v-6H4v-4.5A1.5 1.5 0 0 1 5.5 9h3a1.5 1.5 0 0 1 1.5 1.5V15H9v6"/><path d="M15.5 21v-4h-2l2-8h3l2 8h-2v4"/><path d="M12 3v18"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  'eye-off': '<path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.3A10.8 10.8 0 0 1 21 12a10.8 10.8 0 0 1-3.2 5.5M6.2 6.2A10.8 10.8 0 0 0 3 12a10.8 10.8 0 0 0 9 7.7 10.8 10.8 0 0 0 3.1-.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  'rotate-left': '<path d="M9 5H5v4"/><path d="M5.5 9A7 7 0 1 1 7 17"/>',
  'rotate-right': '<path d="M15 5h4v4"/><path d="M18.5 9A7 7 0 1 0 17 17"/>',
  // Compass needle: the filled (north) half is coloured by CSS and turned to true north.
  'rotate-reset': '<circle cx="12" cy="12" r="9.5" stroke-width="1.5"/><path class="needle-n" d="M12 3.6l2.8 8.4h-5.6z" fill="currentColor" stroke="none"/><path class="needle-s" d="M10.6 12h2.8l-1.4 3z" fill="currentColor" stroke="none"/><g class="kaaba"><rect x="9.6" y="15.4" width="4.8" height="4.8" rx=".4" stroke-width=".7"/><rect class="kaaba-band" x="9.6" y="16.5" width="4.8" height=".9" stroke="none"/></g><circle cx="12" cy="12" r="1.3" fill="var(--surface-2, #fff)" stroke="none"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  chevdown: '<path d="M6 9l6 6 6-6"/>',
  chevleft: '<path d="M15 6l-6 6 6 6"/>',
  arrowleft: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
  home: '<path d="M3 11.5L12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5M9.5 20v-5h5v5"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  works: '<path d="M12 3l7 17H5z"/><path d="M8.2 13h7.6M9.8 9h4.4"/><path d="M3 20h18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  road: '<path d="M8 3L5 21M16 3l3 18M12 4v3M12 11v3M12 18v2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  iosshare: '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/>',
  dots: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
  addsq: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  languages: '<path d="M4 5h9M8.5 3v2M6 5c.5 3 2.5 6 6 7.5"/><path d="M11 5c-.5 3-3 6.5-7 8"/><path d="M13 21l4-9 4 9M14.5 17.5h5"/>',
  dome: '<path d="M4 20h16"/><path d="M5.5 20v-6.5a6.5 6.5 0 0 1 13 0V20"/><path d="M12 7V3.5"/><path d="M10.5 4.5h3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  car: '<path d="M5 17h14v-4.5l-1.8-4.7A2 2 0 0 0 15.3 6.5H8.7a2 2 0 0 0-1.9 1.3L5 12.5z"/><path d="M5 12.5h14"/><circle cx="8" cy="17" r="1.8"/><circle cx="16" cy="17" r="1.8"/>',
  walk: '<circle cx="13" cy="4" r="1.8"/><path d="M9 21l2.5-6.5L14 17v4"/><path d="M7 11l3-3.5h3.5l2 4 2.5 1"/><path d="M11.5 14.5L13 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  cloud: '<path d="M7 18h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18z"/>',
  rain: '<path d="M7 14.5h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14.5z"/><path d="M9 17.5l-1 3M13 17.5l-1 3M17 17.5l-1 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 20, cls = ''): string {
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/** Eight-point star brand mark (two squares + circle). */
export function brandStar(size = 24): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="13" height="13" rx="1"/><rect x="5.5" y="5.5" width="13" height="13" rx="1" transform="rotate(45 12 12)"/><circle cx="12" cy="12" r="2.4"/></svg>`;
}
