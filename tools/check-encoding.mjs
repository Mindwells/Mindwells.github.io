/**
 * Encoding guard.
 *
 * Two ways source text gets silently damaged:
 *
 *  1. A tool rewrites the file using the system legacy code page, replacing
 *     bytes it cannot map with a question mark. The result is invalid UTF-8,
 *     which surfaces as U+FFFD when decoded.
 *  2. The same corruption round-trips cleanly but produces mojibake: real
 *     UTF-8 bytes reinterpreted as Latin-1 and re-encoded, so an em dash
 *     becomes a two-character sequence. That is still valid UTF-8, so a
 *     decode check alone will not catch it.
 *
 * Exits non-zero on either, so it can gate a build.
 *
 * Patterns are written as escapes rather than literal characters: this file
 * must not itself contain the sequences it searches for, or it reports itself.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, relative } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', '.git', '.audit', '.npm-cache', '.astro']);
const EXTS = ['.astro', '.css', '.ts', '.mjs', '.json', '.md', '.yml', '.yaml', '.txt'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.includes(extname(full))) out.push(full);
  }
  return out;
}

/**
 * A Latin-1 lead byte followed by a continuation-range character is the
 * signature of UTF-8 text that has been through a single-byte code page.
 * The explicit sequences cover a UTF-8 encoded em dash and the UTF-8
 * encoding of U+FFFD, both decoded as Latin-1.
 */
const MOJIBAKE = new RegExp(
  '[\\u00c2\\u00c3\\u00c5\\u00d0\\u00de][\\u0080-\\u00bf]' + // generic double-encoding
    '|\\u00e2\\u20ac' + // em dash, double-encoded
    '|\\u00ef\\u00bf\\u00bd', // U+FFFD, double-encoded
);

const problems = [];

for (const file of walk(root)) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const text = readFileSync(file).toString('utf8');

  const replacement = text.indexOf('\uFFFD');
  if (replacement !== -1) {
    problems.push({ rel, kind: 'invalid UTF-8', line: text.slice(0, replacement).split('\n').length });
    continue;
  }

  const mojibake = MOJIBAKE.exec(text);
  if (mojibake) {
    const at = mojibake.index;
    problems.push({
      rel,
      kind: `mojibake near ${JSON.stringify(mojibake[0])}`,
      line: text.slice(0, at).split('\n').length,
    });
  }
}

if (problems.length === 0) {
  console.log('encoding: all source files are clean UTF-8');
  process.exit(0);
}

console.error(`encoding: ${problems.length} file(s) damaged`);
for (const p of problems) console.error(`  ${p.rel}:${p.line}  ${p.kind}`);
process.exit(1);
