/**
 * Self-test for the design audit.
 *
 * A check that has never failed is not evidence that anything passed. This
 * deliberately breaks a page in one specific way at a time, runs the *same*
 * measurement code the audit uses, and asserts that the matching check fires.
 *
 * Faults are injected at runtime with `!important` rather than by editing
 * source files. That matters: Astro scopes component styles with an
 * attribute selector, so a plain class rule added to a stylesheet loses to
 * the component's own rule and the "fault" never reaches the page — which
 * makes the test pass for the wrong reason.
 *
 *   node tools/selftest.mjs
 *
 * Requires the static server and a headless browser with remote debugging.
 */

import { connect, findPageTarget, navigate, sleep } from './cdp.mjs';
import { measurementScript } from './measure.mjs';

const BASE = `http://127.0.0.1:${process.env.PORT ?? '4321'}`;

/**
 * Each case injects `setup` (CSS and/or DOM work) and asserts `expect` against
 * the measurement result. `name` is what the audit reports for that check.
 */
const CASES = [
  {
    name: 'contrast',
    setup: `addStyle('.about__text, .about__lede { color: #bbbbbb !important; }')`,
    expect: (m) => m.contrastIssues.length > 0,
    detail: (m) => `${m.contrastIssues.length} contrast failures`,
  },
  {
    name: 'tap targets',
    setup: `addStyle('.hero__link { width: 8px !important; height: 8px !important; }')`,
    expect: (m) => m.smallTargets.length > 0,
    detail: (m) => `${m.smallTargets.length} undersized targets`,
  },
  {
    name: 'horizontal overflow',
    // `width` alone is clamped by the container's own max-width, so the fault
    // has to override the limiting property.
    setup: `addStyle('.container { max-width: 160vw !important; width: 160vw !important; }')`,
    expect: (m) => m.horizontalOverflow.length > 0,
    detail: (m) => `${m.horizontalOverflow.length} overflowing elements`,
  },
  {
    name: 'clipped text',
    setup: `addStyle('.about__text { height: 20px !important; overflow: hidden !important; }')`,
    expect: (m) => m.layoutDefects.clipped.length > 0,
    detail: (m) => `${m.layoutDefects.clipped.length} clipped`,
  },
  {
    name: 'overlapping controls',
    setup: `addStyle('.hero__actions { position: relative !important; } .hero__actions .button--ghost { position: absolute !important; left: 0 !important; top: 0 !important; }')`,
    expect: (m) => m.layoutDefects.overlapCount > 0,
    detail: (m) => `${m.layoutDefects.overlapCount} overlaps`,
  },
  {
    name: 'heading/content alignment',
    setup: `addStyle('.section-header__title { padding-left: 30px !important; }')`,
    expect: (m) =>
      m.alignment.title.length !== 1 || m.alignment.title[0] !== m.alignment.containerContent[0],
    detail: (m) => `title=${m.alignment.title} contentEdge=${m.alignment.containerContent}`,
  },
  {
    name: 'reading measure',
    setup: `addStyle('.about .col-main { grid-column: 1 / -1 !important; } .about__text { max-width: 120rem !important; }')`,
    expect: (m) => m.readingMeasure.tooWide.length > 0,
    detail: (m) => `widest=${Math.max(0, ...m.readingMeasure.blocks.map((b) => b.charsPerLine))}ch`,
  },
  {
    name: 'first-screen CTA',
    setup: `addStyle('.hero { min-height: 200vh !important; }')`,
    expect: (m) => m.firstScreen.ctaWithinFirstScreen === false,
    detail: (m) => `CTA top ${m.firstScreen.ctaTop}px of ${m.firstScreen.viewportHeight}px`,
  },
  {
    name: 'reveal wiring',
    setup: `addStyle('.js [data-reveal] { opacity: 0 !important; }')`,
    expect: (m) => m.enhancement.stillInvisible > 0,
    detail: (m) => `${m.enhancement.stillInvisible} invisible in viewport`,
  },
  {
    name: 'hero canvas painted',
    // `display: none` does not blank a canvas: the backing store keeps its
    // last frame and keeps reporting width/height. Removing it is the fault
    // that actually produces a missing canvas.
    setup: `(() => { document.querySelector('[data-viz-canvas]')?.remove(); })()`,
    expect: (m) => Boolean(m.viz?.error) || m.viz?.painted === 0,
    detail: (m) => `viz=${m.viz?.error ?? `${m.viz?.painted} painted`}`,
  },
  {
    name: 'single h1',
    setup: `(() => { const h = document.createElement('h1'); h.textContent = 'Second heading'; document.querySelector('main').appendChild(h); })()`,
    expect: (m) => m.a11y.h1Count !== 1,
    detail: (m) => `h1 count = ${m.a11y.h1Count}`,
  },
  {
    name: 'broken anchors',
    setup: `(() => { const a = document.createElement('a'); a.href = '#does-not-exist'; a.textContent = 'broken'; document.querySelector('main').appendChild(a); })()`,
    expect: (m) => m.a11y.brokenAnchors.includes('does-not-exist'),
    detail: (m) => `broken: ${m.a11y.brokenAnchors.join(', ') || 'none'}`,
  },
  {
    name: 'accessible names',
    setup: `(() => { const b = document.createElement('button'); b.type = 'button'; document.querySelector('main').appendChild(b); })()`,
    expect: (m) => m.a11y.namelessControls.length > 0,
    detail: (m) => `${m.a11y.namelessControls.length} nameless controls`,
  },
];

const HELPERS = `
  /*
   * Injected faults must take effect immediately.
   *
   * Injecting onto an already-revealed page otherwise *transitions* toward the
   * faulted value, so an element sits at opacity 0.4 for most of a second and
   * a visibility check correctly reports it as visible — the test would be
   * measuring the animation, not the fault.
   */
  window.addStyle = (css) => {
    const el = document.createElement('style');
    el.textContent = css + '\\n*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(el);
  };
`;

async function measure(cdp, options = { touch: false }) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression: `(${measurementScript.toString()})(${JSON.stringify(options)})`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'measurement threw');
  return result.value;
}

async function main() {
  const target = await findPageTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // Faults must be judged against the light theme, so a theme choice left in
  // storage by an earlier run cannot flip the page underneath the test.
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.removeItem('theme'); } catch (e) {}`,
  });

  const results = [];

  for (const testCase of CASES) {
    process.stdout.write(`  ${testCase.name.padEnd(30)} `);
    await navigate(cdp, BASE, 1300);
    await cdp.send('Runtime.evaluate', { expression: HELPERS, returnByValue: true });
    await cdp.send('Runtime.evaluate', { expression: testCase.setup, returnByValue: true });
    await sleep(350);

    let detected = false;
    let note = '';
    try {
      const m = await measure(cdp);
      detected = Boolean(testCase.expect(m));
      note = testCase.detail(m);
    } catch (error) {
      note = `threw: ${error.message}`;
    }

    results.push({ name: testCase.name, detected, note });
    console.log(detected ? `detected (${note})` : `NOT DETECTED  <-- check is blind (${note})`);
  }

  const blind = results.filter((r) => !r.detected);
  console.log('');
  console.log(`self-test: ${results.length - blind.length}/${results.length} checks proved to fire`);

  if (blind.length > 0) {
    console.error('blind checks:');
    for (const b of blind) console.error(`  ${b.name} — ${b.note}`);
  }

  cdp.close();
  process.exit(blind.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nself-test failed:', error.message);
  process.exit(1);
});
