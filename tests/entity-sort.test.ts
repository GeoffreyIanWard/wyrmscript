import { describe, expect, it } from 'vitest'
import type { Entity } from '../src/shared/types'
import { defaultSortMode, sortEntities, sortModesFor } from '../src/renderer/src/lib/entitySort'

/**
 * F-32/F-33: one sort routine behind every story-bible list. The two open
 * questions the roadmap flagged were settled directly here — pin ranking is
 * a fixed priority over the most significant pin an entry holds, not "any
 * pin beats none"; tag ranking uses the alphabetically-first tag, with
 * untagged entries sorting last, not first.
 */

function entity(overrides: Partial<Entity> & { id: string; name: string }): Entity {
  const now = new Date().toISOString()
  return { type: 'character', aliases: [], body: '', created: now, modified: now, ...overrides }
}

describe('sortModesFor / defaultSortMode', () => {
  it('offers Pin only for characters, since no other collection has a pin vocabulary', () => {
    expect(sortModesFor('character')).toContain('pin')
    expect(sortModesFor('world')).not.toContain('pin')
    expect(sortModesFor('glossary')).not.toContain('pin')
  })

  it('defaults Character Book to Pin (F-32), everything else to alphabetical', () => {
    expect(defaultSortMode('character')).toBe('pin')
    expect(defaultSortMode('world')).toBe('alphabetical')
    expect(defaultSortMode('glossary')).toBe('alphabetical')
  })
})

describe('sortEntities: alphabetical', () => {
  it('sorts by name', () => {
    const names = sortEntities(
      [entity({ id: 'a', name: 'Wyrmlight' }), entity({ id: 'b', name: 'Ashes' })],
      'alphabetical'
    ).map((e) => e.name)
    expect(names).toEqual(['Ashes', 'Wyrmlight'])
  })
})

describe('sortEntities: tag', () => {
  it('sorts by the alphabetically-first tag, not the first-typed one', () => {
    const names = sortEntities(
      [
        entity({ id: 'a', name: 'Zed', tags: ['zebra', 'alpha'] }),
        entity({ id: 'b', name: 'Yara', tags: ['bravo'] })
      ],
      'tag'
    ).map((e) => e.name)
    // Zed's sort key is "alpha" (alphabetically first of its own tags),
    // which comes before Yara's "bravo".
    expect(names).toEqual(['Zed', 'Yara'])
  })

  it('sorts untagged entries after every tagged entry', () => {
    const names = sortEntities(
      [entity({ id: 'a', name: 'Untagged' }), entity({ id: 'b', name: 'Tagged', tags: ['zzz'] })],
      'tag'
    ).map((e) => e.name)
    expect(names).toEqual(['Tagged', 'Untagged'])
  })

  it('breaks a tie on the same tag key alphabetically by name', () => {
    const names = sortEntities(
      [
        entity({ id: 'a', name: 'Zed', tags: ['house-voss'] }),
        entity({ id: 'b', name: 'Anna', tags: ['house-voss'] })
      ],
      'tag'
    ).map((e) => e.name)
    expect(names).toEqual(['Anna', 'Zed'])
  })

  it('breaks a tie between two untagged entries alphabetically by name', () => {
    const names = sortEntities(
      [entity({ id: 'a', name: 'Zed' }), entity({ id: 'b', name: 'Anna' })],
      'tag'
    ).map((e) => e.name)
    expect(names).toEqual(['Anna', 'Zed'])
  })
})

describe('sortEntities: pin', () => {
  it('ranks Protagonist before Antagonist before Viewpoint Character before unpinned', () => {
    const names = sortEntities(
      [
        entity({ id: 'a', name: 'Unpinned' }),
        entity({ id: 'b', name: 'Viewpoint', pins: ['Viewpoint Character'] }),
        entity({ id: 'c', name: 'Antagonist', pins: ['Antagonist'] }),
        entity({ id: 'd', name: 'Protagonist', pins: ['Protagonist'] })
      ],
      'pin'
    ).map((e) => e.name)
    expect(names).toEqual(['Protagonist', 'Antagonist', 'Viewpoint', 'Unpinned'])
  })

  it('ranks by the most significant pin an entry holds, not the least', () => {
    const names = sortEntities(
      [
        entity({ id: 'a', name: 'Both', pins: ['Viewpoint Character', 'Protagonist'] }),
        entity({ id: 'b', name: 'JustAntagonist', pins: ['Antagonist'] })
      ],
      'pin'
    ).map((e) => e.name)
    // "Both" holds Protagonist (rank 0) as well as Viewpoint Character (rank
    // 2) — it must rank by the former, ahead of a plain Antagonist (rank 1).
    expect(names).toEqual(['Both', 'JustAntagonist'])
  })

  it('breaks a tie between entries with the same pin alphabetically by name', () => {
    const names = sortEntities(
      [
        entity({ id: 'a', name: 'Zed', pins: ['Protagonist'] }),
        entity({ id: 'b', name: 'Anna', pins: ['Protagonist'] })
      ],
      'pin'
    ).map((e) => e.name)
    expect(names).toEqual(['Anna', 'Zed'])
  })
})
