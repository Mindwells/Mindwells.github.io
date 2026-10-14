/**
 * Single source of truth for identity, contact and links.
 *
 * Everything the site says about *who this is* flows from here, so updating a
 * profile URL or an affiliation is a one-line change rather than a hunt
 * through templates.
 *
 * ── Editing notes ────────────────────────────────────────────────────────
 * • `links` entries with `href: null` are hidden automatically. Leave the
 *   placeholder in place and fill in the URL when the account exists; no
 *   template changes needed.
 * • `avatar.src` — drop a square-ish photo (≥800px) into `public/images/`
 *   and update the path. Until then a typographic monogram is rendered.
 * • Keep `bio` to one sentence: it is used for meta descriptions too.
 */

export interface ProfileLink {
  /** Visible label. */
  label: string;
  /** Absolute URL, or `null` while the account doesn't exist yet. */
  href: string | null;
  /** Key into the icon set in `src/components/ui/Icon.astro`. */
  icon: string;
  /** Shown in the mono-styled contact list. */
  handle?: string;
}

export const profile = {
  name: 'Yuan Zhou',
  /** Rendered in the hero as the large display line. */
  displayName: 'Yuan Zhou',
  /** Used for <title>, schema.org, and the monogram fallback. */
  initials: 'YZ',

  role: 'Incoming M.S. Student in Computer Science',
  affiliation: 'Dalian University of Technology',
  affiliationFull: 'School of Computer Science and Technology, Dalian University of Technology',
  location: 'Dalian, China',

  /** One sentence. Doubles as the meta description. */
  bio: 'Incoming M.S. student at Dalian University of Technology, working on Natural Language Processing with a focus on retrieval-augmented generation and large language model reasoning.',

  /**
   * Positioning sentence shown under the hero title.
   *
   * This is the site owner's own wording, kept verbatim — the hero states
   * where he is and what he works on, in his words rather than a rewritten
   * marketing line.
   */
  statement:
    "I am an incoming Master's student at the School of Computer Science and Technology, Dalian University of Technology (DUT), where I am fortunate to be advised by Assistant Professor Jihao Shi.",

  /**
   * Set `src` to a real photograph when available, e.g.
   * '/images/portrait.jpg'. `alt` describes the photo, not the person's name.
   */
  avatar: {
    src: null as string | null,
    alt: 'Portrait of Yuan Zhou',
  },

  links: [
    {
      label: 'Email',
      href: 'mailto:serenitymindwell@gmail.com',
      icon: 'mail',
      handle: 'serenitymindwell@gmail.com',
    },
    {
      label: 'GitHub',
      href: 'https://github.com/Mindwells',
      icon: 'github',
      handle: '@Mindwells',
    },
    { label: 'Google Scholar', href: null, icon: 'scholar', handle: '—' },
    { label: 'ORCID', href: null, icon: 'orcid', handle: '—' },
    { label: 'DBLP', href: null, icon: 'dblp', handle: '—' },
    { label: 'LinkedIn', href: null, icon: 'linkedin', handle: '—' },
    { label: 'X', href: null, icon: 'x', handle: '—' },
  ] as ProfileLink[],

  /** Optional CV. Put the PDF in `public/cv/` and set the filename here. */
  cv: {
    file: null as string | null,
    label: 'Curriculum Vitae',
  },
};

/** Links that actually resolve — use this when rendering. */
export const activeLinks = profile.links.filter(
  (link): link is ProfileLink & { href: string } =>
    typeof link.href === 'string' && link.href.length > 0,
);
