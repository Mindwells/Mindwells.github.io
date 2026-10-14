/**
 * Compares the classes in the built CSS against the classes the project uses.
 *
 * After many rounds of edits, stylesheets accumulate rules for markup that no
 * longer exists, and markup acquires class names nobody styled. Neither is
 * visible in a browser: an unstyled class just renders as default, and a dead
 * rule just does nothing.
 *
 * Three things make a naive built-HTML comparison wrong, and all three are
 * handled here:
 *
 *   1. Astro inlines small stylesheets into the HTML, so CSS lives in both
 *      `.css` files and `<style>` blocks.
 *   2. Hashed font filenames inside `url(...)` look like class selectors when
 *      scanned with a regex.
 *   3. Sections with no entries never render their component markup, so
 *      classes belonging to those components appear unused. They are not.
 *
 *   npm run build && node tools/check-classes.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const src = join(root, 'src');

/** Classes added at runtime by JavaScript; never present in static markup. */
const RUNTIME_CLASSES = new Set([
  'is-revealed',
  'is-copied',
  'is-condensed',
  'is-active',
  'js',
  'no-js',
]);

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.includes(extname(entry.name))) out.push(full);
  }
  return out;
}

const distFiles = walk(dist, ['.css', '.html']);
const sourceFiles = walk(src, ['.astro']);

const css = distFiles
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(f, 'utf8'))
  .concat(
    // Inlined stylesheets live inside <style> blocks in the HTML.
    distFiles
      .filter((f) => f.endsWith('.html'))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1])),
  )
  .join('\n')
  // Strip url(...) so hashed font filenames are not read as class selectors.
  .replace(/url\([^)]*\)/g, 'url()');

const styledClasses = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

/** Class names appearing in markup: built HTML plus every source template. */
const usedClasses = new Set();

const collectFromMarkup = (text) => {
  for (const match of text.matchAll(/class="([^"]*)"/g)) {
    for (const name of match[1].split(/\s+/)) if (name) usedClasses.add(name);
  }
  // class:list={['a', 'b', ...]} and class:list={[cond && 'c']}
  for (const match of text.matchAll(/class:list=\{\[([\s\S]*?)\]\}/g)) {
    for (const name of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
      for (const part of name[1].split(/\s+/)) if (part) usedClasses.add(part);
    }
  }
};

for (const file of [...distFiles.filter((f) => f.endsWith('.html')), ...sourceFiles]) {
  collectFromMarkup(readFileSync(file, 'utf8'));
}

const deadRules = [...styledClasses].filter((c) => !usedClasses.has(c) && !RUNTIME_CLASSES.has(c));
const unstyled = [...usedClasses].filter((c) => !styledClasses.has(c) && !RUNTIME_CLASSES.has(c));

console.log(
  `classes: ${styledClasses.size} styled, ${usedClasses.size} referenced in built markup or source templates`,
);

// Reported, not failed: a class with no rule is usually a deliberate semantic
// hook, but it is also what a typo'd class name looks like, so it is worth
// seeing on every run.
if (unstyled.length) {
  console.log(`\nreferenced but never styled (${unstyled.length}) — check for typos:`);
  console.log('  ' + unstyled.sort().join(' '));
}

if (deadRules.length === 0) {
  console.log('\nno dead CSS rules');
  process.exit(0);
}

console.log(`\ndead CSS rules (${deadRules.length}) — styled but referenced nowhere:`);
console.log('  ' + deadRules.sort().join(' '));
process.exit(1);
