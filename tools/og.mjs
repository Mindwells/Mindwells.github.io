/**
 * Generates the Open Graph / social preview image.
 *
 * Rather than compositing a card in an image library — which would need the
 * fonts converted out of WOFF2 and would drift from the real design — this
 * renders the actual homepage in headless Edge and captures it. The preview
 * therefore always matches the live hero, typography and visualisation.
 *
 *   node tools/og.mjs
 *
 * Requires the static server and a headless browser with remote debugging:
 *   node tools/serve.mjs &
 *   msedge --headless=new --remote-debugging-port=9222 \
 *          --user-data-dir=.audit/edge about:blank &
 *
 * Output: public/images/og.png (1200x630, the size social platforms expect).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { connect, evaluate, findPageTarget, navigate, sleep } from './cdp.mjs';

const BASE = `http://127.0.0.1:${process.env.PORT ?? '4321'}`;
const outFile = resolve(fileURLToPath(new URL('../public/images/og.png', import.meta.url)));

// The canonical social card size.
const WIDTH = 1200;
const HEIGHT = 630;

async function main() {
  mkdirSync(dirname(outFile), { recursive: true });

  const target = await findPageTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // Always capture the light theme: a preview card should be legible in any
  // feed, and dark cards disappear against dark client backgrounds.
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });

  await navigate(cdp, BASE, 1500);

  // The hero visualisation gathers evidence on a ~11s cycle. Wait for the
  // converged phase so the card shows the motif at its most legible rather
  // than a scattered opening frame.
  await sleep(4200);

  // Reveal animations are scroll-driven; make sure nothing in the hero is
  // still pending before capturing.
  await evaluate(
    cdp,
    `document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-revealed'))`,
  );
  await sleep(1100);

  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
  });

  const buffer = Buffer.from(shot.data, 'base64');
  writeFileSync(outFile, buffer);

  // A solid-colour 1200x630 PNG compresses to a few KB; real type and graphics
  // do not. This catches a blank or all-one-colour capture.
  const kb = Math.round(buffer.length / 1024);
  if (buffer.length < 20_000) {
    console.warn(`warning: ${kb}KB is suspiciously small — the capture may be blank`);
  }

  console.log(`wrote ${outFile} (${WIDTH}x${HEIGHT}, ${kb}KB)`);

  cdp.close();
}

main().catch((error) => {
  console.error('og generation failed:', error.message);
  process.exit(1);
});
