import { describe, expect, it } from 'vitest'
import type { Entity } from '../src/shared/types'
import {
  clusterCharacters,
  orderedClusters,
  UNGROUPED
} from '../src/renderer/src/lib/characterGraph'

function character(id: string, name: string, tags?: string[]): Entity {
  const now = new Date().toISOString()
  return { id, type: 'character', name, aliases: [], body: '', tags, created: now, modified: now }
}

describe('clusterCharacters', () => {
  it('groups characters by their first tag', () => {
    const a = character('a', 'Elara', ['House Voss'])
    const b = character('b', 'Marten', ['House Voss'])
    const c = character('c', 'Renn', ['House Ferro'])
    const clusters = clusterCharacters([a, b, c])
    expect(clusters.get('House Voss')).toEqual([a, b])
    expect(clusters.get('House Ferro')).toEqual([c])
  })

  it('uses only the first tag when a character has several', () => {
    const a = character('a', 'Elara', ['House Voss', 'Protagonist-adjacent'])
    const clusters = clusterCharacters([a])
    expect(clusters.get('House Voss')).toEqual([a])
    expect(clusters.has('Protagonist-adjacent')).toBe(false)
  })

  it('puts untagged characters in a single Ungrouped cluster', () => {
    const a = character('a', 'Elara')
    const b = character('b', 'Marten')
    const clusters = clusterCharacters([a, b])
    expect(clusters.get(UNGROUPED)).toEqual([a, b])
  })
})

describe('orderedClusters', () => {
  it('sorts named clusters alphabetically', () => {
    const clusters = new Map([
      ['House Voss', [character('a', 'Elara')]],
      ['House Ferro', [character('b', 'Renn')]]
    ])
    expect(orderedClusters(clusters).map(([key]) => key)).toEqual(['House Ferro', 'House Voss'])
  })

  it('always places Ungrouped last, regardless of alphabetical order', () => {
    const clusters = new Map([
      [UNGROUPED, [character('a', 'Elara')]],
      ['Aardvarks', [character('b', 'Renn')]]
    ])
    expect(orderedClusters(clusters).map(([key]) => key)).toEqual(['Aardvarks', UNGROUPED])
  })
})
