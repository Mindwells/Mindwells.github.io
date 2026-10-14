/**
 * Flags user-facing strings that read as claims about the site owner rather
 * than structure or fact — first person, promises, and invitations.
 *
 * The site is generated on someone's behalf, so the failure mode to guard
 * against is inventing things they did not say: a tagline, a commitment about
 * their inbox, an invitation to get in touch.
 *
 * Advisory only, and never wired into CI: it cannot tell an invented claim
 * from the owner's own legitimate first-person writing, so a finding is a
 * prompt to look, not a failure. It exits 0 either way.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, relative } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.astro', '.ts'].includes(extname(full))) out.push(full);
  }
  return out;
}

// Text that looks like prose the visitor reads, in quotes or JSX text.
const PROSE = [
  /message=["']([^"']{12,})["']/g,
  /lede=["']([^"']{12,})["']/g,
  /<p[^>]*>\s*([A-Z][^<>{]{20,})\s*<\/p>/g,
];

// First person and second-person invitations/promises.
const SUSPECT =
  /\b(I |my |me\b|we |our |you can|email me|reach me|I read|I reply|I am happy|feel free|open to|get in touch with me|don't hesitate)\b/i;

// Known-good: the owner's own verbatim bio, which is quoted deliberately.
const ALLOWED = [/incoming Master's student at the School of Computer Science/];

const findings = [];

for (const file of walk(src)) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  for (const pattern of PROSE) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1].replace(/\s+/g, ' ').trim();
      if (ALLOWED.some((allow) => allow.test(value))) continue;
      if (!SUSPECT.test(value)) continue;
      const line = text.slice(0, match.index).split('\n').length;
      findings.push({ rel, line, value });
    }
  }
}

if (findings.length === 0) {
  console.log('copy-claims: no first-person claims or invitations found');
  process.exit(0);
}

console.log(`copy-claims: ${findings.length} string(s) to review`);
for (const f of findings) console.log(`  ${f.rel}:${f.line}\n    "${f.value}"`);
