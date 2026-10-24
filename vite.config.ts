import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { HIDDEN_SUBCATEGORIES } from './src/data/hidden';

const POIS: { category: string; subCategory: string }[] = JSON.parse(readFileSync(resolve(import.meta.dirname, 'data/pois.json'), 'utf8'));
/** The landing page's numbers, computed from the data at build time (the live app's vite.config.ts). */
const DEFINE = {
  __POI_COUNTS__: JSON.stringify({
    // The places a visitor can actually find (hidden ones, such as the wheelchair areas, are not counted).
    places: POIS.filter((p) => !HIDDEN_SUBCATEGORIES.has(p.subCategory)).length,
    gates: POIS.filter((p) => p.category === 'gates').length,
    parking: POIS.filter((p) => p.category === 'parking').length,
  }),
};
const OXC = { jsx: { runtime: 'automatic', importSource: 'preact' } } as const;

/**
 * Prerender the Arabic landing page into index.html, so its content paints before any script
 * loads (SPEC F10). The browser keeps it when the visitor's language is Arabic, re-renders otherwise.
 */
function prerenderLanding(): Plugin {
  return {
    name: 'prerender-landing',
    transformIndexHtml: {
      order: 'pre',
      async handler(html, ctx) {
        if (!ctx.filename.endsWith('index.html') || !html.includes('<div id="app"></div>')) return html;
        const server = ctx.server ?? (await createServer({ configFile: false, define: DEFINE, oxc: OXC, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' }));
        try {
          const { landingHtml } = await server.ssrLoadModule('/src/landing/view.ts');
          return html.replace('<div id="app"></div>', `<div id="app" data-prerendered="ar">${landingHtml('')}</div>`);
        } finally {
          if (!ctx.server) await server.close();
        }
      },
    },
  };
}

/**
 * Inline each page's stylesheets into its HTML at build time: no render-blocking request (the HTML
 * itself is precached by the service worker). Asset URLs inside are rewritten to stay valid. Lazy
 * parts (stories, library) keep their own CSS files, loaded with them.
 */
function inlineCss(): Plugin {
  return {
    name: 'inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const inlined = new Set<string>();
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.html')) continue;
        let html = String(file.source);
        html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (tag, path: string) => {
          const css = bundle[path];
          if (!css || css.type !== 'asset') return tag;
          const code = String(css.source).replace(/url\((['"]?)\.\//g, 'url($1./assets/');
          inlined.add(path);
          return `<style>${code}</style>`;
        });
        file.source = html;
      }
      // A lazy chunk (the stories) may still list an inlined file among the CSS it preloads: deleting
      // it then makes that preload 404 and the chunk fail to load. Keep those; drop only the rest.
      const preloaded = new Set<string>();
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk' && !file.isEntry) for (const css of file.viteMetadata?.importedCss ?? []) preloaded.add(css);
      }
      for (const path of inlined) if (!preloaded.has(path)) delete bundle[path];
    },
  };
}

/** Languages every page carries in full: the fallbacks of t(), and English names are searched in any language. */
const BASE_LANGS = ['ar', 'en'];
const LOCALES = resolve(import.meta.dirname, 'src/i18n/locales');

/**
 * One translation file per language (ARCHITECTURE §7). The page bundles Arabic and English in full;
 * for the 24 others it keeps only what the language menu shows (name, short code, direction), and
 * each ships as i18n/<code>.json: its place texts from data/i18n.json and its interface texts from
 * src/i18n/locales/<code>.json. src/i18n/load.ts fetches it and merges it into the packs before the
 * page uses them. Dev and the tests keep everything.
 */
function splitI18n(): Plugin {
  let full: Record<string, Record<string, unknown>> = {};
  return {
    name: 'split-i18n',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      full = JSON.parse(readFileSync(resolve(import.meta.dirname, 'data/i18n.json'), 'utf8'));
    },
    load(id, opts) {
      if (opts?.ssr) return null;
      const path = id.split('?')[0];
      if (path.endsWith('/data/i18n.json')) {
        const stub = Object.fromEntries(Object.entries(full).map(([l, p]) => [l, BASE_LANGS.includes(l) ? p : { n: p.n, short: p.short, dir: p.dir }]));
        // Still JSON: Vite's own JSON plugin turns it into a module afterwards.
        return JSON.stringify(stub);
      }
      const locale = path.startsWith(`${LOCALES}/`) && path.endsWith('.json') ? path.slice(LOCALES.length + 1, -5) : null;
      if (locale && !BASE_LANGS.includes(locale)) return '{}';
      return null;
    },
    generateBundle() {
      for (const [l, p] of Object.entries(full)) {
        if (BASE_LANGS.includes(l)) continue;
        const ui = JSON.parse(readFileSync(resolve(LOCALES, `${l}.json`), 'utf8'));
        this.emitFile({ type: 'asset', fileName: `i18n/${l}.json`, source: JSON.stringify({ pack: p, ui }) });
      }
    },
  };
}

export default defineConfig({
  // Relative URLs so the build works on any host or sub-path.
  base: './',
  define: DEFINE,
  plugins: [
    tailwindcss(),
    splitI18n(),
    prerenderLanding(),
    inlineCss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registration happens in each page entry (src/app/pwa.ts).
      injectRegister: false,
      manifest: {
        id: './map.html',
        name: 'دليل زوار المسجد النبوي',
        short_name: 'دليل الزوار',
        // The live app's manifest still said «six languages»: corrected to the 26 it offers.
        description: 'خريطة تفاعلية للبوابات ودورات المياه والمواقف والخدمات حول المسجد النبوي بـ26 لغة.',
        lang: 'ar',
        dir: 'rtl',
        start_url: './map.html',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F4F1EA',
        theme_color: '#0E4D3A',
        categories: ['travel', 'navigation'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell, its lazy parts, the map's worker and the fonts (Arabic and Latin subsets only).
        // The 24 translation files too, so a language chosen offline (after one visit) still has its texts.
        globPatterns: ['**/*.{html,js,mjs,css,jpg,webp}', 'i18n/*.json', 'icons/icon.svg', 'icons/apple-touch-icon.png', 'assets/*-{arabic,latin}-*.woff2'],
        // Landmark photos (public/visits/) load on demand; the design gallery is not part of the app.
        globIgnores: ['visits/**', 'design.html', '**/*-cyrillic*', '**/*-greek*', '**/*-vietnamese*', '**/*-math-*', '**/*-symbols-*'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Map tiles (Esri / OpenStreetMap) are cross-origin and deliberately never cached (CLAUDE.md).
        runtimeCaching: [],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  // Preact's automatic JSX runtime (tsconfig sets the same for type-checking).
  oxc: OXC,
  build: {
    target: 'es2020',
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, 'index.html'), map: resolve(import.meta.dirname, 'map.html') },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // The street-graph tests plan dozens of full routes; on a small CI machine one takes ~6 s
    // (default limit 5 s). Same tests and expectations as the live app, only more time.
    testTimeout: 30_000,
  },
});
