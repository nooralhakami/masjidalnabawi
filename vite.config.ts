import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const POIS: { category: string }[] = JSON.parse(readFileSync(resolve(import.meta.dirname, 'data/pois.json'), 'utf8'));
const DEFINE = {
  __POI_COUNTS__: JSON.stringify({
    places: POIS.length,
    gates: POIS.filter((p) => p.category === 'gates').length,
    parking: POIS.filter((p) => p.category === 'parking').length,
  }),
};

/**
 * Prerender the Arabic landing page into index.html so content paints before JS loads.
 * The browser reuses it when the visitor's language is Arabic, and re-renders otherwise.
 */
function prerenderLanding(): Plugin {
  return {
    name: 'prerender-landing',
    transformIndexHtml: {
      order: 'pre',
      async handler(html, ctx) {
        if (!ctx.filename.endsWith('index.html') || !html.includes('<div id="app"></div>')) return html;
        const server = ctx.server ?? (await createServer({ configFile: false, define: DEFINE, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' }));
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
 * Inline each page's stylesheets into its HTML at build time: removes render-blocking requests
 * (the HTML itself is precached by the service worker). Asset URLs are rewritten to stay valid.
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
      // The separate .css files are no longer referenced.
      for (const path of inlined) delete bundle[path];
    },
  };
}

export default defineConfig({
  // Relative URLs so the build works on any host or sub-path.
  base: './',
  define: DEFINE,
  plugins: [
    tailwindcss(),
    prerenderLanding(),
    inlineCss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registration happens in each page entry (src/pwa.ts).
      injectRegister: false,
      manifest: {
        id: './map.html',
        name: 'دليل زوار المسجد النبوي',
        short_name: 'دليل الزوار',
        description: 'خريطة تفاعلية للبوابات ودورات المياه والمواقف والخدمات حول المسجد النبوي بست لغات.',
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
        // App shell, JS libraries and fonts (Arabic + Latin subsets only). The plugin adds the manifest and its icons.
        globPatterns: ['**/*.{html,js,css,jpg,webp}', 'icons/icon.svg', 'icons/apple-touch-icon.png', 'almasjidalnabawi-qr.svg', 'assets/*-{arabic,latin}-*.woff2'],
        globIgnores: ['**/*-cyrillic*', '**/*-greek*', '**/*-vietnamese*', '**/*-math-*', '**/*-symbols-*'],
        // Map tiles (Esri / OpenStreetMap) are cross-origin and deliberately never cached.
        runtimeCaching: [],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        map: resolve(import.meta.dirname, 'map.html'),
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
