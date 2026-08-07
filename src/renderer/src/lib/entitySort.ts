import {
  CHARACTER_PINS,
  type CharacterPin,
  type Entity,
  type EntitySortMode
} from '../../../shared/types'

/**
 * F-32/F-33: one sort routine behind every story-bible list, so "what order
 * do entries appear in" is decided once rather than per-component. Each mode
 * always falls back to alphabetical for ties (including entries that tie on
 * having no tag/pin at all) — a sort that can't break a tie reads as visibly
 * unstable the moment two untagged entries swap places for no reason.
 */

/** Character Book only offers `pin`, since CHARACTER_PINS is the only pin
 *  vocabulary that exists today — World Book and Glossary entities carry no
 *  pins to rank by. */
export function sortModesFor(type: Entity['type']): EntitySortMode[] {
  return type === 'character' ? ['pin', 'tag', 'alphabetical'] : ['alphabetical', 'tag']
}

/** F-32: subsumed as `pin` mode's pre-selected default for Character Book,
 *  rather than a separate always-on rule layered under the sort toggle. */
export function defaultSortMode(type: Entity['type']): EntitySortMode {
  return type === 'character' ? 'pin' : 'alphabetical'
}

function tagSortKey(entity: Entity): string | null {
  const tags = entity.tags
  if (!tags || tags.length === 0) return null
  // Alphabetically-first, not first-added — a tag added last should not
  // change where an entry sorts relative to one whose tags happen to have
  // been typed in a different order.
  return [...tags].sort((a, b) => a.localeCompare(b))[0]
}

function compareByTag(a: Entity, b: Entity): number {
  const keyA = tagSortKey(a)
  const keyB = tagSortKey(b)
  if (keyA === null && keyB === null) return a.name.localeCompare(b.name)
  if (keyA === null) return 1 // untagged sorts after every tagged entry
  if (keyB === null) return -1
  return keyA.localeCompare(keyB) || a.name.localeCompare(b.name)
}

/** Lower is more significant. An entry with several pins ranks by the most
 *  significant one it holds, not the least — a Protagonist who is also
 *  tagged Viewpoint Character still reads as the Protagonist first. No pin
 *  ranks after every pinned entry, same shape as `tagSortKey`'s untagged
 *  case. */
function pinPriority(entity: Entity): number {
  const held = (entity.pins ?? [])
    .map((pin) => CHARACTER_PINS.indexOf(pin as CharacterPin))
    .filter((index) => index >= 0)
  return held.length > 0 ? Math.min(...held) : CHARACTER_PINS.length
}

function compareByPin(a: Entity, b: Entity): number {
  const diff = pinPriority(a) - pinPriority(b)
  return diff !== 0 ? diff : a.name.localeCompare(b.name)
}

export function sortEntities(entities: Entity[], mode: EntitySortMode): Entity[] {
  const sorted = [...entities]
  if (mode === 'tag') return sorted.sort(compareByTag)
  if (mode === 'pin') return sorted.sort(compareByPin)
  return sorted.sort((a, b) => a.name.localeCompare(b.name))
}
