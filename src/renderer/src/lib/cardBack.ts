import type { CastEntry, DocFile, DocMeta } from '../../../shared/types'

/**
 * F-42: the back of a scene's index card — the scene outlined before any
 * prose exists.
 *
 * Everything here is pure, so the rules about what reaches the file are
 * tested without a store or a DOM. The one rule that matters: **a field the
 * writer has cleared is a deleted key, not an empty one.** gray-matter's
 * dumper throws on `undefined`, an empty string on disk is noise in every
 * diff and every sync merge, and "absent" is the only form the rest of the
 * app reads as unset.
 */

/** The fields on the back, as the form edits them: strings, never absent. */
export interface CardBack {
  synopsis: string
  act: string
  sceneType: string
  location: string
  conflict: string
  cast: CastEntry[]
}

const TEXT_FIELDS = ['synopsis', 'act', 'sceneType', 'location', 'conflict'] as const

/** What the form starts from: the card's back as it is on disk. */
export function backOf(meta: DocMeta): CardBack {
  return {
    synopsis: meta.synopsis ?? '',
    act: meta.act ?? '',
    sceneType: meta.sceneType ?? '',
    location: meta.location ?? '',
    conflict: meta.conflict ?? '',
    cast: (meta.cast ?? []).map((c) => ({ ...c }))
  }
}

/** One cast entry as it should be written: trimmed, empty fields dropped. */
function cleanCast(entry: CastEntry): CastEntry {
  const out: CastEntry = { entityId: entry.entityId }
  for (const key of ['motivation', 'goal', 'note'] as const) {
    const value = entry[key]?.trim()
    if (value) out[key] = value
  }
  return out
}

/**
 * The metadata with this back written onto it. Text is trimmed, except that
 * a synopsis keeps its inner line breaks; anything left empty is deleted.
 * A character listed twice is kept once, first mention winning, since a
 * scene does not have the same person in it twice.
 */
export function withBack(meta: DocMeta, back: CardBack): DocMeta {
  const out: DocMeta = { ...meta }
  for (const key of TEXT_FIELDS) {
    const value = back[key].trim()
    if (value) out[key] = value
    else delete out[key]
  }
  const seen = new Set<string>()
  const cast = back.cast
    .filter((c) => c.entityId && !seen.has(c.entityId) && seen.add(c.entityId))
    .map(cleanCast)
  if (cast.length) out.cast = cast
  else delete out.cast
  return out
}

/** Whether anything is written on the back of this card. */
export function hasBack(meta: DocMeta): boolean {
  return TEXT_FIELDS.some((k) => meta[k]) || (meta.cast?.length ?? 0) > 0
}

/** Whether saving this back would change anything on disk. */
export function backChanged(meta: DocMeta, back: CardBack): boolean {
  const pick = (m: DocMeta): string =>
    JSON.stringify([...TEXT_FIELDS.map((k) => m[k] ?? null), m.cast ?? null])
  return pick(withBack(meta, back)) !== pick(meta)
}

/** A change to some fields of a back: what the writer actually edited. */
export type BackPatch = Partial<CardBack>

/**
 * What the writer changed, compared with what they were shown — not with
 * what is on disk. The board's copy of a document can be older than the
 * file: a sync can pull another device's synopsis in while the board is up.
 * Diffing against disk would write the board's stale copy back over it the
 * moment the card was turned without a keystroke; diffing against the form's
 * starting point means a field the writer never touched is never written.
 * Fields compare as they would be stored (trimmed, cast cleaned), so adding
 * a space is not an edit. Null when nothing changed.
 */
export function backPatch(seed: CardBack, back: CardBack): BackPatch | null {
  const base: DocMeta = { id: '', title: '', created: '', modified: '' }
  const was = withBack(base, seed)
  const now = withBack(base, back)
  const patch: BackPatch = {}
  for (const key of TEXT_FIELDS) if ((was[key] ?? '') !== (now[key] ?? '')) patch[key] = back[key]
  if (JSON.stringify(was.cast ?? []) !== JSON.stringify(now.cast ?? [])) patch.cast = back.cast
  return Object.keys(patch).length ? patch : null
}

/** The metadata with only the patched fields of its back rewritten. */
export function withPatch(meta: DocMeta, patch: BackPatch): DocMeta {
  const out = withBack({ ...meta }, { ...backOf(meta), ...patch })
  // Fields the patch does not name are left exactly as the file had them,
  // not re-cleaned: this write is about what the writer changed, nothing else.
  for (const key of TEXT_FIELDS) {
    if (key in patch) continue
    if (meta[key] === undefined) delete out[key]
    else out[key] = meta[key]
  }
  if (!('cast' in patch)) {
    if (meta.cast === undefined) delete out.cast
    else out.cast = meta.cast
  }
  return out
}

/**
 * The values a field already has across the project, most used first — the
 * remembered suggestions for act and scene type. Free text with suggestions
 * rather than a closed list: a fixed vocabulary would impose someone else's
 * story structure on the book. Ties go alphabetically, so the list is stable.
 */
export function suggestionsFor(docs: DocFile[], field: 'act' | 'sceneType'): string[] {
  const counts = new Map<string, number>()
  for (const d of docs) {
    const value = d.meta[field]?.trim()
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value]) => value)
}

/** The act and scene type as one line for the front of the card. */
export function outlineLine(meta: DocMeta): string {
  return [meta.act ? `Act ${meta.act.replace(/^act\s+/i, '')}` : '', meta.sceneType ?? '']
    .filter(Boolean)
    .join(' · ')
}
