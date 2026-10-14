/**
 * Generates the favicon and app-icon set from the design system.
 *
 * The icons shipped with the previous template were a vividly saturated blue
 * (#0d40a0) — measured, not guessed — while the current palette is paper,
 * ink, and a muted indigo. The tab icon is the one piece of branding visible
 * on every open tab, so a template leftover there undercuts everything else.
 *
 * Rendered in headless Chrome rather than composited with an image library, so
 * the mark uses the real Newsreader and the real tokens. The .ico is assembled
 * by hand from PNG payloads (Vista+ ICO supports them), which avoids pulling
 * in an encoder for one file.
 *
 *   node tools/icons.mjs
 *
 * Requires the static server and a headless browser with remote debugging.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { connect, findPageTarget, navigate, sleep } from './cdp.mjs';

const BASE = `http://127.0.0.1:${process.env.PORT ?? '4321'}`;
const outDir = fileURLToPath(new URL('../public/images', import.meta.url));

/** Monogram initials, taken from the same source as the header. */
const MONOGRAM = 'YZ';
/** Below this size the two-letter mark is too small to read; use one letter. */
const SINGLE_LETTER_BELOW = 48;

/**
 * A 16px tile holds roughly 16 device pixels across. Two serif letters there
 * are around five pixels wide each, which reads as a smudge; one letter has
 * twice the room and stays a recognisable mark. This is the same responsive
 * logo decision a brand guide would make.
 */
const markFor = (size) => (size < SINGLE_LETTER_BELOW ? MONOGRAM.slice(0, 1) : MONOGRAM);

const PNG_SIZES = [
  { file: 'favicon-16x16.png', size: 16 },
  { file: 'favicon-32x32.png', size: 32 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'android-chrome-192x192.png', size: 192 },
  { file: 'android-chrome-512x512.png', size: 512 },
];

/** Sizes embedded in the multi-resolution .ico. */
const ICO_SIZES = [16, 32, 48];

/** Writes a Vista-style .ico from PNG payloads. */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;

  entries.forEach((entry, i) => {
    const at = i * 16;
    // 0 encodes 256 in the ICO format; our sizes are all smaller.
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 0);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.data)]);
}

/**
 * Reads a PNG's dimensions from its IHDR chunk.
 *
 * The render loop sets the viewport to the icon size and then screenshots it,
 * so a viewport change between those two steps silently produces an icon of
 * the wrong size. Verifying the bytes is the only way to be sure — the file
 * name is not evidence.
 */
