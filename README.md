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
content edge alignment, and accessibility structure (landmarks, heading
order, accessible names, duplicate ids, broken anchors, skip link).

It also runs behavioural passes: `prefers-reduced-motion`, JavaScript
disabled, the theme toggle, the mobile drawer, real Tab-key focus rings,
long tasks during a full-page scroll, and proof the hero canvas pauses off
screen and resumes on screen.

```bash
npm run build
npm run serve &                              # serves dist/ on :4321
msedge --headless=new --remote-debugging-port=9222 --user-data-dir=.audit/edge about:blank &
npm run audit                                # writes .audit/report.json + PNGs
```

CDP is driven over a WebSocket rather than by spawning the browser from Node,
so it also works in environments that block piped child processes.

## Social preview image

`og:image` is generated from the live homepage rather than composited by hand,
so the card can never drift from the real hero:

```bash
npm run serve &
msedge --headless=new --remote-debugging-port=9222 --user-data-dir=.audit/edge about:blank &
npm run og                                   # writes public/images/og.png
```

Re-run it after changing the hero, the name, or the type system.

---

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the
site and publishes it to GitHub Pages.

**One-time repository setting:** under *Settings → Pages → Build and
deployment → Source*, choose **GitHub Actions**. The legacy "deploy from a
branch" mode expects a Jekyll site and will not build this project.

---

## History

The previous academicpages/Jekyll version is preserved on the
`v1-academicpages` tag:

```bash
git checkout v1-academicpages
```
