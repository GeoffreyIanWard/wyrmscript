import type { Entity, EntityType } from '../../../shared/types'

/**
 * The auto-linking engine (brief §5): one index over every glossary term,
 * character name, and world entry — plus all their aliases — used to find
 * mentions in prose. Matching is whole-word, case-insensitive, and prefers the
 * longest name when several overlap ("Captain Elara Voss" beats "Elara").
 */

export interface EntityMatch {
  /** Offsets into the text that was scanned. */
  start: number
  end: number
  entityId: string
  type: EntityType
  /** The exact text that matched, as written by the author. */
  text: string
}

export interface EntityIndex {
  /** Lowercased term → owning entity. */
  terms: Map<string, Entity>
  byId: Map<string, Entity>
  /** Null when there is nothing to match, so callers can skip work entirely. */
  pattern: RegExp | null
  /** Terms claimed by more than one entry, kept so the UI can warn. */
  collisions: string[]
}

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Word boundaries via Unicode lookarounds rather than \b: names carry accents
 * (Élara), and \b is ASCII-only. Apostrophes are deliberately excluded from the
 * boundary class so possessives still match ("Elara's" links "Elara").
 */
const BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}_])'
const BOUNDARY_AFTER = '(?![\\p{L}\\p{N}_])'

export function buildEntityIndex(entities: Entity[]): EntityIndex {
  const terms = new Map<string, Entity>()
  const byId = new Map<string, Entity>()
  const collisions: string[] = []

  const candidates: { term: string; entity: Entity }[] = []
  for (const entity of entities) {
    byId.set(entity.id, entity)
    for (const raw of [entity.name, ...entity.aliases]) {
      const term = raw.trim()
      if (term) candidates.push({ term, entity })
    }
  }

  // Longest first so the regex alternation prefers the longest match at any
  // given position; ties broken by name for a stable, deterministic index.
  candidates.sort(
    (a, b) => b.term.length - a.term.length || a.entity.name.localeCompare(b.entity.name)
  )

  for (const { term, entity } of candidates) {
    const key = term.toLowerCase()
    const existing = terms.get(key)
    if (existing) {
      if (existing.id !== entity.id) collisions.push(term)
      continue
    }
    terms.set(key, entity)
  }

  if (terms.size === 0) return { terms, byId, pattern: null, collisions }

  const alternation = [...terms.keys()]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escapeRegex)
    .join('|')
  const pattern = new RegExp(`${BOUNDARY_BEFORE}(?:${alternation})${BOUNDARY_AFTER}`, 'giu')

  return { terms, byId, pattern, collisions }
}

export function findEntityMatches(text: string, index: EntityIndex): EntityMatch[] {
  if (!index.pattern || !text) return []
  const matches: EntityMatch[] = []
  // Fresh regex per scan: a shared lastIndex across calls would drop matches.
  const pattern = new RegExp(index.pattern.source, index.pattern.flags)
  let hit: RegExpExecArray | null
  while ((hit = pattern.exec(text)) !== null) {
    const entity = index.terms.get(hit[0].toLowerCase())
    if (entity) {
      matches.push({
        start: hit.index,
        end: hit.index + hit[0].length,
        entityId: entity.id,
        type: entity.type,
        text: hit[0]
      })
    }
    if (hit.index === pattern.lastIndex) pattern.lastIndex++ // guard against empty match
  }
  return matches
}

export const ENTITY_LABELS: Record<EntityType, string> = {
  glossary: 'Glossary',
  character: 'Character',
  world: 'World'
}

export const ENTITY_COLLECTIONS: Record<EntityType, string> = {
  glossary: 'Glossary',
  character: 'Character Book',
  world: 'World Book'
}

/** Count of mentions of one entity per document — the backlinks panel (brief §5). */
export interface Backlink {
  docId: string
  title: string
  count: number
}

export function findBacklinks(
  docs: { meta: { id: string; title: string }; body: string }[],
  entity: Entity
): Backlink[] {
  const index = buildEntityIndex([entity])
  const links: Backlink[] = []
  for (const doc of docs) {
    const count = findEntityMatches(doc.body, index).length
    if (count > 0) links.push({ docId: doc.meta.id, title: doc.meta.title, count })
  }
  return links
}