function pngSize(buffer) {
  const isPng = buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (!isPng) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  const target = await findPageTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  /**
   * Measures real glyph metrics for a given mark, so it can be fitted to the
   * tile rather than guessed at with a font-size ratio. Serif advance widths
   * are not predictable enough to eyeball, and I cannot see the result.
   */
  const measureMark = async (text) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1200,
      height: 400,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(cdp, BASE, 600);

    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const probe = document.createElement('span');
        probe.textContent = ${JSON.stringify(text)};
        probe.style.cssText = [
          'position:absolute', 'visibility:hidden', 'white-space:pre',
          'font-family:Newsreader,Georgia,serif', 'font-weight:600',
          'letter-spacing:-0.04em', 'line-height:1', 'font-size:100px',
        ].join(';');
        document.body.appendChild(probe);
        await document.fonts.ready;
        const rect = probe.getBoundingClientRect();
        probe.remove();
        // Measure the actual inked height with a canvas rather than the line
        // box: a line box is line-height tall regardless of the glyph, so
        // using it as cap height silently made the fit a no-op.
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(rect.width) + 20;
        canvas.height = 200;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.font = '600 100px Newsreader, Georgia, serif';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#fff';
        ctx.fillText(${JSON.stringify(text)}, 10, 150);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            if (data[(y * canvas.width + x) * 4 + 3] > 16) {
              if (y < top) top = y;
              if (y > bottom) bottom = y;
              if (x < left) left = x;
              if (x > right) right = x;
            }
          }
        }
        return {
          inkWidth: right - left + 1,
          inkHeight: bottom - top + 1,
          inkArea: (() => {
            let n = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 16) n++;
            return n;
          })(),
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });

    return result.value;
  };

  const metricsCache = new Map();
  const metricsFor = async (text) => {
    if (!metricsCache.has(text)) metricsCache.set(text, await measureMark(text));
    return metricsCache.get(text);
  };

  /**
   * Reads the icon's ground and mark colours from the live design tokens.
   *
   * Hard-coding them would mean the icons silently drift the next time the
   * palette changes, and nothing on the page would look wrong to catch it —
   * the tab icon sits outside the page.
   */
  const readTokens = async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1200,
      height: 400,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(cdp, BASE, 600);
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const s = getComputedStyle(document.documentElement);
        return {
          ground: s.getPropertyValue('--ink').trim() || '#14161a',
          mark: s.getPropertyValue('--paper').trim() || '#faf9f7',
        };
      })()`,
      returnByValue: true,
    });
    return result.value;
  };

  /** Font size that fits the mark inside `fraction` of a `size`px tile. */
  const fitFontSize = async (size, fraction = 0.74) => {
    const text = markFor(size);
    const m = await metricsFor(text);
    const byWidth = ((size * fraction) / m.inkWidth) * 100;
    const byHeight = ((size * fraction) / m.inkHeight) * 100;
    return Math.max(1, Math.round(Math.min(byWidth, byHeight)));
  };

  /** Renders the mark at one size and returns the PNG bytes. */
  const render = async (size, tokens) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: size,
      height: size,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // Reuse the site so the Newsreader @font-face is already available.
    await navigate(cdp, BASE, 600);

    const fontSize = await fitFontSize(size);
    const mark = markFor(size);

    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        document.body.innerHTML = '';
        document.body.style.cssText = 'margin:0;padding:0;overflow:hidden';
        const tile = document.createElement('div');
        tile.style.cssText = [
          'width:100vw', 'height:100vh',
          'display:grid', 'place-items:center',
          'background:${tokens.ground}', 'color:${tokens.mark}',
          'font-family:Newsreader,Georgia,serif',
          'font-weight:600',
          'font-size:${fontSize}px',
          'letter-spacing:-0.04em',
          'line-height:1',
          'box-sizing:border-box',
        ].join(';');
        tile.textContent = ${JSON.stringify(mark)};
        document.body.appendChild(tile);
      })()`,
      returnByValue: true,
    });

    // Let the font settle before capturing.
    await cdp.send('Runtime.evaluate', {
      expression: `document.fonts.ready.then(() => true)`,
      awaitPromise: true,
      returnByValue: true,
    });
    await sleep(250);

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(shot.data, 'base64');
  };

  // Read the palette first: this also warms nothing, but it must happen before
  // any render so the tokens are known.
  const tokens = await readTokens();
  console.log(`palette from tokens: ground ${tokens.ground}, mark ${tokens.mark}`);

  /*
   * Warm the glyph-metrics cache before rendering anything.
   *
   * Measuring changes the viewport, and the render loop screenshots whatever
   * viewport is current. Measuring lazily inside the loop meant the first icon
   * of each distinct mark was captured at the *measurement* size — a
   * "16x16" favicon that was actually 1200x400.
   */
  await metricsFor(markFor(16));
  await metricsFor(markFor(512));
  console.log('glyph metrics primed for both marks');

  for (const { file, size } of PNG_SIZES) {
    const data = await render(size, tokens);
    const actual = pngSize(data);
    if (!actual || actual.width !== size || actual.height !== size) {
      throw new Error(
        `${file}: rendered ${actual ? `${actual.width}x${actual.height}` : 'non-PNG'}, expected ${size}x${size}`,
      );
    }
    writeFileSync(join(outDir, file), data);
    console.log(`wrote ${file} (${size}x${size}, mark "${markFor(size)}" at ${await fitFontSize(size)}px)`);
  }

  const icoEntries = [];
  for (const size of ICO_SIZES) {
    const data = await render(size, tokens);
    const actual = pngSize(data);
    if (!actual || actual.width !== size || actual.height !== size) {
      throw new Error(`favicon.ico entry ${size}: rendered ${actual?.width}x${actual?.height}`);
    }
    icoEntries.push({ size, data });
  }
  const ico = buildIco(icoEntries);
  writeFileSync(join(outDir, 'favicon.ico'), ico);
  console.log(`wrote favicon.ico (${ICO_SIZES.join('+')}, ${Math.round(ico.length / 1024)}KB)`);

  cdp.close();
}

main().catch((error) => {
  console.error('icon generation failed:', error.message);
  process.exit(1);
});
