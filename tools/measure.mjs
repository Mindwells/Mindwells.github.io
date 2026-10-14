/**
 * Automated design audit.
 *
 * Loads the built site in headless Edge over the Chrome DevTools Protocol and
 * measures what a reviewer would otherwise judge by eye: horizontal overflow,
 * colour contrast, tap-target sizes, vertical rhythm, heading hierarchy, and
 * cumulative layout shift. Screenshots are written alongside so a human can
 * confirm the quantitative findings.
 *
 * CDP is driven over a WebSocket rather than by spawning the browser from
 * Node, so it works in environments that block piped child processes.
 *
 *   node tools/measure.mjs            # audits http://127.0.0.1:4321
 *   PORT=5000 node tools/measure.mjs  # different port
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const PORT = process.env.PORT ?? '4321';
const CDP_PORT = process.env.CDP_PORT ?? '9222';
const BASE = `http://127.0.0.1:${PORT}`;
const outDir = resolve(fileURLToPath(new URL('../.audit', import.meta.url)));

/** Breakpoints to exercise. Chosen around the design's own breakpoints. */
const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 780 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 900 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'wide-1920', width: 1920, height: 1080 },
];

/* -------------------------------------------------------------------------- */
/* CDP plumbing                                                               */
/* -------------------------------------------------------------------------- */

