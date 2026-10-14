import { getCollection, type CollectionEntry, type CollectionKey } from 'astro:content';

/**
 * Content access helpers.
 *
 * `getCollection()` logs a warning for any collection that has no entries —
 * which is every collection on this site until real content is added. Rather
 * than accept four warnings on every build, we check whether the directory
 * actually holds any Markdown first.
 *
 * The practical effect: drop a `.md` file into `src/content/<collection>/`
 * and the section populates itself, with no template edits and no noise in
 * the build log.
 */

const files: Record<CollectionKey, Record<string, unknown>> = {
  news: import.meta.glob('/src/content/news/**/*.md'),
  publications: import.meta.glob('/src/content/publications/**/*.md'),
  awards: import.meta.glob('/src/content/awards/**/*.md'),
  experience: import.meta.glob('/src/content/experience/**/*.md'),
};

/** True when the collection directory contains at least one Markdown file. */
export function hasContent(collection: CollectionKey): boolean {
  return Object.keys(files[collection] ?? {}).length > 0;
}

/**
 * `getCollection`, but returns an empty array instead of warning when the
 * collection has no entries yet.
 */
export async function getEntries<C extends CollectionKey>(
  collection: C,
  filter?: (entry: CollectionEntry<C>) => boolean,
): Promise<CollectionEntry<C>[]> {
  if (!hasContent(collection)) return [];
  return filter ? getCollection(collection, filter) : getCollection(collection);
}
