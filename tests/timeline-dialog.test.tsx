// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DocFile, ProjectInfo } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { TimelineDialog } from '../src/renderer/src/components/TimelineDialog'

/**
 * F-02: the timeline is a read-through view over scene-tagged documents, not
 * a separate store of its own — so these tests drive the real dialog against
 * a mocked `readAllDocs` and assert on the store actions it calls, the same
 * shape as the entity editor's tests.
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
    setTimelineOrder: ReturnType<typeof vi.fn>
    setTimelineDate: ReturnType<typeof vi.fn>
    showDoc: ReturnType<typeof vi.fn>
    selectDoc: ReturnType<typeof vi.fn>
  }> = {}
): Promise<void> {
  vi.spyOn(api, 'readAllDocs').mockResolvedValue(docs)
  useWyrm.setState({
    project: makeProject(),
    setTimelineOrder: overrides.setTimelineOrder ?? vi.fn(),
    setTimelineDate: overrides.setTimelineDate ?? vi.fn(),
    showDoc: overrides.showDoc ?? vi.fn(),
    selectDoc: overrides.selectDoc ?? (async () => {})
  })
  await act(async () => {
    render(<TimelineDialog onClose={() => {}} />)
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useWyrm.setState({ project: null })
})

describe('TimelineDialog', () => {
  it('shows an empty state when no document is tagged scene', async () => {
    await renderDialog([doc('a', 'A')])
    expect(screen.getByText(/No scenes yet/)).toBeTruthy()
  })

  it('lists scene-tagged documents in binder order by default', async () => {
    await renderDialog([doc('b', 'B', { tags: ['scene'] }), doc('a', 'A', { tags: ['scene'] })])
    const titles = screen.getAllByRole('button', { name: /^[AB]$/ }).map((el) => el.textContent)
    expect(titles).toEqual(['A', 'B'])
  })

  it('shows an explicit timelineOrder ahead of binder order', async () => {
    await renderDialog([
      doc('a', 'A', { tags: ['scene'] }),
      doc('b', 'B', { tags: ['scene'], timelineOrder: -1 })
    ])
    const titles = screen.getAllByRole('button', { name: /^[AB]$/ }).map((el) => el.textContent)
    expect(titles).toEqual(['B', 'A'])
  })

  it('opens the manuscript and selects the doc when a card is clicked', async () => {
    const showDoc = vi.fn()
    const selectDoc = vi.fn(async () => {})
    await renderDialog([doc('a', 'A', { tags: ['scene'] })], { showDoc, selectDoc })

    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    expect(showDoc).toHaveBeenCalled()
    expect(selectDoc).toHaveBeenCalledWith('a')
  })

  it('saves a typed date label on blur', async () => {
    const setTimelineDate = vi.fn()
    await renderDialog([doc('a', 'A', { tags: ['scene'] })], { setTimelineDate })

    const input = screen.getByPlaceholderText('+ date')
    fireEvent.change(input, { target: { value: 'Year 3, first thaw' } })
    fireEvent.blur(input)

    expect(setTimelineDate).toHaveBeenCalledWith('a', 'Year 3, first thaw')
  })

  it('does not call setTimelineDate when the date is unchanged', async () => {
    const setTimelineDate = vi.fn()
    await renderDialog([doc('a', 'A', { tags: ['scene'], timelineDate: 'Spring' })], {
      setTimelineDate
    })

    const input = screen.getByPlaceholderText('+ date')
    fireEvent.blur(input)
    expect(setTimelineDate).not.toHaveBeenCalled()
  })

  // Regression: a drag reorder persisted correctly but the dialog kept
  // rendering its stale, fetched-once doc list, so the visible order never
  // changed until the dialog was closed and reopened.
  it('re-renders in the new order immediately after a drop, with no remount', async () => {
    await renderDialog([
      doc('a', 'A', { tags: ['scene'] }),
      doc('b', 'B', { tags: ['scene'] }),
      doc('c', 'C', { tags: ['scene'] })
    ])
    expect(screen.getAllByRole('button', { name: /^[ABC]$/ }).map((el) => el.textContent)).toEqual([
      'A',
      'B',
      'C'
    ])

    const rows = document.querySelectorAll('.timeline-row')
    fireEvent.drop(rows[0], { dataTransfer: { getData: () => 'c' } })

    expect(screen.getAllByRole('button', { name: /^[ABC]$/ }).map((el) => el.textContent)).toEqual([
      'C',
      'A',
      'B'
    ])
  })

  it('keeps a dragged card in its new position after a second, unrelated reorder', async () => {
    await renderDialog([
      doc('a', 'A', { tags: ['scene'] }),
      doc('b', 'B', { tags: ['scene'] }),
      doc('c', 'C', { tags: ['scene'] })
    ])

    // Move C to the front, then move B to the front — C must not snap back.
    fireEvent.drop(document.querySelectorAll('.timeline-row')[0], {
      dataTransfer: { getData: () => 'c' }
    })
    fireEvent.drop(document.querySelectorAll('.timeline-row')[0], {
      dataTransfer: { getData: () => 'b' }
    })

    expect(screen.getAllByRole('button', { name: /^[ABC]$/ }).map((el) => el.textContent)).toEqual([
      'B',
      'C',
      'A'
    ])
  })
})