async function findPageTarget() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('No page target found. Is the browser running with --remote-debugging-port?');
  return page;
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: done, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
      else done(msg.result);
      return;
    }
    if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params);
    }
  });

  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('CDP socket error')), { once: true });
  });

  return {
    ready,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method) {
      return new Promise((res) => {
        const fn = (params) => {
          listeners.get(method).delete(fn);
          res(params);
        };
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method).add(fn);
      });
    },
    close() {
      ws.close();
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------------------- */
/* In-page measurement                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Runs inside the page. Returns a plain object so it can cross the CDP
 * boundary by value.
 */
async function measurementScript() {
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));

  const parseColor = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((p) => Number.parseFloat(p));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };

  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

  const contrast = (fg, bg) => {
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  };

  /** Walks ancestors until an opaque background is found. */
  const effectiveBackground = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parseColor(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.85) return bg;
      node = node.parentElement;
    }
    const rootBg = parseColor(getComputedStyle(document.body).backgroundColor);
    return rootBg ?? { r: 255, g: 255, b: 255, a: 1 };
  };

  /* Elements hidden behind a 0-opacity ancestor still report opacity 1 on
     themselves, so `getComputedStyle(el).opacity` is not enough to tell
     whether text is actually visible. `checkVisibility` accounts for the
     whole ancestor chain. */
  const isVisible = (el) => {
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
    }
    let node = el;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number.parseFloat(style.opacity) < 0.1) return false;
      node = node.parentElement;
    }
    return true;
  };

  const describe = (el) => {
    if (!el) return 'none';
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };

  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;

  /* --- 1. Horizontal overflow --- */
  const overflow = [];
  for (const el of document.querySelectorAll('*')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    // 1px tolerance for sub-pixel rounding.
    if (rect.right > viewportWidth + 1 || rect.left < -1) {
      const style = getComputedStyle(el);
      if (style.position === 'fixed') continue;
      overflow.push({
        selector: describe(el),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      });
    }
  }

  /* --- 2. Colour contrast on text --- */
  const contrastIssues = [];
  const contrastChecked = [];
  const textSelectors = [
    'h1', 'h2', 'h3', 'h4', 'p', 'a', 'li', 'dd', 'dt', 'button',
    '.meta', '.label', '.mono', '.timeline__period', '.section-header__index',
    '.hero__status', '.hero__tag', '.news__date', '.pub__year', '.footer__copy-line',
    '.facts__term', '.facts__value', '.contact__link-handle',
  ];

  for (const selector of textSelectors) {
    for (const el of document.querySelectorAll(selector)) {
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const style = getComputedStyle(el);
      // Screen-reader-only text is not visible, so contrast does not apply.
      if (el.closest('.visually-hidden') || el.classList.contains('visually-hidden')) continue;
      // Skip anything not actually rendered — measuring hidden text produces
      // false contrast results and masks "the content never appeared" bugs.
      if (!isVisible(el)) continue;

      const fg = parseColor(style.color);
      if (!fg) continue;
      const bg = effectiveBackground(el);
      const ratio = contrast(fg, bg);

      const fontSize = Number.parseFloat(style.fontSize);
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
      const required = isLarge ? 3 : 4.5;

      const record = {
        selector: describe(el),
        fontSize: Math.round(fontSize * 10) / 10,
        weight,
        ratio: Math.round(ratio * 100) / 100,
        required,
        sample: text.slice(0, 42),
      };

      if (ratio < required) contrastIssues.push(record);
      // Track the weakest passing text too, so we can see how close to the edge we are.
      contrastChecked.push(record);
    }
  }

  /* --- 3. Tap targets --- */
  /* A control can have a small visual box but a large hit area (an expanded
     ::before/::after, or padding). getBoundingClientRect only sees the visual
     box, so anything that looks small is hit-tested outward from its centre
     to find the area the pointer can actually use. */
  const hitExtent = (el) => {
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return null;

    const matches = (x, y) => {
      const t = document.elementFromPoint(x, y);
      return Boolean(t) && (t === el || el.contains(t) || t.contains(el));
    };

    const MAX = 30;
    let up = 0;
    let down = 0;
    let left = 0;
    let right = 0;
    for (let d = 1; d <= MAX; d++) {
      if (matches(cx, cy - d)) up = d;
      else break;
    }
    for (let d = 1; d <= MAX; d++) {
      if (matches(cx, cy + d)) down = d;
      else break;
    }
    for (let d = 1; d <= MAX; d++) {
      if (matches(cx - d, cy)) left = d;
      else break;
    }
    for (let d = 1; d <= MAX; d++) {
      if (matches(cx + d, cy)) right = d;
      else break;
    }
    return { width: left + right + 1, height: up + down + 1 };
  };

  const smallTargets = [];
  const candidates = [];
  for (const el of document.querySelectorAll('a[href], button, [role="button"], input, select, textarea')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;

    // WCAG 2.5.8 exempts links inline within a sentence.
    const isInlineInText = el.tagName === 'A' && el.closest('p, li, dd, .prose') && style.display.includes('inline');
    if (isInlineInText) continue;

    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 44 || h < 44) candidates.push({ el, w, h });
  }

  // Hit-testing needs the element on screen; smooth scrolling is disabled so
  // positions are correct immediately after scrollIntoView.
  const previousBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  const scrollY = window.scrollY;

  for (const { el, w, h } of candidates) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await settle(60);
    const extent = hitExtent(el);
    const effective = extent ?? { width: w, height: h };
    if (effective.width < 44 || effective.height < 44) {
      smallTargets.push({
        selector: describe(el),
        width: effective.width,
        height: effective.height,
        visualWidth: w,
        visualHeight: h,
        measured: extent ? 'hit-test' : 'rect',
      });
    }
  }

  window.scrollTo(0, scrollY);
  document.documentElement.style.scrollBehavior = previousBehavior;

  /* --- 3b. Web fonts --- */
  const fontFamilies = [];
  document.fonts.forEach((f) => {
    fontFamilies.push({ family: f.family, style: f.style, status: f.status });
  });
  const fonts = {
    loaded: document.fonts.status === 'loaded',
    count: fontFamilies.length,
    families: [...new Set(fontFamilies.map((f) => f.family))],
    available: {
      newsreader: document.fonts.check('400 1rem Newsreader'),
      newsreaderItalic: document.fonts.check('italic 400 1rem Newsreader'),
      inter: document.fonts.check('400 1rem Inter'),
      jetbrainsMono: document.fonts.check('400 1rem "JetBrains Mono"'),
    },
  };

  /* --- 3c. Sticky header --- */
  const headerEl = document.querySelector('[data-header]');
  let sticky = null;
  if (headerEl) {
    const behavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    const restore = window.scrollY;
    window.scrollTo(0, 900);
    await settle(150);
    const first = {
      top: Math.round(headerEl.getBoundingClientRect().top),
      condensed: headerEl.classList.contains('is-condensed'),
    };
    // IntersectionObserver callbacks can lag a frame; confirm the settled state.
    await settle(400);
    const settled = {
      top: Math.round(headerEl.getBoundingClientRect().top),
      condensed: headerEl.classList.contains('is-condensed'),
    };
    sticky = {
      position: getComputedStyle(headerEl).position,
      scrollY: Math.round(window.scrollY),
      documentHeight: Math.round(document.documentElement.scrollHeight),
      after150ms: first,
      after550ms: settled,
      topAfterScroll: settled.top,
      isStuck: Math.abs(settled.top) < 2,
      condensed: settled.condensed,
    };
    window.scrollTo(0, restore);
    await settle(80);
    document.documentElement.style.scrollBehavior = behavior;
  }

  /* --- 4. Vertical rhythm --- */
  const rhythm = [];
  for (const section of document.querySelectorAll('section[id], footer')) {
    const rect = section.getBoundingClientRect();
    rhythm.push({
      id: section.id || section.tagName.toLowerCase(),
      height: Math.round(rect.height),
    });
  }

  /* --- 5. Heading hierarchy --- */
  const headings = [...document.querySelectorAll('h1, h2, h3, h4')].map((h) => ({
    level: Number(h.tagName[1]),
    text: (h.textContent ?? '').trim().slice(0, 48),
    fontSize: Math.round(Number.parseFloat(getComputedStyle(h).fontSize) * 10) / 10,
  }));

  /* --- 6. Typography + measure --- */
  const bodyStyle = getComputedStyle(document.body);
  const measureProbe = document.querySelector('.about__prose p:not(.about__lede)') ?? document.querySelector('p');
  const typography = {
    bodyFontSize: Math.round(Number.parseFloat(bodyStyle.fontSize) * 10) / 10,
    bodyLineHeight: Math.round(Number.parseFloat(bodyStyle.lineHeight) * 10) / 10,
    bodyFontFamily: bodyStyle.fontFamily.split(',')[0].replace(/['"]/g, ''),
    measurePx: measureProbe ? Math.round(measureProbe.getBoundingClientRect().width) : null,
  };

  /* --- 7. Layout shift + paint timing --- */
  const nav = performance.getEntriesByType('navigation')[0];
  const paint = performance.getEntriesByType('paint');
  const performance_ = {
    domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    loadEvent: nav ? Math.round(nav.loadEventEnd) : null,
    firstPaint: Math.round(paint.find((p) => p.name === 'first-paint')?.startTime ?? 0),
    firstContentfulPaint: Math.round(paint.find((p) => p.name === 'first-contentful-paint')?.startTime ?? 0),
    cls: typeof window.__cls === 'number' ? Math.round(window.__cls * 10000) / 10000 : null,
  };

  /* --- 8. Images --- */
  const images = [...document.querySelectorAll('img')].map((img) => ({
    src: img.getAttribute('src'),
    hasAlt: img.hasAttribute('alt'),
    altEmpty: img.getAttribute('alt') === '',
    naturalWidth: img.naturalWidth,
    displayedWidth: Math.round(img.getBoundingClientRect().width),
    loading: img.getAttribute('loading') ?? 'eager',
    hasDimensions: img.hasAttribute('width') && img.hasAttribute('height'),
  }));

  /* --- 9. Enhancement wiring ---
     Guards against the whole interaction layer silently failing to load.
     Only elements inside the observer's *effective* trigger zone count: the
     reveal observer intentionally waits until an element is ~12% into the
     viewport, so anything in the bottom sliver is legitimately still hidden.
     An element inside the trigger zone that never appears is a real bug. */
  const revealEls = [...document.querySelectorAll('[data-reveal]')];
  const triggerBottom = window.innerHeight * 0.88;
  const inTriggerZone = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < triggerBottom && r.width > 0;
  };
  const inViewportNotVisible = revealEls.filter((el) => inTriggerZone(el) && !isVisible(el));
  const enhancement = {
    dataReveal: revealEls.length,
    revealed: revealEls.filter((el) => el.classList.contains('is-revealed')).length,
    inViewport: revealEls.filter(inTriggerZone).length,
    stillInvisible: inViewportNotVisible.length,
    invisibleSelectors: inViewportNotVisible.map(describe),
    themeToggle: document.querySelectorAll('[data-theme-toggle]').length,
    copyButtons: document.querySelectorAll('[data-copy]').length,
    scriptCount: document.querySelectorAll('script[src]').length,
  };

  /* --- 10. Hero visualisation actually renders ---
     A canvas can exist, be sized correctly, and still be blank — e.g. if the
     drawing code throws on its first frame. Sample the pixels to prove the
     signature animation is painting something. */
  const canvasEl = document.querySelector('[data-viz-canvas]');
  let viz = null;
  if (canvasEl instanceof HTMLCanvasElement && canvasEl.width > 0 && canvasEl.height > 0) {
    try {
      const c2d = canvasEl.getContext('2d');
      const { width: cw, height: ch } = canvasEl;
      const pixels = c2d.getImageData(0, 0, cw, ch).data;
      let painted = 0;
      let sampled = 0;
      // Sample every 40th pixel — enough to distinguish blank from drawn.
      for (let i = 3; i < pixels.length; i += 4 * 40) {
        sampled++;
        if (pixels[i] > 8) painted++;
      }
      viz = {
        width: cw,
        height: ch,
        sampled,
        painted,
        paintedRatio: Math.round((painted / Math.max(sampled, 1)) * 10000) / 10000,
      };
    } catch (error) {
      viz = { error: String(error) };
    }
  } else {
    viz = { error: 'canvas missing or zero-sized' };
  }

  return {
    viewport: { width: viewportWidth, height: viewportHeight },
    documentWidth: document.documentElement.scrollWidth,
    horizontalOverflow: overflow,
    contrastIssues,
    contrastChecked,
    smallTargets,
    fonts,
    sticky,
    rhythm,
    headings,
    typography,
    performance: performance_,
    images,
    enhancement,
    viz,
  };
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                     */
/* -------------------------------------------------------------------------- */

async function auditViewport(cdp, url, viewport, { theme = 'light', screenshot = true } = {}) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width < 768,
  });

  if (theme === 'dark') {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    });
  } else {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }],
    });
  }

  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  // Let fonts settle, reveal animations finish, and the canvas draw.
  await sleep(1400);

  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `(${measurementScript.toString()})()`,
    returnByValue: true,
    awaitPromise: true,
  });

  const data = result.value;
  const suffix = theme === 'dark' ? '-dark' : '';

  if (screenshot) {
    const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
    const height = Math.min(Math.ceil(cssContentSize.height), 12000);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: viewport.width, height, scale: 1 },
    });
    writeFileSync(join(outDir, `${viewport.name}${suffix}.png`), Buffer.from(shot.data, 'base64'));

    // A viewport-only shot too, so the fold can be judged on its own.
    const fold = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `${viewport.name}${suffix}-fold.png`), Buffer.from(fold.data, 'base64'));
  }

  return data;
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  const target = await findPageTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // Install the layout-shift observer before any navigation so nothing is missed.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__cls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch (e) {}
    `,
  });

  const report = { url: BASE, generatedAt: new Date().toISOString(), viewports: {} };

  for (const viewport of VIEWPORTS) {
    process.stdout.write(`auditing ${viewport.name} … `);
    const data = await auditViewport(cdp, BASE, viewport);
    report.viewports[viewport.name] = data;

    // Contrast and overflow are theme-dependent; check dark at desktop only.
    if (viewport.name === 'desktop-1440') {
      report.viewports['desktop-1440-dark'] = await auditViewport(cdp, BASE, viewport, { theme: 'dark' });
    }

    const flags = [];
    if (data.horizontalOverflow.length) flags.push(`overflow:${data.horizontalOverflow.length}`);
    if (data.contrastIssues.length) flags.push(`contrast:${data.contrastIssues.length}`);
    if (data.smallTargets.length) flags.push(`targets:${data.smallTargets.length}`);
    if (data.performance.cls > 0.1) flags.push(`cls:${data.performance.cls}`);
    if (data.enhancement.stillInvisible > 0) {
      flags.push(`INVISIBLE-IN-VIEWPORT:${data.enhancement.invisibleSelectors.join('|')}`);
    }
    if (data.viz && (data.viz.error || data.viz.painted === 0)) {
      flags.push(`VIZ:${data.viz.error ?? 'blank canvas'}`);
    }
    console.log(flags.length ? flags.join(' ') : 'clean');
  }

  // Also audit the 404 page at a single breakpoint.
  process.stdout.write('auditing 404 … ');
  report.notFound = await auditViewport(
    cdp,
    `${BASE}/definitely-not-a-page`,
    { name: 'notfound-1440', width: 1440, height: 900 },
  );
  console.log('done');

  /* --- Robustness passes ------------------------------------------------
     These check the page still works when the user's preferences or
     environment remove capabilities, which is where "polished" sites
     usually break. */

  const desktop = { name: 'checks-1440', width: 1440, height: 900 };

  // 1. prefers-reduced-motion: nothing may stay invisible.
  process.stdout.write('checking reduced-motion … ');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: desktop.width,
    height: desktop.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: BASE });
    await loaded;
    await sleep(900);
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const hidden = [...document.querySelectorAll('[data-reveal]')]
          .filter((el) => Number.parseFloat(getComputedStyle(el).opacity) < 0.9)
          .map((el) => el.className || el.tagName);
        const canvas = document.querySelector('[data-viz-canvas]');
        return {
          revealCount: document.querySelectorAll('[data-reveal]').length,
          stillHidden: hidden,
          canvasPainted: canvas ? canvas.width > 0 && canvas.height > 0 : null,
        };
      })()`,
      returnByValue: true,
    });
    report.reducedMotion = result.value;
    console.log(report.reducedMotion.stillHidden.length === 0 ? 'clean' : `HIDDEN:${report.reducedMotion.stillHidden.length}`);
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });

  // 2. JavaScript disabled: the page must still read as a complete document.
  process.stdout.write('checking no-JS … ');
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
  {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: BASE });
    await loaded;
    await sleep(700);
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const hidden = [...document.querySelectorAll('[data-reveal]')]
          .filter((el) => Number.parseFloat(getComputedStyle(el).opacity) < 0.9).length;
        return {
          chars: (document.body.innerText || '').trim().length,
          hiddenByReveal: hidden,
          sections: document.querySelectorAll('section[id]').length,
        };
      })()`,
      returnByValue: true,
    });
    report.noJs = result.value;
    console.log(report.noJs.hiddenByReveal === 0 && report.noJs.chars > 400 ? 'clean' : 'PROBLEM');
  }
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });

  /* --- 3. Theme toggle actually switches themes --- */
  process.stdout.write('checking theme toggle … ');
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: BASE });
    await loaded;
    await sleep(900);
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const before = document.documentElement.getAttribute('data-theme');
        const bgBefore = getComputedStyle(document.body).backgroundColor;
        const toggle = document.querySelector('[data-theme-toggle]');
        if (!toggle) return { error: 'no toggle' };
        toggle.click();
        await new Promise((r) => setTimeout(r, 500));
        const after = document.documentElement.getAttribute('data-theme');
        const bgAfter = getComputedStyle(document.body).backgroundColor;
        let stored = null;
        try { stored = localStorage.getItem('theme'); } catch (e) {}
        return { before, after, bgBefore, bgAfter, stored, changed: bgBefore !== bgAfter };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    report.themeToggle = result.value;
    console.log(report.themeToggle.changed ? 'clean' : 'PROBLEM');
  }

  /* --- 4. Mobile drawer opens, traps scroll, and closes on Escape --- */
  process.stdout.write('checking mobile drawer … ');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: BASE });
    await loaded;
    await sleep(900);
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const button = document.querySelector('[data-menu-toggle]');
        const drawer = document.querySelector('[data-drawer]');
        if (!button || !drawer) return { error: 'missing markup' };
        const initiallyHidden = drawer.hidden;
        button.click();
        await new Promise((r) => setTimeout(r, 400));
        const openedHidden = drawer.hidden;
        const expanded = button.getAttribute('aria-expanded');
        const bodyOverflow = document.body.style.overflow;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        return {
          initiallyHidden,
          openedHidden,
          expanded,
          bodyOverflow,
          closedAfterEscape: drawer.hidden,
          expandedAfterEscape: button.getAttribute('aria-expanded'),
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    report.mobileDrawer = result.value;
    const ok = result.value?.initiallyHidden === true && result.value?.openedHidden === false && result.value?.closedAfterEscape === true;
    console.log(ok ? 'clean' : 'PROBLEM');
  }

  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));

  /* --- Console summary --- */
  console.log('\n' + '='.repeat(72));
  for (const [name, data] of Object.entries(report.viewports)) {
    const issues = [];
    if (data.horizontalOverflow.length) issues.push(`  overflow (${data.horizontalOverflow.length})`);
    if (data.contrastIssues.length) issues.push(`  contrast (${data.contrastIssues.length})`);
    if (data.smallTargets.length) issues.push(`  tap targets (${data.smallTargets.length})`);

    console.log(`\n${name}  doc=${data.documentWidth} vp=${data.viewport.width}  cls=${data.performance.cls}`);
    if (!issues.length) console.log('  clean');
    for (const issue of issues) console.log(issue);

    for (const item of data.horizontalOverflow.slice(0, 6)) {
      console.log(`    ↳ overflow ${item.selector} right=${item.right} (vp ${data.viewport.width})`);
    }
    for (const item of data.contrastIssues.slice(0, 8)) {
      console.log(
        `    ↳ contrast ${item.ratio}:1 (need ${item.required}) ${item.selector} ${item.fontSize}px — "${item.sample}"`,
      );
    }
    for (const item of data.smallTargets.slice(0, 8)) {
      console.log(
        `    ↳ target ${item.selector} ${item.width}×${item.height} (visual ${item.visualWidth}×${item.visualHeight})`,
      );
    }
  }

  console.log('\n' + '='.repeat(72));
  console.log(`screenshots + report.json -> ${outDir}`);

  /* --- Fonts, sticky header, robustness --- */
  const sample = report.viewports['desktop-1440'];
  if (sample) {
    console.log(`\nfonts: ${sample.fonts.families.join(', ') || '(none declared)'}`);
    console.log(
      `  available -> newsreader=${sample.fonts.available.newsreader} italic=${sample.fonts.available.newsreaderItalic} inter=${sample.fonts.available.inter} mono=${sample.fonts.available.jetbrainsMono}`,
    );
    if (sample.sticky) {
      console.log(`sticky header: position=${sample.sticky.position} top=${sample.sticky.topAfterScroll} stuck=${sample.sticky.isStuck} condensed=${sample.sticky.condensed}`);
    }
    console.log(
      `typography: body=${sample.typography.bodyFontSize}px/${sample.typography.bodyLineHeight}px family=${sample.typography.bodyFontFamily} measure=${sample.typography.measurePx}px`,
    );
    console.log(
      `enhancement: ${sample.enhancement.inViewport} reveal targets in viewport, ${sample.enhancement.revealed}/${sample.enhancement.dataReveal} revealed overall, ${sample.enhancement.stillInvisible} invisible-in-viewport, themeToggles=${sample.enhancement.themeToggle}, copyButtons=${sample.enhancement.copyButtons}, scripts=${sample.enhancement.scriptCount}`,
    );
    if (sample.viz) {
      console.log(
        `hero canvas: ${sample.viz.width}×${sample.viz.height} painted=${sample.viz.painted}/${sample.viz.sampled} (${((sample.viz.paintedRatio ?? 0) * 100).toFixed(1)}%)`,
      );
    }
    console.log(`headings: ${sample.headings.map((h) => `h${h.level}:${h.fontSize}`).join(' ')}`);
  }
  if (report.reducedMotion) {
    console.log(`reduced-motion: ${report.reducedMotion.stillHidden.length} still hidden, canvas painted=${report.reducedMotion.canvasPainted}`);
  }
  if (report.noJs) {
    console.log(`no-JS: ${report.noJs.chars} chars, ${report.noJs.sections} sections, ${report.noJs.hiddenByReveal} hidden`);
  }
  if (report.themeToggle) {
    const t = report.themeToggle;
    console.log(`theme toggle: ${t.before ?? 'system'} -> ${t.after ?? '?'} (bg ${t.bgBefore} -> ${t.bgAfter}, stored=${t.stored})`);
  }
  if (report.mobileDrawer) {
    const d = report.mobileDrawer;
    console.log(
      `mobile drawer: hidden=${d.initiallyHidden} opened=${d.openedHidden === false} expanded=${d.expanded} bodyOverflow="${d.bodyOverflow}" closedOnEsc=${d.closedAfterEscape}`,
    );
  }

  cdp.close();
}

main().catch((error) => {
  console.error('\naudit failed:', error.message);
  process.exit(1);
});
