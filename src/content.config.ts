import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * Content collections.
 *
 * All four are empty right now by design: the sections render themselves only
 * when entries exist, so the site stays clean until there is something real to
 * put on it. Adding an entry is a single Markdown file — no template edits.
 *
 * ── Adding content ───────────────────────────────────────────────────────
 *   src/content/news/2026-09-joining-dut.md
 *   src/content/publications/2026-some-paper.md
 *   src/content/awards/2025-outstanding-student.md
 *   src/content/experience/2025-summer-intern.md
 *
 * The filename (minus extension) becomes the URL slug and the sort key when
 * an explicit `order` is absent.
 */

/** Shared field set for anything with a date. */
const dated = {
  title: z.string(),
  date: z.coerce.date(),
  draft: z.boolean().default(false),
};

const news = defineCollection({
  loader: glob({ base: './src/content/news', pattern: '**/*.md' }),
  schema: z.object({
    ...dated,
    /** Optional short label, e.g. "Paper" or "Talk". */
    tag: z.string().optional(),
    /** External link the item points at. */
    href: z.url().optional(),
  }),
});

const publications = defineCollection({
  loader: glob({ base: './src/content/publications', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    authors: z.array(z.string()),
    /** Index into `authors` marking the site owner, rendered emphasised. */
    selfIndex: z.number().int().nonnegative().default(0),
    venue: z.string(),
    /** e.g. "2026" — kept separate from `date` so "to appear" works. */
    year: z.number().int(),
    type: z.enum(['conference', 'journal', 'preprint', 'workshop']).default('conference'),
    /** Venue short name for the badge, e.g. "ACL". */
    abbr: z.string().optional(),
    abstract: z.string().optional(),
    links: z
      .array(z.object({ label: z.string(), href: z.url() }))
      .default([]),
    /** Path under /images/ for a teaser figure. */
    thumbnail: z.string().optional(),
    /** Pin to the top of the list regardless of year. */
    featured: z.boolean().default(false),
    selected: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const awards = defineCollection({
  loader: glob({ base: './src/content/awards', pattern: '**/*.md' }),
  schema: z.object({
    ...dated,
    /** e.g. "National", "Provincial", "University". */
    level: z.string().optional(),
    issuer: z.string().optional(),
  }),
});

const experience = defineCollection({
  loader: glob({ base: './src/content/experience', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    organization: z.string(),
    /** Display string, e.g. "2025.06 — 2025.09". */
    period: z.string(),
    start: z.coerce.date(),
    end: z.coerce.date().nullable().default(null),
    location: z.string().optional(),
    role: z.string().optional(),
    href: z.url().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { news, publications, awards, experience };
