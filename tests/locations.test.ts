import { describe, expect, it } from 'vitest'
import type { Entity } from '../src/shared/types'
import { locationChain, wouldCreateCycle } from '../src/renderer/src/lib/locations'

function place(id: string, name: string, parentId?: string): Entity {
  const now = new Date().toISOString()
  return { id, type: 'world', name, aliases: [], body: '', parentId, created: now, modified: now }
}

describe('locationChain', () => {
  it('returns just the entity itself when it has no parent', () => {
    const country = place('country', 'Narrow Coast')
    expect(locationChain([country], 'country')).toEqual([country])
  })

  it('returns the full chain from the topmost ancestor down to the entity', () => {
    const country = place('country', 'Narrow Coast')
    const city = place('city', 'Harrowgate', 'country')
    const quarter = place('quarter', 'The Drowned Quarter', 'city')
    const all = [country, city, quarter]
    expect(locationChain(all, 'quarter')).toEqual([country, city, quarter])
  })

  it('stops rather than looping forever if stored data has a cycle', () => {
    const a = place('a', 'A', 'b')
    const b = place('b', 'B', 'a')
    // Should terminate and return a partial chain, not hang.
    expect(locationChain([a, b], 'a').length).toBeGreaterThan(0)
  })

  it('returns [] for an id not in the list', () => {
    expect(locationChain([place('a', 'A')], 'missing')).toEqual([])
  })
})

describe('wouldCreateCycle', () => {
  it('is true when the candidate parent is the entity itself', () => {
    expect(wouldCreateCycle([place('a', 'A')], 'a', 'a')).toBe(true)
  })

  it('is true when the candidate parent is already a descendant', () => {
    const country = place('country', 'Narrow Coast')
    const city = place('city', 'Harrowgate', 'country')
    // Setting country's parent to city would make country its own descendant.
    expect(wouldCreateCycle([country, city], 'country', 'city')).toBe(true)
  })

  it('is false for an unrelated candidate parent', () => {
    const a = place('a', 'A')
    const b = place('b', 'B')
    expect(wouldCreateCycle([a, b], 'a', 'b')).toBe(false)
  })

  it('is false when setting a grandchild-unrelated ancestor', () => {
    const country = place('country', 'Narrow Coast')
    const city = place('city', 'Harrowgate')
    const quarter = place('quarter', 'The Drowned Quarter')
    // quarter has no relation to country or city yet.
    expect(wouldCreateCycle([country, city, quarter], 'quarter', 'city')).toBe(false)
  })
})
