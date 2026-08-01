import type { Entity } from '../../../shared/types'

/**
 * F-13: nesting for `world` entities via `Entity.parentId`. Pure helpers
 * over the entity list — the tree is never materialized as its own
 * structure, just walked on demand by following parent pointers.
 */

/**
 * True if setting `candidateParentId` as `childId`'s parent would create a
 * cycle — either the candidate *is* the child, or the candidate is already
 * a descendant of the child (which would make the child its own ancestor).
 * Called before saving a parent choice, not after, so a cycle can never
 * actually be written.
 */
export function wouldCreateCycle(
  entities: Entity[],
  childId: string,
  candidateParentId: string
): boolean {
  if (childId === candidateParentId) return true
  const byId = new Map(entities.map((e) => [e.id, e]))
  let current: string | undefined = candidateParentId
  const seen = new Set<string>()
  while (current) {
    if (current === childId) return true
    if (seen.has(current)) return true // already-corrupt data; stop rather than loop forever
    seen.add(current)
    current = byId.get(current)?.parentId
  }
  return false
}

/**
 * The full chain from the topmost ancestor down to and including
 * `entityId` itself — e.g. [Narrow Coast, Harrowgate, The Drowned Quarter].
 * A lone entity with no parent returns a chain of just itself. Guards
 * against a cycle in stored data (which `wouldCreateCycle` prevents at
 * write time, but hand-edited frontmatter could still introduce one) by
 * stopping rather than looping forever.
 */
export function locationChain(entities: Entity[], entityId: string): Entity[] {
  const byId = new Map(entities.map((e) => [e.id, e]))
  const chain: Entity[] = []
  let current = byId.get(entityId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    chain.unshift(current)
    seen.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return chain
}
