import type { Entity } from '../../../shared/types'

/**
 * F-11: groups character entities by their first tag. F-10 deliberately
 * never added a dedicated "faction" field — a faction is just a tag on
 * `Entity` — so there's no marked field to key clustering off. Reading a
 * character's first tag as its cluster is the simplest interpretation
 * consistent with that decision; a character with no tags lands in a
 * single catch-all cluster instead of being hidden.
 */
export const UNGROUPED = 'Ungrouped'

export function clusterCharacters(characters: Entity[]): Map<string, Entity[]> {
  const clusters = new Map<string, Entity[]>()
  for (const c of characters) {
    const key = c.tags?.[0] ?? UNGROUPED
    const list = clusters.get(key)
    if (list) list.push(c)
    else clusters.set(key, [c])
  }
  return clusters
}

/**
 * Clusters ordered for layout: alphabetical, with the catch-all Ungrouped
 * cluster always last so named factions read as the "real" groups.
 */
export function orderedClusters(clusters: Map<string, Entity[]>): [string, Entity[]][] {
  return [...clusters.entries()].sort(([a], [b]) => {
    if (a === UNGROUPED) return 1
    if (b === UNGROUPED) return -1
    return a.localeCompare(b)
  })
}
