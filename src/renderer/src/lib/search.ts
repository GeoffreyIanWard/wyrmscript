import type { BinderNode, DocFile, Entity } from '../../../shared/types'
import { markdownToDoc } from './markdown'
import { walk } from './tree'

/**
 * One index, two consumers: the ⌘K palette jumps by title, full-project
 * search reads inside the prose. Both live here so "what is findable" is
 * decided once — a document reachable from one and not the other would be a
 * lie about what the project contains.
 *
 * Trash is excluded from both by construction: the binder walk never enters
 * `trash`, matching how compile treats it.
 */

export type HitKind = 'doc' | 'entity'

/** A match with enough context either side to be readable in a result row. */
export interface SearchSnippet {
  before: string
  match: string
  after: string
}

export interface SearchHit {
  kind: HitKind
  id: string
  title: string
  /** Where it lives: folder path for documents, type for bible entries. */
  subtitle: string
  snippets: SearchSnippet[]
  /** Total matches in this item — snippets may be capped. */
  total: number
}

export interface PaletteItem {
  kind: HitKind | 'action'
  id: string
  title: string
  subtitle: string
  /** Character positions in `title` that matched, for emphasis. */
  positions: number[]
  score: number
}

const SNIPPET_CONTEXT = 34
const MAX_SNIPPETS = 3

function entityTypeLabel(type: Entity['type']): string {
  return type === 'character' ? 'Character' : type === 'world' ? 'World' : 'Glossary'
}

/** Folder path above each document, keyed by id — "Manuscript / Part One". */
export function folderPaths(binder: BinderNode[]): Map<string, string> {
  const paths = new Map<string, string>()
  const descend = (nodes: BinderNode[], trail: string[]): void => {
    for (const node of nodes) {
      if (node.type === 'folder') descend(node.children ?? [], [...trail, node.title])
      else paths.set(node.id, trail.join(' / '))
    }
  }
  descend(binder, [])
  return paths
}

/* ---------- full-project search ---------- */

/**
 * Bodies are stored as Markdown, so the raw text carries `**` and `==` in the
 * middle of sentences. Searching that directly is wrong twice over: a phrase
 * spanning a bold word simply never matches ("Not louder. Exactly" fails on
 * `Not louder. **Exactly**"), and snippets show storage syntax instead of
 * prose. So search runs against the same plain text the compiler produces.
 *
 * Parsing every body on every keystroke would be wasteful, so results are
 * cached by body string — bodies do not change while a writer is typing a
 * query, so this hits on all but the first pass.
 */
const plainCache = new Map<string, string>()

export function plainTextOf(body: string): string {
  const cached = plainCache.get(body)
  if (cached !== undefined) return cached
  const text = (markdownToDoc(body).content ?? [])
    .map((para) =>
      (para.content ?? [])
        .map((node) => (node.type === 'hardBreak' ? '\n' : (node.text ?? '')))
        .join('')
    )
    .join('\n\n')
  // Bounded so a long session over a big project cannot grow without limit.
  if (plainCache.size > 500) plainCache.clear()
  plainCache.set(body, text)
  return text
}

function snippetsFor(body: string, needle: string): { snippets: SearchSnippet[]; total: number } {
  const hay = body.toLowerCase()
  const snippets: SearchSnippet[] = []
  let total = 0
  let from = 0
  for (;;) {
    const at = hay.indexOf(needle, from)
    if (at === -1) break
    total++
    if (snippets.length < MAX_SNIPPETS) {
      const start = Math.max(0, at - SNIPPET_CONTEXT)
      const end = Math.min(body.length, at + needle.length + SNIPPET_CONTEXT)
      snippets.push({
        // Collapse newlines so a snippet stays one readable line.
        before: (start > 0 ? '…' : '') + body.slice(start, at).replace(/\s+/g, ' '),
        match: body.slice(at, at + needle.length),
        after:
          body.slice(at + needle.length, end).replace(/\s+/g, ' ') + (end < body.length ? '…' : '')
      })
    }
    from = at + needle.length
  }
  return { snippets, total }
}

/**
 * Search prose and story-bible bodies. Plain substring, case-insensitive —
 * a writer looking for a phrase wants that phrase, and fuzzy matching inside
 * 100,000 words returns noise rather than answers.
 */
