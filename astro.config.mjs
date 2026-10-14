// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Used for canonical URLs and the generated sitemap.
  site: 'https://mindwells.github.io',

  // GitHub Pages serves `/about/` from `/about/index.html`; the default
  // 'ignore' keeps both `/about` and `/about/` working.
  trailingSlash: 'ignore',

  build: {
    format: 'directory',
    // Inline small stylesheets, link large ones. Keeps the critical path
    // short without bloating the HTML.
    inlineStylesheets: 'auto',
  },

  integrations: [sitemap()],

  markdown: {
    shikiConfig: {
      theme: 'vitesse-light',
      wrap: true,
    },
  },

  // The dev toolbar is a development affordance, but it injects shadow DOM
  // and floating UI that interfere with layout measurements.
  devToolbar: {
    enabled: false,
  },
});
