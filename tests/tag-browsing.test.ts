import { describe, expect, it } from 'vitest'
import { entitiesWithTag, tagCounts } from '../src/renderer/src/lib/tags'

/**
 * F-34: the tag wall's order is the whole feature — "most-used first" is what
 * makes a wall of tags navigable rather than a pile. These cover the ordering
 * and the counting edge cases; the page itself is a thin filter over them.
 */

const bible = [
  { name: 'Elara', tags: ['House Voss', 'gun'] },
  { name: 'Hatterknax', tags: ['gun', 'wizard'] },
  { name: 'The Wyrm', tags: ['gun'] },
  { name: 'Lair', tags: ['dungeon'] },
  { name: 'Untagged' }
]

describe('counting tags across the story bible', () => {
  it('orders by usage, most-used first', () => {
    expect(tagCounts(bible).map((t) => t.tag)[0]).toBe('gun')
    expect(tagCounts(bible)[0].count).toBe(3)
  })

  it('breaks ties alphabetically rather than by insertion order', () => {
    // 'House Voss', 'wizard' and 'dungeon' are all used once. Insertion order
    // would put 'House Voss' first by accident; the tie-break should be
    // deliberate and human-sensible.
    const ones = tagCounts(bible)
      .filter((t) => t.count === 1)
      .map((t) => t.tag)

    expect(ones).toEqual(['dungeon', 'House Voss', 'wizard'])
  })

  it('counts an entity once even if it carries the same tag twice', () => {
    // Frontmatter is hand-editable plain text, so `addTag`'s dedupe is not
    // the only way a tag list is written.
    const counts = tagCounts([{ tags: ['gun', 'gun'] }])

    expect(counts).toEqual([{ tag: 'gun', count: 1 }])
  })

  it('ignores entries with no tags at all', () => {
    expect(tagCounts([{}, { tags: [] }])).toEqual([])
  })

  it('keeps differently-cased tags separate, matching how they are stored', () => {
    // `addTag` dedupes on exact match, so these already are two distinct tags
    // everywhere else in the app — merging them only here would misrepresent
    // the data and make the button ambiguous.
    const counts = tagCounts([{ tags: ['Gun'] }, { tags: ['gun'] }])

    expect(counts).toHaveLength(2)
  })
})

describe('filtering by a tag', () => {
  it('returns every entry carrying the tag, and nothing else', () => {
    expect(entitiesWithTag(bible, 'gun').map((e) => e.name)).toEqual([
      'Elara',
      'Hatterknax',
      'The Wyrm'
    ])
  })

  it('returns nothing for a tag no one carries', () => {
    expect(entitiesWithTag(bible, 'nonesuch')).toEqual([])
  })

  it('does not match on a partial tag', () => {
    // 'gun' must not sweep in a hypothetical 'gunpowder' — these are discrete
    // labels, not a search box.
    expect(entitiesWithTag([{ tags: ['gunpowder'] }], 'gun')).toEqual([])
  })
})