export function searchProject(
  query: string,
  docs: DocFile[],
  entities: Entity[],
  binder: BinderNode[]
): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []

  const paths = folderPaths(binder)
  const inBinder = new Set<string>()
  walk(binder, (node) => {
    if (node.type === 'doc') inBinder.add(node.id)
  })

  const hits: SearchHit[] = []
  for (const doc of docs) {
    // A document absent from the binder is in Trash; excluded, as in compile.
    if (!inBinder.has(doc.meta.id)) continue
    const found = snippetsFor(plainTextOf(doc.body), needle)
    if (found.total === 0) continue
    hits.push({
      kind: 'doc',
      id: doc.meta.id,
      title: doc.meta.title,
      subtitle: paths.get(doc.meta.id) ?? '',
      ...found
    })
  }
  for (const entity of entities) {
    const found = snippetsFor(plainTextOf(entity.body), needle)
    const inName =
      entity.name.toLowerCase().includes(needle) ||
      entity.aliases.some((a) => a.toLowerCase().includes(needle))
    if (found.total === 0 && !inName) continue
    hits.push({
      kind: 'entity',
      id: entity.id,
      title: entity.name,
      subtitle: entityTypeLabel(entity.type),
      snippets: found.snippets,
      total: found.total
    })
  }

  // Most matches first: the document a phrase belongs to usually holds it
  // more than once. Ties fall back to title so the order is stable.
  return hits.sort((a, b) => b.total - a.total || a.title.localeCompare(b.title))
}

/* ---------- quick open (⌘K) ---------- */

/**
 * Subsequence match with a bias toward matches at word starts, so "akn"
 * finds "A Knock at Night" ahead of incidental letter runs. Returns null
 * when the query is not a subsequence at all.
 */
export function fuzzyMatch(
  query: string,
  text: string
): { score: number; positions: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (q === '') return { score: 0, positions: [] }
  const t = text.toLowerCase()
  const positions: number[] = []
  let score = 0
  let at = 0
  for (const ch of q) {
    const found = t.indexOf(ch, at)
    if (found === -1) return null
    // Word starts and consecutive runs are what make a match feel intentional.
    if (found === 0 || /[\s/—-]/.test(t[found - 1])) score += 8
    if (positions.length > 0 && found === positions[positions.length - 1] + 1) score += 5
    score += 1
    positions.push(found)
    at = found + 1
  }
  // Prefer tighter matches in shorter titles.
  return {
    score: score - (positions[positions.length - 1] - positions[0]) * 0.2 - t.length * 0.05,
    positions
  }
}

export function quickOpen(
  query: string,
  binder: BinderNode[],
  entities: Entity[],
  actions: { id: string; title: string; subtitle: string }[] = []
): PaletteItem[] {
  const paths = folderPaths(binder)
  const candidates: PaletteItem[] = []

  walk(binder, (node) => {
    if (node.type !== 'doc') return
    candidates.push({
      kind: 'doc',
      id: node.id,
      title: node.title,
      subtitle: paths.get(node.id) ?? '',
      positions: [],
      score: 0
    })
  })
  for (const entity of entities) {
    candidates.push({
      kind: 'entity',
      id: entity.id,
      title: entity.name,
      subtitle: entityTypeLabel(entity.type),
      positions: [],
      score: 0
    })
  }
  for (const action of actions) {
    candidates.push({ kind: 'action', ...action, positions: [], score: 0 })
  }

  const trimmed = query.trim()
  if (trimmed === '') {
    // Empty query: offer everything, documents before entries before actions,
    // so ⌘K with no typing is still a usable jump list.
    const rank = { doc: 0, entity: 1, action: 2 }
    return candidates.sort((a, b) => rank[a.kind] - rank[b.kind] || a.title.localeCompare(b.title))
  }

  const scored: PaletteItem[] = []
  for (const item of candidates) {
    const match = fuzzyMatch(trimmed, item.title)
    if (match) {
      scored.push({ ...item, score: match.score, positions: match.positions })
      continue
    }
    // Fall back to the subtitle so "part one" finds the scenes inside it.
    const viaSubtitle = fuzzyMatch(trimmed, item.subtitle)
    if (viaSubtitle) scored.push({ ...item, score: viaSubtitle.score - 6, positions: [] })
  }
  return scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
}
