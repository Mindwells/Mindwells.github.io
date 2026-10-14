/**
 * Research focus areas.
 *
 * These drive the hero's retrieval visualisation *and* the Research section,
 * so the animation is made of the actual research topics rather than being
 * decorative.
 *
 * `token` is the compact form used inside the hero canvas, and is taken from
 * the abbreviation in the owner's own bio.
 *
 * `blurb` deliberately describes the *field*, not the owner's own work — the
 * bio states what he focuses on, and the site should not put opinions about
 * his research in his mouth.
 */

export interface ResearchArea {
  /** Short label — used as a token in the hero canvas. */
  token: string;
  /** Full name, as written in the bio. */
  title: string;
  /** A neutral description of what the field covers. */
  blurb: string;
}

export const researchAreas: ResearchArea[] = [
  {
    token: 'RAG',
    title: 'Retrieval-Augmented Generation',
    blurb:
      'Grounding a model’s output in documents fetched at inference time, so the evidence behind an answer can be inspected rather than taken on trust.',
  },
  {
    token: 'LLM Reasoning',
    title: 'Large Language Model Reasoning',
    blurb:
      'How large language models chain, verify, and abandon intermediate steps when solving a problem — and where those steps stop reflecting the answer.',
  },
];

/** Broader framing, shown as the section summary. */
export const researchSummary = 'Natural Language Processing';
