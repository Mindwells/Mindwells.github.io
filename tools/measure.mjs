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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { connect, findPageTarget, navigate, sleep } from './cdp.mjs';

const PORT = process.env.PORT ?? '4321';
const CDP_PORT = process.env.CDP_PORT ?? '9222';
const BASE = `http://127.0.0.1:${PORT}`;
const outDir = resolve(fileURLToPath(new URL('../.audit', import.meta.url)));

/** Breakpoints to exercise. Chosen around the design's own breakpoints. */
const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 780 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1119', width: 1119, height: 820 },
  { name: 'laptop-1120', width: 1120, height: 820 },
  { name: 'desktop-1280', width: 1280, height: 900 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'wide-1920', width: 1920, height: 1080 },
];

/* -------------------------------------------------------------------------- */
/* In-page measurement                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Runs inside the page. Returns a plain object so it can cross the CDP
 * boundary by value.
 *
 * Exported so `tools/selftest.mjs` can run the very same measurements against
 * deliberately broken pages and prove each check actually fires.
 *
 * @param {{ touch?: boolean }} options
 */
export async function measurementScript(options = {}) {
  /*
   * Target size depends on the input. 44x44 is the touch guideline (Apple HIG,
   * WCAG 2.5.5); WCAG 2.5.8 sets 24x24 as the AA minimum and that is what
   * applies to a mouse. Enforcing 44 on a desktop viewport would flag controls
   * that are perfectly usable, and enforcing 24 on a phone would miss real
   * problems.
   */
  const minTarget = options.touch ? 44 : 24;
  const targetStandard = options.touch ? '44px (touch)' : '24px (pointer, WCAG 2.5.8 AA)';
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

  /* --- 0. Reveal state, then pin the page to fully revealed ---------------
     Reveal is scroll-driven, so whether an element is currently opaque
     depends on where the page happens to have been scrolled. Left in place,
     that makes every later check flaky: an unrevealed block reads as
     invisible, so contrast skips its text and overlap detection finds nothing.
     The evidence is captured first, then the page is pinned. */

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

  if (revealEls.length > 0) {
    const pin = document.createElement('style');
    pin.textContent = '[data-reveal]{transition:none !important;}';
    document.head.appendChild(pin);
    for (const el of revealEls) el.classList.add('is-revealed');
    await settle(60);
    pin.remove();
  }

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
      /*
       * Only the element itself or its descendants count.
       *
       * Including `t.contains(el)` — the element's *ancestors* — makes the
       * measured area grow to whatever container surrounds it, so a genuinely
       * 8x8 control reports a 61x61 hit area and passes.
       */
      return Boolean(t) && (t === el || el.contains(t));
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

    /*
     * WCAG 2.5.8 exempts links rendered *inline within a sentence*, because the
     * line height of surrounding prose sets their size.
     *
     * The exemption must require an inline display. Testing only for a `p`/`li`
     * ancestor wrongly exempted icons and social links that merely happen to be
     * list items — which is exactly how an 8x8 link slipped through here.
     */
    const isInlineInProse =
      el.tagName === 'A' &&
      style.display.startsWith('inline') &&
      Boolean(el.closest('p, dd, blockquote, .prose')) &&
      !el.closest('nav, .hero__links, .footer__social, .contact__links');
    if (isInlineInProse) continue;

    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < minTarget || h < minTarget) candidates.push({ el, w, h });
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
    if (effective.width < minTarget || effective.height < minTarget) {
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
     Sampled in section 0, before reveal state was pinned. */

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

  /* --- 11. Above-the-fold content ---
     A first screen should establish who this is and offer a way to act.
     Rects are measured against the document, so they are scroll-independent. */
  const scrollTop = window.scrollY;
  const docTop = (el) => (el ? Math.round(el.getBoundingClientRect().top + scrollTop) : null);
  const cta = document.querySelector('.button--primary');
  const firstScreen = {
    viewportHeight: window.innerHeight,
    titleTop: docTop(document.querySelector('h1')),
    titleBottom: (() => {
      const el = document.querySelector('h1');
      return el ? Math.round(el.getBoundingClientRect().bottom + scrollTop) : null;
    })(),
    ctaTop: docTop(cta),
    ctaWithinFirstScreen: cta ? docTop(cta) < window.innerHeight : null,
  };

  /* --- 12. Accessibility structure ---
     Things a screen reader or keyboard user hits immediately, and which no
     amount of visual polish compensates for. */
  const allHeadings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
    level: Number(h.tagName[1]),
    text: (h.textContent ?? '').trim().slice(0, 40),
  }));
  const headingSkips = [];
  for (let i = 1; i < allHeadings.length; i++) {
    if (allHeadings[i].level > allHeadings[i - 1].level + 1) {
      headingSkips.push(`h${allHeadings[i - 1].level} -> h${allHeadings[i].level} at "${allHeadings[i].text}"`);
    }
  }

  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
  const duplicateIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];

  const namelessControls = [...document.querySelectorAll('a[href], button')]
    .filter((el) => {
      const hasText = (el.textContent ?? '').trim().length > 0;
      const hasAria = Boolean(el.getAttribute('aria-label') ?? el.getAttribute('aria-labelledby'));
      const hasTitle = Boolean(el.getAttribute('title'));
      const imgAlt = el.querySelector('img[alt]')?.getAttribute('alt');
      return !hasText && !hasAria && !hasTitle && !Boolean(imgAlt);
    })
    .map((el) => el.outerHTML.slice(0, 70));

  const a11y = {
    htmlLang: document.documentElement.getAttribute('lang'),
    h1Count: document.querySelectorAll('h1').length,
    headingSkips,
    landmarks: {
      header: document.querySelectorAll('header').length,
      main: document.querySelectorAll('main').length,
      footer: document.querySelectorAll('footer').length,
      nav: document.querySelectorAll('nav').length,
    },
    imagesWithoutAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
    namelessControls,
    duplicateIds,
    brokenAnchors: [...document.querySelectorAll('a[href^="#"]')]
      .map((a) => (a.getAttribute('href') ?? '').slice(1))
      .filter((fragment, i, arr) => fragment && !document.getElementById(fragment) && arr.indexOf(fragment) === i),
    skipLink: (() => {
      const link = document.querySelector('.skip-link');
      if (!link) return null;
      return {
        exists: true,
        target: link.getAttribute('href'),
        targetExists: Boolean(document.getElementById((link.getAttribute('href') ?? '').slice(1))),
      };
    })(),
  };

  /* --- 13. Left-edge alignment ---
     The design rule: a section heading sits on the container's content edge,
     and the section index hangs outside it.

     The edge is taken from the first line box via a Range, not from the
     element's border box: padding moves the text without moving the box, and a
     border-box measurement would call that aligned.

     Comparing headings against *every* child element was too blunt — list
     bleed margins and timeline columns are deliberately indented, so the
     comparison reported drift where none exists. Comparing against the
     container's content edge states the rule exactly. */
  const textLeft = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    if (rects.length === 0) return null;
    return Math.round(Math.min(...rects.map((r) => r.left)));
  };
  const uniqueLefts = (values) => [...new Set(values.filter((v) => v !== null))];

  const containers = [...document.querySelectorAll('section[id] > .container')];
  const alignment = {
    container: uniqueLefts(containers.map((el) => Math.round(el.getBoundingClientRect().left))),
    containerContent: uniqueLefts(
      containers.map((el) =>
        Math.round(el.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(el).paddingLeft)),
      ),
    ),
    title: uniqueLefts([...document.querySelectorAll('.section-header__title')].map(textLeft)),
    index: uniqueLefts([...document.querySelectorAll('.section-header__index')].map(textLeft)),
  };

  /* --- 14. Reading measure ---
     Characters per line is the most reliable predictor of whether prose is
     comfortable to read, and a `max-width` in rem only approximates it. This
     counts real line boxes instead of trusting the declared width.

     Line count comes from the distinct `top` values of the range rects, not
     from the rect count: a paragraph containing <strong> produces one rect
     per inline fragment, which would otherwise inflate the line count. */
  const measureBlocks = [];
  for (const el of document.querySelectorAll('p, li, dd, blockquote')) {
    const text = (el.textContent ?? '').trim();
    if (text.length < 90) continue;
    if (!isVisible(el)) continue;
    // Skip containers: a list item wrapping a card holds several child blocks,
    // so its text-to-line ratio says nothing about reading width.
    if (el.querySelector('p, div, ul, ol, li, h1, h2, h3, h4, blockquote')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) continue;

    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    if (rects.length === 0) continue;

    const lines = new Set(rects.map((r) => Math.round(r.top))).size;
    if (lines < 2) continue;

    measureBlocks.push({
      selector: describe(el),
      width: Math.round(rect.width),
      lines,
      chars: text.length,
      charsPerLine: Math.round(text.length / lines),
      sample: text.slice(0, 38),
    });
  }
  const readingMeasure = {
    blocks: measureBlocks,
    tooWide: measureBlocks.filter((b) => b.charsPerLine > 80),
    tooNarrow: measureBlocks.filter((b) => b.charsPerLine < 30),
  };

  /* --- 15. Clipped and overlapping content ---
     Two layout defects that are invisible to every other check here: text cut
     off by an overflow container, and interactive controls sitting on top of
     each other. Both are obvious to a human eye and invisible to a stylesheet. */
  const clipped = [];
  for (const el of document.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.overflow !== 'hidden' && style.overflow !== 'clip') continue;
    if (style.position === 'absolute' || style.position === 'fixed') continue;
    if (!isVisible(el)) continue;
    // Only containers that actually hold text of their own.
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    if (ownText.length === 0) continue;
    const overflowsY = el.scrollHeight - el.clientHeight;
    const overflowsX = el.scrollWidth - el.clientWidth;
    if (overflowsY > 4 || overflowsX > 4) {
      clipped.push({
        selector: describe(el),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        sample: ownText.slice(0, 34),
      });
    }
  }

  const controls = [...document.querySelectorAll('a[href], button, [role="button"]')]
    .filter((el) => isVisible(el))
    .map((el) => ({ el, rect: el.getBoundingClientRect(), label: describe(el) }))
    .filter((c) => c.rect.width > 0 && c.rect.height > 0);

  const overlaps = [];
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i];
      const b = controls[j];
      // Ignore nesting (a link inside a card that is itself a link target).
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (x > 2 && y > 2) {
        overlaps.push({ a: a.label, b: b.label, overlapX: Math.round(x), overlapY: Math.round(y) });
      }
    }
  }

  const layoutDefects = { clipped, overlappingControls: overlaps.slice(0, 10), overlapCount: overlaps.length };

  return {
    viewport: { width: viewportWidth, height: viewportHeight },
    documentWidth: document.documentElement.scrollWidth,
    horizontalOverflow: overflow,
    contrastIssues,
    contrastChecked,
    smallTargets,
    targetStandard,
    minTarget,
    fonts,
    sticky,
    rhythm,
    headings,
    typography,
    performance: performance_,
    images,
    enhancement,
    viz,
    firstScreen,
    a11y,
    alignment,
    readingMeasure,
    layoutDefects,
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
    expression: `(${measurementScript.toString()})(${JSON.stringify({ touch: viewport.width < 768 })})`,
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

  const target = await findPageTarget(CDP_PORT);
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

  /*
   * The theme toggle writes the reader's choice to localStorage, which makes
   * it survive across navigations *and across audit runs*. Without this reset,
   * clicking the toggle once left the browser in dark mode and every later run
   * silently measured the dark theme while reporting it as light.
   *
   * Runs at document start, before the page's own inline theme script reads
   * storage, so each pass starts from the emulated colour scheme.
   */
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.removeItem('theme'); } catch (e) {}`,
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
    if (data.a11y) {
      if (data.a11y.h1Count !== 1) flags.push(`h1-count:${data.a11y.h1Count}`);
      if (data.a11y.headingSkips.length) flags.push(`heading-skip:${data.a11y.headingSkips[0]}`);
      if (data.a11y.namelessControls.length) flags.push(`nameless-controls:${data.a11y.namelessControls.length}`);
      if (data.a11y.duplicateIds.length) flags.push(`duplicate-ids:${data.a11y.duplicateIds.join(',')}`);
      if (data.a11y.brokenAnchors.length) flags.push(`broken-anchors:${data.a11y.brokenAnchors.join(',')}`);
      if (data.a11y.imagesWithoutAlt) flags.push(`img-no-alt:${data.a11y.imagesWithoutAlt}`);
      if (data.a11y.landmarks.main !== 1) flags.push(`main-landmarks:${data.a11y.landmarks.main}`);
    }
    if (data.readingMeasure?.tooWide.length) {
      flags.push(
        `measure>80ch:${data.readingMeasure.tooWide.map((b) => `${b.selector}=${b.charsPerLine}`).join(',')}`,
      );
    }
    if (data.layoutDefects?.clipped.length) {
      flags.push(`CLIPPED:${data.layoutDefects.clipped.map((c) => c.selector).join(',')}`);
    }
    if (data.layoutDefects?.overlapCount) {
      flags.push(`OVERLAP:${data.layoutDefects.overlapCount}`);
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

  /* --- 4b. Focus must not escape the open drawer ---
     The drawer covers the page, so tabbing out of it moves focus to content
     the reader cannot see. Drive real Tab keys with the drawer open and check
     that focus stays inside. */
  process.stdout.write('checking drawer focus containment … ');
  {
    await navigate(cdp, BASE, 900);

    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('[data-menu-toggle]').click()`,
      returnByValue: true,
    });
    await sleep(450);

    const pressTab = async (shift = false) => {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await cdp.send('Input.dispatchKeyEvent', {
          type,
          key: 'Tab',
          code: 'Tab',
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
          modifiers: shift ? 8 : 0,
        });
      }
      await sleep(110);
    };

    const readFocus = async () =>
      (
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const el = document.activeElement;
            const drawer = document.querySelector('[data-drawer]');
            const toggle = document.querySelector('[data-menu-toggle]');
            if (!el || el === document.body) return { inside: false, label: '(body)' };
            return {
              // The close control lives in the header bar, which stays visible
              // above the drawer, so it is part of the dialog interaction.
              inside: drawer.contains(el) || el === toggle,
              label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40),
              tag: el.tagName.toLowerCase(),
            };
          })()`,
          returnByValue: true,
        })
      ).result.value;

    const stops = [];
    for (let i = 0; i < 12; i++) {
      await pressTab();
      stops.push({ ...(await readFocus()), direction: 'forward' });
    }
    // Backwards tabbing must wrap too, not fall out of the top of the drawer.
    for (let i = 0; i < 12; i++) {
      await pressTab(true);
      stops.push({ ...(await readFocus()), direction: 'backward' });
    }

    const escaped = stops.filter((s) => !s.inside);
    report.drawerFocus = {
      stops: stops.length,
      forward: stops.filter((s) => s.direction === 'forward').length,
      backward: stops.filter((s) => s.direction === 'backward').length,
      escapedCount: escaped.length,
      escapedTo: escaped.slice(0, 4).map((s) => `${s.label} (${s.direction})`),
      visited: [...new Set(stops.map((s) => s.label))],
    };
    console.log(escaped.length === 0 ? 'clean' : `ESCAPED:${escaped.length} -> ${escaped.slice(0, 3).map((s) => `${s.label}/${s.direction}`).join(' | ')}`);

    // Close the drawer again so subsequent passes start from a clean state.
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);
  }

  /* --- 5. Keyboard: focus is reachable and visibly indicated ---
     `:focus-visible` only matches after real keyboard interaction, so this
     drives an actual Tab key through CDP rather than calling .focus(). */
  process.stdout.write('checking keyboard focus … ');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: BASE });
    await loaded;
    await sleep(900);

    const pressTab = async () => {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await cdp.send('Input.dispatchKeyEvent', {
          type,
          key: 'Tab',
          code: 'Tab',
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
        });
      }
      await sleep(120);
    };

    const sample = async () =>
      (
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const style = getComputedStyle(el);
            const skip = document.querySelector('.skip-link');
            return {
              tag: el.tagName.toLowerCase(),
              label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 44),
              outlineWidth: style.outlineWidth,
              outlineStyle: style.outlineStyle,
              hasVisibleFocus:
                style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0,
              skipLinkVisible: skip
                ? Math.abs(skip.getBoundingClientRect().top) < skip.getBoundingClientRect().height + 4
                : null,
            };
          })()`,
          returnByValue: true,
        })
      ).result.value;

    const stops = [];
    for (let i = 0; i < 6; i++) {
      await pressTab();
      const s = await sample();
      if (s) stops.push(s);
    }

    const withFocusRing = stops.filter((s) => s.hasVisibleFocus).length;
    report.keyboard = {
      stops,
      stopsWithFocusRing: withFocusRing,
      firstIsSkipLink: stops[0]?.skipLinkVisible === true,
    };
    const ok = stops.length > 0 && withFocusRing === stops.length;
    console.log(ok ? 'clean' : `PROBLEM (${withFocusRing}/${stops.length} have a focus ring)`);
  }

  /* --- 6. Runtime cost ---
     Long tasks are the meaningful signal here: headless frame rates are not
     representative, but main-thread blocking is. */
  process.stdout.write('checking runtime cost … ');
  {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: BASE });
    await loaded;
    await sleep(1200);

    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const longTasks = [];
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) longTasks.push(Math.round(e.duration));
          }).observe({ type: 'longtask', buffered: false });
        } catch (err) {}

        // Scroll the whole document, as a reader would.
        const behavior = document.documentElement.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = 'auto';
        const total = document.documentElement.scrollHeight - window.innerHeight;
        for (let i = 0; i <= 60; i++) {
          window.scrollTo(0, (total * i) / 60);
          await new Promise((r) => setTimeout(r, 16));
        }
        await new Promise((r) => setTimeout(r, 400));

        // Confirm the hero canvas pauses when off screen and resumes when
        // back in view. The signature must cover the whole canvas: the
        // visualisation is concentrated right-of-centre, so sampling one
        // corner would report "no change" even while it animates.
        const canvas = document.querySelector('[data-viz-canvas]');
        const signature = () => {
          if (!canvas || !canvas.width) return null;
          const ctx = canvas.getContext('2d');
          const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let sum = 0;
          for (let i = 3; i < d.length; i += 997) sum += d[i];
          return sum;
        };
        const paused1 = signature();
        await new Promise((r) => setTimeout(r, 700));
        const paused2 = signature();

        window.scrollTo(0, 0);
        document.documentElement.style.scrollBehavior = behavior;
        await new Promise((r) => setTimeout(r, 500));
        const running1 = signature();
        await new Promise((r) => setTimeout(r, 600));
        const running2 = signature();

        return {
          longTasks,
          worstLongTask: longTasks.length ? Math.max(...longTasks) : 0,
          totalBlocking: longTasks.reduce((a, b) => a + b, 0),
          canvasPausedOffscreen: paused1 !== null && paused1 === paused2,
          canvasRunningOnscreen: running1 !== null && running1 !== running2,
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    report.runtime = result.value;
    const r = result.value;
    const ok = r.worstLongTask < 120 && r.canvasPausedOffscreen && r.canvasRunningOnscreen;
    console.log(
      ok
        ? 'clean'
        : `PROBLEM (worst=${r.worstLongTask}ms paused=${r.canvasPausedOffscreen} running=${r.canvasRunningOnscreen})`,
    );
  }

  /* --- 7. Print rendering ---
     People do print academic homepages. Verify the screen chrome is gone,
     nothing is left hidden by scroll-reveal, and the palette drops to ink. */
  process.stdout.write('checking print styles … ');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 794, height: 1123, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setEmulatedMedia', { media: 'print', features: [] });
  {
    await navigate(cdp, BASE, 900);
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const visible = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          return getComputedStyle(el).display !== 'none';
        };
        const hidden = [...document.querySelectorAll('[data-reveal]')]
          .filter((el) => Number.parseFloat(getComputedStyle(el).opacity) < 0.9).length;
        return {
          headerVisible: visible('[data-header]'),
          vizVisible: visible('[data-viz]'),
          buttonsVisible: visible('.button'),
          bodyBg: getComputedStyle(document.body).backgroundColor,
          bodyColor: getComputedStyle(document.body).color,
          hiddenReveals: hidden,
          chars: (document.body.innerText || '').trim().length,
        };
      })()`,
      returnByValue: true,
    });
    report.print = result.value;

    const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 794, height: Math.min(Math.ceil(cssContentSize.height), 12000), scale: 1 },
    });
    writeFileSync(join(outDir, 'print.png'), Buffer.from(shot.data, 'base64'));

    const p = result.value;
    const ok =
      p.headerVisible === false &&
      p.vizVisible === false &&
      p.hiddenReveals === 0 &&
      p.bodyBg === 'rgb(255, 255, 255)' &&
      p.bodyColor === 'rgb(0, 0, 0)';
    console.log(ok ? 'clean' : `PROBLEM (header=${p.headerVisible} viz=${p.vizVisible} hidden=${p.hiddenReveals} bg=${p.bodyBg})`);
  }
  await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [] });

  /* --- 8. Hover micro-interactions actually fire ---
     Hover styles are easy to write and easy to get wrong. This dispatches a
     real pointer move over each control and compares the computed styles
     before and after, so a dead hover state fails the audit. */
  process.stdout.write('checking hover states … ');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [] });
  {
    await navigate(cdp, BASE, 1200);

    const readStyle = (selector, pseudo = null) =>
      cdp
        .send('Runtime.evaluate', {
          expression: `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            const s = getComputedStyle(el${pseudo ? `, ${JSON.stringify(pseudo)}` : ''});
            const r = el.getBoundingClientRect();
            return {
              color: s.color,
              background: s.backgroundColor,
              borderColor: s.borderColor,
              transform: s.transform,
              textDecorationColor: s.textDecorationColor,
              opacity: s.opacity,
              x: Math.round(r.left + r.width / 2),
              y: Math.round(r.top + r.height / 2),
            };
          })()`,
          returnByValue: true,
        })
        .then((r) => r.result.value);

    const hover = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
      await sleep(500);
    };
    const unhover = async () => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400, buttons: 0 });
      await sleep(350);
    };

    const targets = [
      { name: 'nav link', selector: '[data-nav-link]', pseudo: '::after' },
      { name: 'primary button', selector: '.button--primary', pseudo: null },
      { name: 'theme toggle', selector: '[data-theme-toggle]', pseudo: '::after' },
    ];

    const results = [];
    for (const t of targets) {
      await unhover();
      const before = await readStyle(t.selector, t.pseudo);
      if (!before) {
        results.push({ name: t.name, present: false });
        continue;
      }
      await hover(before.x, before.y);
      const after = await readStyle(t.selector, t.pseudo);
      const changed = ['color', 'background', 'borderColor', 'transform', 'textDecorationColor', 'opacity'].filter(
        (k) => before[k] !== after[k],
      );
      results.push({
        name: t.name,
        present: true,
        changedProperties: changed,
        responded: changed.length > 0,
        before: { color: before.color, background: before.background, transform: before.transform },
        after: { color: after.color, background: after.background, transform: after.transform },
      });
    }
    await unhover();

    report.hover = results;
    const dead = results.filter((r) => r.present && !r.responded);
    console.log(dead.length === 0 ? 'clean' : `DEAD:${dead.map((d) => d.name).join(',')}`);
  }

  /* --- 9. Anchor offsets ---
     A sticky header is the classic way to hide the very content a nav link
     points at. Each section must land clear of the header after navigating. */
  process.stdout.write('checking anchor offsets … ');
  {
    await navigate(cdp, BASE, 1000);
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        document.documentElement.style.scrollBehavior = 'auto';
        const header = document.querySelector('[data-header]');
        const headerH = header ? header.getBoundingClientRect().height : 0;
        const ids = [...document.querySelectorAll('section[id]')].map((s) => s.id);
        const out = [];
        for (const id of ids) {
          location.hash = '#' + id;
          await new Promise((r) => setTimeout(r, 220));
          const el = document.getElementById(id);
          if (!el) continue;
          const top = el.getBoundingClientRect().top;
          out.push({
            id,
            topAfterJump: Math.round(top),
            headerHeight: Math.round(headerH),
            // Allow a small tolerance for sub-pixel rounding.
            clearsHeader: top >= headerH - 2,
          });
        }
        history.replaceState(null, '', location.pathname + location.search);
        document.documentElement.style.scrollBehavior = '';
        window.scrollTo(0, 0);
        return { headerHeight: Math.round(headerH), sections: out };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    report.anchors = result.value;
    const bad = result.value.sections.filter((s) => !s.clearsHeader);
    console.log(bad.length === 0 ? 'clean' : `HIDDEN:${bad.map((b) => `${b.id}@${b.topAfterJump}`).join(',')}`);
  }

  /* --- 10. Hero responds to the pointer ---
     The visualisation treats the pointer as a query. Verify it actually
     reacts, and that it does so without blocking the controls layered above
     it (the canvas must stay pointer-events: none). */
  process.stdout.write('checking hero pointer response … ');
  {
    await navigate(cdp, BASE, 1800);

    const signature = () =>
      cdp
        .send('Runtime.evaluate', {
          expression: `(() => {
            const c = document.querySelector('[data-viz-canvas]');
            if (!c || !c.width) return null;
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let sum = 0;
            for (let i = 3; i < d.length; i += 997) sum += d[i];
            return sum;
          })()`,
          returnByValue: true,
        })
        .then((r) => r.result.value);

    // Sample at the same animation phase to isolate the pointer's effect from
    // the idle cycle: compare frames a full cycle apart with and without a
    // pointer, then compare the *difference* magnitudes.
    const sampleDelta = async (withPointer) => {
      const box = (
        await cdp.send('Runtime.evaluate', {
          expression: `(() => { const r = document.querySelector('[data-viz]').getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.4 }; })()`,
          returnByValue: true,
        })
      ).result.value;

      const a = await signature();
      if (withPointer) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(box.x), y: Math.round(box.y), buttons: 0 });
      } else {
        // Park the pointer well outside the hero.
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, buttons: 0 });
      }
      await sleep(900);
      const b = await signature();
      return { a, b, changed: a !== b };
    };

    const withoutPointer = await sampleDelta(false);
    const withPointer = await sampleDelta(true);

    // Capture the hero with the pointer parked over it, as a visual record of
    // the interaction for human review.
    {
      const box = (
        await cdp.send('Runtime.evaluate', {
          expression: `(() => { const r = document.querySelector('[data-viz]').getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.34), y: Math.round(r.top + r.height * 0.42) }; })()`,
          returnByValue: true,
        })
      ).result.value;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 });
      await sleep(1100);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, 'hero-pointer.png'), Buffer.from(shot.data, 'base64'));
    }

    // Confirm the canvas does not intercept clicks over the hero controls.
    const hitTest = (
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const cta = document.querySelector('.button--primary');
          if (!cta) return null;
          const r = cta.getBoundingClientRect();
          const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
          return { topElement: top ? top.tagName.toLowerCase() + '.' + String(top.className || '').split(' ')[0] : null, ctaReachable: cta.contains(top) || top === cta };
        })()`,
        returnByValue: true,
      })
    ).result.value;

    report.heroPointer = {
      animatedWithoutPointer: withoutPointer.changed,
      animatedWithPointer: withPointer.changed,
      canvasPointerEvents: (
        await cdp.send('Runtime.evaluate', {
          expression: `getComputedStyle(document.querySelector('[data-viz]')).pointerEvents`,
          returnByValue: true,
        })
      ).result.value,
      ctaHitTest: hitTest,
    };

    const p = report.heroPointer;
    const ok = p.animatedWithPointer && p.canvasPointerEvents === 'none' && p.ctaHitTest?.ctaReachable === true;
    console.log(ok ? 'clean' : `PROBLEM (animating=${p.animatedWithPointer} pointerEvents=${p.canvasPointerEvents} ctaReachable=${p.ctaHitTest?.ctaReachable})`);
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
    if (data.firstScreen) {
      const f = data.firstScreen;
      const fold = f.ctaWithinFirstScreen === false ? '  <-- CTA BELOW FOLD' : '';
      console.log(`  first screen: h1 ends ${f.titleBottom}px, CTA ${f.ctaTop}px / vp ${f.viewportHeight}px${fold}`);
    }

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
  if (sample?.a11y) {
    const a = sample.a11y;
    console.log(
      `a11y: lang=${a.htmlLang} h1=${a.h1Count} headingSkips=${a.headingSkips.length} landmarks(h/m/f/nav)=${a.landmarks.header}/${a.landmarks.main}/${a.landmarks.footer}/${a.landmarks.nav} namelessControls=${a.namelessControls.length} dupIds=${a.duplicateIds.length} brokenAnchors=${a.brokenAnchors.length} skipLink=${a.skipLink?.target}->${a.skipLink?.targetExists}`,
    );
  }
  if (report.keyboard) {
    console.log(
      `keyboard: ${report.keyboard.stopsWithFocusRing}/${report.keyboard.stops.length} tab stops show a focus ring; first stop is skip link = ${report.keyboard.firstIsSkipLink}`,
    );
    for (const s of report.keyboard.stops.slice(0, 4)) {
      console.log(`  ↳ ${s.tag} "${s.label}" outline=${s.outlineWidth} ${s.outlineStyle}`);
    }
  }
  if (report.runtime) {
    const r = report.runtime;
    console.log(
      `runtime: worst long task ${r.worstLongTask}ms, total blocking ${r.totalBlocking}ms, ${r.longTasks.length} long tasks; canvas paused off-screen=${r.canvasPausedOffscreen} running on-screen=${r.canvasRunningOnscreen}`,
    );
  }
  if (sample?.alignment) {
    const a = sample.alignment;
    const aligned =
      a.title.length === 1 && a.containerContent.length === 1 && a.title[0] === a.containerContent[0];
    console.log(
      `alignment: container=${a.container.join(',')} contentEdge=${a.containerContent.join(',')} index=${a.index.join(',')} title=${a.title.join(',')}  ${aligned ? '(headings sit on the content edge, index hangs outside)' : '<-- HEADING/CONTENT EDGE MISMATCH'}`,
    );
  }
  if (report.print) {
    const p = report.print;
    console.log(
      `print: header=${p.headerVisible} viz=${p.vizVisible} buttons=${p.buttonsVisible} hiddenReveals=${p.hiddenReveals} bg=${p.bodyBg} color=${p.bodyColor} chars=${p.chars}`,
    );
  }
  if (sample?.readingMeasure) {
    const rm = sample.readingMeasure;
    console.log(
      `reading measure (desktop-1440): ${rm.blocks.length} prose blocks, ${rm.tooWide.length} over 80ch, ${rm.tooNarrow.length} under 30ch`,
    );
    for (const b of [...rm.blocks].sort((x, y) => y.charsPerLine - x.charsPerLine).slice(0, 5)) {
      const flag = b.charsPerLine > 80 ? '  <-- TOO WIDE' : '';
      console.log(
        `  ${String(b.charsPerLine).padStart(3)} ch  ${String(b.width).padStart(4)}px  ${b.lines} lines  ${b.selector}${flag}`,
      );
    }
  }
  if (report.hover) {
    console.log('hover states:');
    for (const h of report.hover) {
      console.log(
        h.present === false
          ? `  ${h.name}: not present`
          : `  ${h.name}: ${h.responded ? `changed ${h.changedProperties.join(', ')}` : 'NO RESPONSE'}`,
      );
    }
  }
  if (report.anchors) {
    const bad = report.anchors.sections.filter((s) => !s.clearsHeader);
    console.log(
      `anchors: ${report.anchors.sections.length} sections, header ${report.anchors.headerHeight}px, ${bad.length} landing under the header${bad.length ? ` -> ${bad.map((b) => b.id).join(', ')}` : ''}`,
    );
  }
  if (report.heroPointer) {
    const h = report.heroPointer;
    console.log(
      `hero pointer: pointer-events=${h.canvasPointerEvents}, canvas animating=${h.animatedWithPointer}, CTA reachable through the canvas=${h.ctaHitTest?.ctaReachable} (top element ${h.ctaHitTest?.topElement})`,
    );
  }
  if (sample?.layoutDefects) {
    const l = sample.layoutDefects;
    console.log(`layout defects: ${l.clipped.length} clipped text container(s), ${l.overlapCount} overlapping control pair(s)`);
    for (const c of l.clipped) {
      console.log(`  clipped ${c.selector} scrollH=${c.scrollHeight} clientH=${c.clientHeight} — "${c.sample}"`);
    }
    for (const o of l.overlappingControls) {
      console.log(`  overlap ${o.a} / ${o.b} by ${o.overlapX}x${o.overlapY}px`);
    }
  }

  cdp.close();
}

// Only run the audit when this file is the entry point; `selftest.mjs`
// imports the measurement function without triggering a full run.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error('\naudit failed:', error.message);
    process.exit(1);
  });
}
