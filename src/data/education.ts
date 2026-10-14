/**
 * Education and experience timeline.
 *
 * Ordered newest-first: the first entry with `current: true` is treated as
 * the present position and gets the accent marker in the timeline.
 */

export interface TimelineEntry {
  /** e.g. "2026.09 — Present" */
  period: string;
  /** Machine-readable start date (YYYY-MM) for schema.org and sorting. */
  start: string;
  /** Machine-readable end date, or null while ongoing. */
  end: string | null;
  institution: string;
  /** Short form used where space is tight, e.g. "DUT". */
  abbr: string;
  degree: string;
  detail?: string;
  location?: string;
  current?: boolean;
  /** Optional note — advisor, lab, thesis, GPA. */
  note?: string;
}

export const education: TimelineEntry[] = [
  {
    period: '2026.09 — Present',
    start: '2026-09',
    end: null,
    institution: 'Dalian University of Technology',
    abbr: 'DUT',
    degree: 'M.S. in Computer Science and Technology',
    detail: 'School of Computer Science and Technology',
    location: 'Dalian, China',
    current: true,
    note: 'Advised by Assistant Professor Jihao Shi',
  },
  {
    period: '2022.09 — 2026.06',
    start: '2022-09',
    end: '2026-06',
    institution: 'Wuhan University of Technology',
    abbr: 'WUT',
    degree: 'B.S. in Computer Science and Technology',
    detail: 'School of Computer Science and Artificial Intelligence',
    location: 'Wuhan, China',
    note: undefined,
  },
];
