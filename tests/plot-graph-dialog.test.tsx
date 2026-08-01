// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DocFile, ProjectInfo } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { PlotGraphDialog } from '../src/renderer/src/components/PlotGraphDialog'

/**
 * F-03: tension is set purely by dragging a node vertically, with the same
 * click-vs-drag ambiguity as F-29's line view (no separate drag handle) —
 * these tests drive that pointer sequence directly rather than asserting on
 * internal state.
 */

function doc(id: string, title: string, overrides: Partial<DocFile['meta']> = {}): DocFile {
  const now = new Date().toISOString()
  return {
    meta: { id, title, created: now, modified: now, ...overrides },
    body: ''
  }
}

function makeProject(): ProjectInfo {
  return {
    path: '/demo',
    data: {
      version: 1,
      title: 'T',
      binder: [
        {
          id: 'folder-1',
          type: 'folder',
          title: 'Manuscript',
          children: [
            { id: 'a', type: 'doc', title: 'A' },
            { id: 'b', type: 'doc', title: 'B' }
          ]
        }
      ],
      trash: []
    }
  }
}

async function renderDialog(
  docs: DocFile[],
  overrides: Partial<{
    setTension: ReturnType<typeof vi.fn>
    showDoc: ReturnType<typeof vi.fn>
    selectDoc: ReturnType<typeof vi.fn>
  }> = {}
): Promise<void> {
  vi.spyOn(api, 'readAllDocs').mockResolvedValue(docs)
  useWyrm.setState({
    project: makeProject(),
    setTension: overrides.setTension ?? vi.fn(),
    showDoc: overrides.showDoc ?? vi.fn(),
    selectDoc: overrides.selectDoc ?? (async () => {})
  })
  await act(async () => {
    render(<PlotGraphDialog onClose={() => {}} />)
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useWyrm.setState({ project: null })
})

describe('PlotGraphDialog', () => {
  it('shows an empty state when no document is tagged scene', async () => {
    await renderDialog([doc('a', 'A')])
    expect(screen.getByText(/No scenes yet/)).toBeTruthy()
  })

  it('renders a node for every scene-tagged document', async () => {
    await renderDialog([doc('a', 'A', { tags: ['scene'] }), doc('b', 'B', { tags: ['scene'] })])
    expect(document.querySelectorAll('.plot-graph-node')).toHaveLength(2)
  })

  it('treats a small pointer movement as a click, opening the card', async () => {
    const showDoc = vi.fn()
    const selectDoc = vi.fn(async () => {})
    await renderDialog([doc('a', 'Scene A', { tags: ['scene'] })], { showDoc, selectDoc })

    const node = screen.getByRole('button', { name: /Scene A/ })
    fireEvent.pointerDown(node, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(node, { clientY: 102, pointerId: 1 })
    fireEvent.pointerUp(node, { clientY: 102, pointerId: 1 })

    expect(showDoc).toHaveBeenCalled()
    expect(selectDoc).toHaveBeenCalledWith('a')
  })

  it('sets tension by dragging the node up, clamped and rounded on release', async () => {
    const setTension = vi.fn()
    await renderDialog([doc('a', 'Scene A', { tags: ['scene'] })], { setTension })
    const node = screen.getByRole('button', { name: /Scene A/ })
    // Untouched scene starts at the default (5). Dragging up (negative dy)
    // raises tension — 48px up at 24px/tension-unit is 2 units.
    fireEvent.pointerDown(node, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(node, { clientY: 52, pointerId: 1 })
    fireEvent.pointerUp(node, { clientY: 52, pointerId: 1 })

    expect(setTension).toHaveBeenCalledWith('a', 7)
  })

  it('does not fire a drag for a movement at or below the click threshold', async () => {
    const setTension = vi.fn()
    await renderDialog([doc('a', 'Scene A', { tags: ['scene'] })], { setTension })
    const node = screen.getByRole('button', { name: /Scene A/ })
    fireEvent.pointerDown(node, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(node, { clientY: 104, pointerId: 1 })
    fireEvent.pointerUp(node, { clientY: 104, pointerId: 1 })

    expect(setTension).not.toHaveBeenCalled()
  })

  it('clamps a drag past the top of the scale to the maximum', async () => {
    const setTension = vi.fn()
    await renderDialog([doc('a', 'Scene A', { tags: ['scene'], tension: 9 })], { setTension })
    const node = screen.getByRole('button', { name: /Scene A/ })
    fireEvent.pointerDown(node, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(node, { clientY: 0, pointerId: 1 }) // way up
    fireEvent.pointerUp(node, { clientY: 0, pointerId: 1 })

    expect(setTension).toHaveBeenCalledWith('a', 10)
  })

  it('clamps a drag past the bottom of the scale to the minimum', async () => {
    const setTension = vi.fn()
    await renderDialog([doc('a', 'Scene A', { tags: ['scene'], tension: 1 })], { setTension })
    const node = screen.getByRole('button', { name: /Scene A/ })
    fireEvent.pointerDown(node, { clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(node, { clientY: 1000, pointerId: 1 }) // way down
    fireEvent.pointerUp(node, { clientY: 1000, pointerId: 1 })

    expect(setTension).toHaveBeenCalledWith('a', 0)
  })

  it('opens the card on Enter when it has keyboard focus', async () => {
    const showDoc = vi.fn()
    const selectDoc = vi.fn(async () => {})
    await renderDialog([doc('a', 'Scene A', { tags: ['scene'] })], { showDoc, selectDoc })
    fireEvent.keyDown(screen.getByRole('button', { name: /Scene A/ }), { key: 'Enter' })
    expect(showDoc).toHaveBeenCalled()
    expect(selectDoc).toHaveBeenCalledWith('a')
  })
})
