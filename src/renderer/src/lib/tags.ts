/**
 * Pure helpers for the F-10 tag/pin lists on `DocMeta` and `Entity`. Tags are
 * free-form and writer-invented; pins toggle membership in a closed,
 * app-shipped vocabulary (`DOC_PINS` / `CHARACTER_PINS`). Kept as plain
 * functions over string arrays so both the document header and the entity
 * editor can share them without sharing a component.
 */

/** Add a trimmed, deduplicated (exact match) tag. Blank input is a no-op. */
export function addTag(tags: string[] | undefined, raw: string): string[] {
  const value = raw.trim()
  if (!value) return tags ?? []
  const existing = tags ?? []
  if (existing.includes(value)) return existing
  return [...existing, value]
}

export function removeTag(tags: string[] | undefined, value: string): string[] {
  return (tags ?? []).filter((t) => t !== value)
}

export function togglePin(pins: string[] | undefined, value: string): string[] {
  const existing = pins ?? []
  return existing.includes(value) ? existing.filter((p) => p !== value) : [...existing, value]
}

/* ---------- browsing by tag (F-34) ---------- */

export interface TagCount {
  tag: string
  count: number
}

/**
 * Every tag in use across the story bible, most-used first and alphabetical
 * within a tie — the order the tag buttons are drawn in.
 *
 * **Matching is exact, not case-folded**, deliberately: `addTag` dedupes on
 * exact match, so "Gun" and "gun" already *are* two distinct tags everywhere
 * else in the app (both would show as separate chips on an entry). Merging
 * them only here would misrepresent the stored data and make a button
 * ambiguous about what it selects. Ties sort with `localeCompare` so the
 * ordering is still human-sensible rather than ASCII-uppercase-first.
 */
export function tagCounts(entities: { tags?: string[] }[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const entity of entities) {
    // A single entity carrying the same tag twice must not count twice; the
    // list is writer-maintained and `addTag` is not the only way in (a
    // hand-edited frontmatter file is plain text).
    for (const tag of new Set(entity.tags ?? [])) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** The entries carrying one tag, in the order they were given. */
export function entitiesWithTag<T extends { tags?: string[] }>(entities: T[], tag: string): T[] {
  return entities.filter((e) => (e.tags ?? []).includes(tag))
}
