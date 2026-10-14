/**
 * Research focus areas.
 *
 * These drive the hero's retrieval visualisation *and* the About section, so
 * the animation is literally made of the research topics rather than being
 * decorative for its own sake.
 */

export interface ResearchArea {
  /** Short label — used as a token in the hero canvas. */
  token: string;
  /** Full name, used in prose contexts. */
  title: string;
  /** One line on what the work actually involves. */
  blurb: string;
}

export const researchAreas: ResearchArea[] = [
  {
    token: 'RAG',
    title: 'Retrieval-Augmented Generation',
    blurb:
      'Making retrieval decisions that a model can actually justify — chunking, ranking, and when to retrieve at all.',
  },
  {
    token: 'LLM Reasoning',
    title: 'Large Language Model Reasoning',
    blurb:
      'How models chain, verify, and abandon intermediate steps, and where that reasoning silently breaks down.',
  },
];

/** Broader framing, shown as the section summary. */
export const researchSummary = 'Natural Language Processing';
