# mindwells.github.io

Personal homepage — [mindwells.github.io](https://mindwells.github.io)

Built with [Astro](https://astro.build). Static output, no runtime framework, deployed to GitHub Pages by GitHub Actions.

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:4321
```

| Command           | Does                                     |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Dev server with hot reload               |
| `npm run build`   | Build the static site into `dist/`       |
| `npm run preview` | Serve the built `dist/` locally          |
| `npm run check`   | Type-check the project                   |

---

## Editing content

### Personal details, links, contact

Everything about *who you are* lives in one file: **`src/data/profile.ts`**.

Set a URL and it appears; leave it `null` and it stays hidden. No template
changes are needed to add a Google Scholar or ORCID link — fill in `href`.

```ts
{ label: 'Google Scholar', href: 'https://scholar.google.com/...', icon: 'scholar' },
```

To add a profile photo, drop a square image (≥800px) into `public/images/`
and point `profile.avatar.src` at it. Until then the site renders a
typographic monogram.

### Education and experience timeline

`src/data/education.ts` — an ordered array, newest first. Mark the current
position with `current: true` to give it the accent treatment.

### Research areas

`src/data/research.ts` — also drives the hero animation, so the motion is
literally made of the research topics.

### News, publications, awards, experience entries

These are Markdown content collections. Each directory ships a
**`_template.md`** documenting the exact frontmatter — copy it, rename it, and
fill it in.

Every collection supports `draft: true`. While an entry is a draft it is
excluded from the site entirely, so you can commit work in progress without
publishing it. The sections currently contain only drafts, which is why each
one shows a written placeholder instead of an empty list; add a real entry and
it renders itself with no template edits.

Entry bodies are **Markdown** — rendered through Astro's `render()`, so
emphasis, links, inline code and lists all work. Keep them to a line or two;
they are a supporting detail under the entry title, not body copy.

```
src/content/news/2026-09-joining-dut.md
src/content/publications/2026-my-paper.md
src/content/awards/2025-some-prize.md
src/content/experience/2025-summer-intern.md
```

Example publication:

```markdown
---
title: 'A Paper Title'
authors: ['Yuan Zhou', 'Jihao Shi']
selfIndex: 0          # which author is you — rendered emphasised
venue: 'Proceedings of Some Conference'
year: 2026
type: conference      # conference | journal | preprint | workshop
abbr: 'ACL'
abstract: 'One or two sentences.'
links:
  - { label: 'Paper', href: 'https://...' }
  - { label: 'Code', href: 'https://...' }
featured: true        # pins to the top
---

Optional Markdown body.
```

Example news item:

```markdown
---
title: 'Paper accepted at ACL 2026'
date: 2026-05-02
tag: 'Paper'
href: 'https://...'   # optional
---

Optional one-line detail shown under the title.
```

Fields are validated at build time — a typo in a field name fails the build
rather than silently rendering nothing.

---

## Design system

The whole visual language derives from **`src/styles/tokens.css`**: colour,
type scale, spacing, and motion curves. Components never hard-code raw
values, so changing a token changes the site coherently.

- **Colour** — paper-white ground, ink-black text, one desaturated indigo
  accent. Deliberately avoids pure `#fff`/`#000`.
- **Type** — serif for voice (headings), sans for information (body), mono
  for metadata (dates, labels, indices). Fluid `clamp()` scale.
- **Space** — 8pt base, fluid section rhythm.
- **Motion** — one easing family; everything respects
  `prefers-reduced-motion`.
- **Dark mode** — re-derived surfaces and a lightened accent, not a CSS
  filter. Follows the system preference; the header toggle overrides it.

---

## Structure

```
src/
├── components/          One file per section or UI element
│   └── ui/Icon.astro    Inline SVG set (no icon font, no requests)
├── data/                profile, research, education — typed data
├── content/             Markdown collections (news, publications, …)
├── layouts/Base.astro   Document shell, SEO, schema.org
├── pages/index.astro    Section composition
├── scripts/enhance.ts   Progressive enhancement (reveal, nav, copy, theme)
├── styles/              tokens.css → base.css → utilities.css
└── utils/content.ts     Warning-free collection access
public/                  Icons, fonts, images — served verbatim
```

### The hero animation

`src/components/RetrievalViz.astro` draws the research itself: a query
scatters into tokens, passages light up as retrieved evidence, and the
evidence converges into an answer. Canvas 2D, ~4KB, no WebGL and no
dependency. It pauses when off-screen or when the tab is hidden, and renders
a single static frame under `prefers-reduced-motion`.

---

## Design audit

`tools/measure.mjs` loads the built site in headless Edge over the Chrome
DevTools Protocol and measures what would otherwise be judged by eye, then
writes screenshots and a JSON report to `.audit/`.

It checks: horizontal overflow, WCAG contrast (light and dark), tap-target
sizes (hit-tested, so expanded hit areas count), reveal-animation wiring,
sticky header behaviour, font loading, cumulative layout shift, heading
content edge alignment, reading measure (real characters per line, counted
from line boxes), and accessibility structure (landmarks, heading order,
accessible names, duplicate ids, broken anchors, skip link).

Contrast is checked at the level the reader asked for. The default palette
clears WCAG AA; under `prefers-contrast: more` the greys and hairline rules
are strengthened and the audit requires **AAA (7:1)** instead, in both themes.

It also runs behavioural passes: `prefers-reduced-motion`, JavaScript
disabled, the theme toggle, the mobile drawer, real Tab-key focus rings,
dispatched pointer hovers (so a dead hover state fails), anchor landing
offsets versus the sticky header, long tasks during a full-page scroll,
proof the hero canvas pauses off screen and resumes on screen, print
rendering under emulated print media, and the actual bytes over the wire
(request count, per-type totals, a size budget, 404s, third-party calls).

It exits non-zero when any check fails, so it works as a gate rather than a
log someone has to read. Every failure is listed again at the end.

```bash
npm run build
npm run serve &                              # serves dist/ on :4321
msedge --headless=new --remote-debugging-port=9222 --user-data-dir=.audit/edge about:blank &
npm run audit                                # writes .audit/report.json + PNGs
```

CDP is driven over a WebSocket rather than by spawning the browser from Node,
so it also works in environments that block piped child processes.

### Does the audit actually detect anything?

```bash
npm run selftest
```

A check that has never failed is not evidence that anything passed. The
self-test breaks the page in one specific way at a time — low contrast, an
8px control, horizontal overflow, clipped text, overlapping controls, a
misaligned heading, an over-wide measure, a stuck reveal, a missing canvas,
a second `h1`, a dead anchor, an unnamed button — runs the *same* measurement
code against it, and asserts the matching check fires.

Faults are injected at runtime with `!important` rather than by editing
source: Astro scopes component styles with an attribute selector, so a plain
class rule added to a stylesheet loses to the component's own rule and the
"fault" never reaches the page, making the test pass for the wrong reason.

All twelve currently fire. Running it is how several blind checks and two
false negatives in the audit itself were found.

## Dead CSS and unstyled classes

```bash
npm run build && npm run check:classes
```

Compares the classes in the built CSS against those the project references, in
the built HTML *and* in the source templates. Reports rules that nothing uses
(fails) and classes with no rule (informational — usually a deliberate
semantic hook, but also what a typo looks like).

Three things make a naive built-HTML comparison wrong, and the tool handles
all three: Astro inlines small stylesheets into the HTML; hashed font
filenames inside `url(...)` look like class selectors; and sections with no
entries never render their component markup, so those components' classes
would appear unused when they are not.

## Icons

```bash
npm run serve &
msedge --headless=new --remote-debugging-port=9222 --user-data-dir=.audit/edge about:blank &
npm run icons          # regenerates public/images/ icons from the design tokens
npm run check:icons    # verifies them (no browser needed, runs in CI)
```

The icon set is generated, not hand-drawn: a monogram on an ink tile, rendered
in headless Chrome so it uses the real Newsreader and reads its colours from
`--ink` / `--paper`. Change the palette and the tab icon follows.

Two details are deliberate. The mark is **responsive** — `Y` below 48px, `YZ`
above — because two serif letters in a 16px tile are about five pixels wide
each and read as a smudge. And the glyph is **fitted by measurement**, not by a
guessed font-size ratio: serif advance widths are not predictable enough to
eyeball.

`check:icons` reads the file bytes and asserts each one is a valid PNG at its
declared size, and that the `.ico` is structurally sound with PNG payloads
whose real dimensions match the directory entries. That check exists because
the generator once wrote a 1200x400 file named `favicon-16x16.png` — a
measurement step inside the render loop was resetting the viewport. The file
name is not evidence of the file's size.

## Social preview image

`og:image` is generated from the live homepage rather than composited by hand,
so the card can never drift from the real hero:

```bash
npm run serve &
msedge --headless=new --remote-debugging-port=9222 --user-data-dir=.audit/edge about:blank &
npm run og                                   # writes public/images/og.png
```

Re-run it after changing the hero, the name, or the type system.

## Copy review

```bash
npm run build && npm run copy
```

Dumps the words the built page actually shows, in reading order. Design review
tends to focus on layout, but reading the output is how several real problems
were found: a hero listing the same three terms twice, a section label and its
empty-state note saying the same thing, a page heading that read as one
run-on sentence, and a bio sentence repeated word-for-word in the hero and the
section below it.

```bash
npm run check:claims
```

Advisory scan for first-person claims and invitations — "I read every email",
"open to conversations", "email me if...". The site is generated on someone's
behalf, so the thing to guard against is inventing commitments they never
made. It is advisory only and never gates CI: it cannot tell an invented claim
from the owner's own legitimate first-person writing.

## Encoding check

```bash
npm run check:encoding
```

Fails on either failure mode for damaged source text: invalid UTF-8 (a tool
rewrote the file using the system legacy code page) and mojibake
(double-encoded text, which is still valid UTF-8). Runs in CI before the
build.

**When editing files from a shell, do not use `Set-Content` / `Out-File` on
source files** — on Windows they can re-encode the file using the legacy code
page and silently replace characters it cannot map.

---

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the
site and publishes it to GitHub Pages.

**One-time repository setting:** under *Settings → Pages → Build and
deployment → Source*, choose **GitHub Actions**. The legacy "deploy from a
branch" mode expects a Jekyll site and will not build this project.

```bash
npm run check:workflows
```

Validates the workflow files themselves — the one part of this project that
cannot be exercised locally, so a malformed file would only surface at the
moment of publishing. Checks YAML validity (including tab indentation, which
YAML forbids), that each job has a runner and usable steps, that every action
is pinned to a version rather than a branch, that the Pages job carries the
`pages` and `id-token` permissions `deploy-pages` requires, and that every
`npm run <script>` referenced in a workflow actually exists.

`public/.nojekyll` is published with the site. Nothing needs it when deploying
through GitHub Actions — that path serves the uploaded artifact directly with
no Jekyll processing — but the build emits assets into `_astro/`, and Jekyll
silently drops any directory whose name starts with an underscore. The marker
costs nothing and removes that failure mode entirely if the Pages source is
ever left on "deploy from a branch".

---

## History

The previous academicpages/Jekyll version is preserved on the
`v1-academicpages` tag:

```bash
git checkout v1-academicpages
```
