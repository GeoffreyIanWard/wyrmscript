import { beforeEach, describe, expect, it } from 'vitest'
import type { BinderNode } from '../src/shared/types'
import {
  findNode,
  firstDoc,
  isDescendant,
  moveNode,
  removeNode,
  walk
} from '../src/renderer/src/lib/tree'

function fixture(): BinderNode[] {
  return [
    {
      id: 'manuscript',
      type: 'folder',
      title: 'Manuscript',
      children: [
        {
          id: 'part1',
          type: 'folder',
          title: 'Part One',
          children: [
            { id: 'scene1', type: 'doc', title: 'Scene 1' },
            { id: 'scene2', type: 'doc', title: 'Scene 2' }
          ]
        },
        { id: 'part2', type: 'folder', title: 'Part Two', children: [] }
      ]
    },
    {
      id: 'notes',
      type: 'folder',
      title: 'Notes',
      children: [{ id: 'timeline', type: 'doc', title: 'Timeline' }]
    }
  ]
}

function ids(nodes: BinderNode[]): string[] {
  const out: string[] = []
  walk(nodes, (n) => out.push(n.id))
  return out
}

let tree: BinderNode[]
beforeEach(() => {
  tree = fixture()
})

describe('findNode / removeNode / firstDoc / isDescendant', () => {
  it('finds nested nodes', () => {
    expect(findNode(tree, 'scene2')?.title).toBe('Scene 2')
    expect(findNode(tree, 'nope')).toBeNull()
  })

  it('removes a nested node and returns it', () => {
    const removed = removeNode(tree, 'scene1')
    expect(removed?.id).toBe('scene1')
    expect(findNode(tree, 'scene1')).toBeNull()
  })

  it('finds the first doc in document order', () => {
    expect(firstDoc(tree)?.id).toBe('scene1')
  })

  it('detects descendants at any depth', () => {
    const manuscript = findNode(tree, 'manuscript')!
    expect(isDescendant(manuscript, 'scene2')).toBe(true)
    expect(isDescendant(manuscript, 'timeline')).toBe(false)
  })
})

describe('moveNode', () => {
  it('moves before a sibling', () => {
    expect(moveNode(tree, 'scene2', 'scene1', 'before')).toBe(true)
    const part1 = findNode(tree, 'part1')!
    expect(part1.children!.map((n) => n.id)).toEqual(['scene2', 'scene1'])
  })

  it('moves after a target in another parent', () => {
    expect(moveNode(tree, 'timeline', 'scene1', 'after')).toBe(true)
    const part1 = findNode(tree, 'part1')!
    expect(part1.children!.map((n) => n.id)).toEqual(['scene1', 'timeline', 'scene2'])
    expect(findNode(tree, 'notes')!.children).toHaveLength(0)
  })

  it('moves inside a folder (prepends)', () => {
    expect(moveNode(tree, 'scene1', 'part2', 'inside')).toBe(true)
    expect(findNode(tree, 'part2')!.children!.map((n) => n.id)).toEqual(['scene1'])
  })

  it('refuses to drop a folder into its own descendant', () => {
    const before = ids(tree)
    expect(moveNode(tree, 'manuscript', 'scene1', 'inside')).toBe(false)
    expect(ids(tree)).toEqual(before)
  })

  it('refuses a self-drop', () => {
    const before = ids(tree)
    expect(moveNode(tree, 'scene1', 'scene1', 'after')).toBe(false)
    expect(ids(tree)).toEqual(before)
  })

  it("dropping 'inside' a doc fails without losing the node", () => {
    expect(moveNode(tree, 'scene1', 'timeline', 'inside')).toBe(false)
    expect(findNode(tree, 'scene1')).not.toBeNull()
    expect(ids(tree).sort()).toEqual(ids(fixture()).sort())
  })
})
