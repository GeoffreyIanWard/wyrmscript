import { describe, expect, it } from 'vitest'
import type { BinderNode, DocFile } from '../src/shared/types'
import { orderBetween, timelineCards } from '../src/renderer/src/lib/timeline'

function doc(id: string, title: string, overrides: Partial<DocFile['meta']> = {}): DocFile {
  const now = new Date().toISOString()
  return {
    meta: { id, title, created: now, modified: now, ...overrides },
    body: ''
  }
}

const binder: BinderNode[] = [
  {
    id: 'folder-1',
    type: 'folder',
    title: 'Manuscript',
    children: [
      { id: 'a', type: 'doc', title: 'A' },
      { id: 'b', type: 'doc', title: 'B' },
      { id: 'c', type: 'doc', title: 'C' }
    ]
  }
]

describe('timelineCards', () => {
  it('excludes documents not tagged scene', () => {
    const docs = [doc('a', 'A', { tags: ['scene'] }), doc('b', 'B', { tags: ['note'] })]
    expect(timelineCards(docs, binder).map((c) => c.id)).toEqual(['a'])
  })

  it('falls back to binder order when timelineOrder is unset', () => {
    const docs = [
      doc('c', 'C', { tags: ['scene'] }),
      doc('a', 'A', { tags: ['scene'] }),
      doc('b', 'B', { tags: ['scene'] })
    ]
    // Binder order is a, b, c regardless of the input array's order.
    expect(timelineCards(docs, binder).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by an explicit timelineOrder over binder order', () => {
    const docs = [
      doc('a', 'A', { tags: ['scene'], timelineOrder: 5 }),
      doc('b', 'B', { tags: ['scene'], timelineOrder: 1 }),
      doc('c', 'C', { tags: ['scene'], timelineOrder: 3 })
    ]
    expect(timelineCards(docs, binder).map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('carries the optional date label through without affecting order', () => {
    const docs = [doc('a', 'A', { tags: ['scene'], timelineDate: 'Year 3, first thaw' })]
    expect(timelineCards(docs, binder)[0].date).toBe('Year 3, first thaw')
  })

  it('mixes explicit and fallback order correctly', () => {
    // b has been dragged to the front; a and c fall back to binder order.
    const docs = [
      doc('a', 'A', { tags: ['scene'] }),
      doc('b', 'B', { tags: ['scene'], timelineOrder: -1 }),
      doc('c', 'C', { tags: ['scene'] })
    ]
    expect(timelineCards(docs, binder).map((c) => c.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('orderBetween', () => {
  it('returns 0 for the first card in an empty timeline', () => {
    expect(orderBetween(undefined, undefined)).toBe(0)
  })

  it('returns something less than the only card when dropped at the start', () => {
    expect(orderBetween(undefined, 5)).toBeLessThan(5)
  })

  it('returns something greater than the only card when dropped at the end', () => {
    expect(orderBetween(5, undefined)).toBeGreaterThan(5)
  })

  it('returns the midpoint when dropped between two cards', () => {
    expect(orderBetween(2, 4)).toBe(3)
  })
})
