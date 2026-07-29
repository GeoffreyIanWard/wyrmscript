import type { BinderNode } from '../../../shared/types'

export function findNode(nodes: BinderNode[], id: string): BinderNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const hit = node.children ? findNode(node.children, id) : null
    if (hit) return hit
  }
  return null
}

/** Remove a node from the tree in place. Returns the removed node, if found. */
export function removeNode(nodes: BinderNode[], id: string): BinderNode | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return nodes.splice(i, 1)[0]
    const children = nodes[i].children
    if (children) {
      const hit = removeNode(children, id)
      if (hit) return hit
    }
  }
  return null
}

export function isDescendant(node: BinderNode, id: string): boolean {
  return (node.children ?? []).some((c) => c.id === id || isDescendant(c, id))
}

export function walk(
  nodes: BinderNode[],
  visit: (node: BinderNode, depth: number) => void,
  depth = 0
): void {
  for (const node of nodes) {
    visit(node, depth)
    if (node.children) walk(node.children, visit, depth + 1)
  }
}

export function firstDoc(nodes: BinderNode[]): BinderNode | null {
  for (const node of nodes) {
    if (node.type === 'doc') return node
    const hit = node.children ? firstDoc(node.children) : null
    if (hit) return hit
  }
  return null
}

export type DropPosition = 'before' | 'after' | 'inside'

/**
 * Move a node relative to a target node. Mutates the tree in place.
 * Returns false (and leaves the tree untouched) for illegal moves.
 */
export function moveNode(
  nodes: BinderNode[],
  dragId: string,
  targetId: string,
  position: DropPosition
): boolean {
  if (dragId === targetId) return false
  const dragged = findNode(nodes, dragId)
  if (!dragged) return false
  if (isDescendant(dragged, targetId)) return false

  removeNode(nodes, dragId)

  if (position === 'inside') {
    const target = findNode(nodes, targetId)
    if (!target || target.type !== 'folder') {
      nodes.push(dragged)
      return false
    }
    target.children = target.children ?? []
    target.children.unshift(dragged)
    return true
  }

  const insertBeside = (siblings: BinderNode[]): boolean => {
    const index = siblings.findIndex((n) => n.id === targetId)
    if (index !== -1) {
      siblings.splice(position === 'before' ? index : index + 1, 0, dragged)
      return true
    }
    return siblings.some((n) => (n.children ? insertBeside(n.children) : false))
  }

  if (!insertBeside(nodes)) {
    nodes.push(dragged) // target vanished — keep the node reachable at root
    return false
  }
  return true
}
