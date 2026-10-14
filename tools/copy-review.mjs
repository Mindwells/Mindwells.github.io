/**
 * Dumps the words the built page actually shows, in reading order.
 *
 * Design review tends to focus on layout, but the fastest way to find real
 * problems is often to read the output: a heading repeating the paragraph
 * under it, a section label and an empty-state note saying the same thing
 * twice, a hero listing the same three terms in two places.
 *
 *   npm run copy        # after npm run build
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));

const strip = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

function review(file = 'index.html') {
  const html = readFileSync(`${dist}/${file}`, 'utf8');
  const pick = (re) => {
    const m = html.match(re);
    return m ? strip(m[0]) : null;
  };

  console.log(`=== ${file} ===`);

  const hero = {
    status: pick(/<p class="hero__status"[\s\S]*?<\/p>/),
    headline: pick(/<h1 class="hero__title"[\s\S]*?<\/h1>/),
    lede: pick(/<p class="hero__lede"[\s\S]*?<\/p>/),
    tags: pick(/<ul class="hero__tags"[\s\S]*?<\/ul>/),
    actions: pick(/<div class="hero__actions"[\s\S]*?<\/div>\s*<\/div>/),
  };
  if (hero.headline) {
    console.log('\nHERO');
    for (const [key, value] of Object.entries(hero)) {
      if (value) console.log(`  ${key.padEnd(9)} ${value}`);
    }
  }

  const sections = [...html.matchAll(/<section[^>]*id="([a-z]+)"[\s\S]*?(?=<section|<\/main>)/g)];
  if (sections.length === 0) return;

  console.log('\nSECTIONS');
  for (const section of sections) {
    const [id, body] = [section[1], section[0]];
    const title = body.match(/<h2[^>]*class="section-header__title"[^>]*>([\s\S]*?)<\/h2>/);
    if (!title) continue;
    console.log(`\n  [${id}] ${strip(title[1])}`);
    const lede = body.match(/<p[^>]*class="section-header__lede"[^>]*>([\s\S]*?)<\/p>/);
    const empty = body.match(/<p[^>]*class="empty"[^>]*>([\s\S]*?)<\/p>/);
    if (lede) console.log(`     lede  ${strip(lede[1])}`);
    if (empty) console.log(`     empty ${strip(empty[1])}`);
  }
}

review('index.html');
console.log('');
review('404.html');

/* --------------------------------------------------------------------------
   Full reading dump.

   The structured view above answers "what does each section say". This
   answers "what does a reader actually read, in order" — which is how the
   duplicate bio sentence (hero lede and About opening paragraph, word for
   word) and the fact box repeating the Education and Contact sections were
   found. Neither is visible in source or in layout.
   -------------------------------------------------------------------------- */
console.log('\n\n=== full page, reading order ===');
const html = readFileSync(`${dist}/index.html`, 'utf8');
const body = html.slice(html.indexOf('<body'), html.indexOf('</body>'));

const lines = body
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  // The mobile drawer duplicates the header nav; it is hidden on desktop.
  .replace(/<div class="drawer"[\s\S]*?<\/div>\s*<\/div>/g, '')
  .replace(/<\/(h1|h2|h3|h4|p|li|dd|dt|div|section|header|footer|nav|ul|ol|figure)>/g, '\n')
  .replace(/<br\s*\/?>/g, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&mdash;/g, '—')
  .replace(/[ \t]+/g, ' ')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

console.log(lines.join('\n'));
console.log(`\n--- ${lines.length} lines, ${lines.join(' ').length} characters ---`);
