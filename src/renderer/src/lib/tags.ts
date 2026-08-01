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
