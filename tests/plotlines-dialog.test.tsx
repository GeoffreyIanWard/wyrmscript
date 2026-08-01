// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DocFile, Plotline, ProjectInfo } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { PlotlinesDialog } from '../src/renderer/src/components/PlotlinesDialog'

/**
 * F-04: a plotline is a lightweight record scenes join by tag (matching the
 * plotline's name), not by a stored id — these tests drive the real dialog
 * against a mocked project rather than asserting on internal state.
 */

function doc(id: string, title: string, overrides: Partial<DocFile['meta']> = {}): DocFile {
  const now = new Date().toISOString()
  return {
    meta: { id, title, created: now, modified: now, ...overrides },
    body: ''
  }
}

function plotline(overrides: Partial<Plotline> = {}): Plotline {
  const now = new Date().toISOString()
  return {
    id: 'pl-1',
    name: 'The Siege of the Narrows',
    colour: '#8b2e2e',
    status: 'open',
    created: now,
    modified: now,
    ...overrides
  }
}

function makeProject(): ProjectInfo {
  return {
    path: '/demo',
    data: { version: 1, title: 'T', binder: [], trash: [] }
  }
}

async function renderDialog(
  plotlines: Plotline[],
  docs: DocFile[] = [],
  overrides: Partial<{
    createPlotline: ReturnType<typeof vi.fn>
    savePlotline: ReturnType<typeof vi.fn>
    deletePlotline: ReturnType<typeof vi.fn>
    showDoc: ReturnType<typeof vi.fn>
    selectDoc: ReturnType<typeof vi.fn>
  }> = {}
): Promise<void> {
  vi.spyOn(api, 'readAllDocs').mockResolvedValue(docs)
  vi.spyOn(api, 'listPlotlines').mockResolvedValue(plotlines)
  useWyrm.setState({
    project: makeProject(),
    plotlines: [],
    loadPlotlines: async () => {
      useWyrm.setState({ plotlines })
    },
    createPlotline: overrides.createPlotline ?? vi.fn(async () => null),
    savePlotline: overrides.savePlotline ?? vi.fn(async () => {}),
    deletePlotline: overrides.deletePlotline ?? vi.fn(async () => {}),
    showDoc: overrides.showDoc ?? vi.fn(),
    selectDoc: overrides.selectDoc ?? (async () => {})
  })
  await act(async () => {
    render(<PlotlinesDialog onClose={() => {}} />)
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useWyrm.setState({ project: null, plotlines: [] })
})

describe('PlotlinesDialog', () => {
  it('shows an empty state when there are no plotlines', async () => {
    await renderDialog([])
    expect(screen.getByText(/No plotlines yet/)).toBeTruthy()
  })

  it('lists every plotline with its status', async () => {
    await renderDialog([
      plotline({ id: 'a', name: 'Romance', status: 'open' }),
      plotline({ id: 'b', name: 'The Old Debt', status: 'resolved' })
    ])
    expect(screen.getByDisplayValue('Romance')).toBeTruthy()
    expect(screen.getByDisplayValue('The Old Debt')).toBeTruthy()
    expect(screen.getByText('OPEN')).toBeTruthy()
    expect(screen.getByText('RESOLVED')).toBeTruthy()
  })

  it('creates a plotline from the add field on Enter', async () => {
    const createPlotline = vi.fn(async () => null)
    await renderDialog([], [], { createPlotline })

    const input = screen.getByPlaceholderText('New plotline name…')
    fireEvent.change(input, { target: { value: 'Romance' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(createPlotline).toHaveBeenCalledWith('Romance')
  })

  it('does not create a blank plotline', async () => {
    const createPlotline = vi.fn(async () => null)
    await renderDialog([], [], { createPlotline })

    const input = screen.getByPlaceholderText('New plotline name…')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(createPlotline).not.toHaveBeenCalled()
  })

  it('renames a plotline on blur, only when the name changed', async () => {
    const savePlotline = vi.fn(async () => {})
    await renderDialog([plotline({ name: 'Romance' })], [], { savePlotline })

    const input = screen.getByDisplayValue('Romance')
    fireEvent.blur(input)
    expect(savePlotline).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'The Romance Plot' } })
    fireEvent.blur(input)
    expect(savePlotline).toHaveBeenCalledWith(expect.objectContaining({ name: 'The Romance Plot' }))
  })

  it('toggles status between open and resolved', async () => {
    const savePlotline = vi.fn(async () => {})
    await renderDialog([plotline({ status: 'open' })], [], { savePlotline })

    fireEvent.click(screen.getByText('OPEN'))
    expect(savePlotline).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved' }))
  })

  it('deletes a plotline', async () => {
    const deletePlotline = vi.fn(async () => {})
    await renderDialog([plotline()], [], { deletePlotline })

    fireEvent.click(screen.getByText('Delete'))
    expect(deletePlotline).toHaveBeenCalled()
  })

  it('counts and lists only scenes tagged with the plotline’s name', async () => {
    await renderDialog(
      [plotline({ name: 'Romance' })],
      [
        doc('a', 'Scene A', { tags: ['scene', 'Romance'] }),
        doc('b', 'Scene B', { tags: ['scene'] }),
        doc('c', 'Not a scene', { tags: ['Romance'] })
      ]
    )
    expect(screen.getByText('1 scene')).toBeTruthy()
  })

  it('identifies setup and payoff scenes by their pins', async () => {
    await renderDialog(
      [plotline({ name: 'Romance' })],
      [
        doc('a', 'First Kiss', { tags: ['scene', 'Romance'], pins: ['Setup'] }),
        doc('b', 'The Wedding', { tags: ['scene', 'Romance'], pins: ['Resolution'] })
      ]
    )
    expect(screen.getByRole('button', { name: 'First Kiss' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'The Wedding' })).toBeTruthy()
  })

  it('opens a scene and closes the dialog when its link is clicked', async () => {
    const showDoc = vi.fn()
    const selectDoc = vi.fn(async () => {})
    await renderDialog(
      [plotline({ name: 'Romance' })],
      [doc('a', 'First Kiss', { tags: ['scene', 'Romance'], pins: ['Setup'] })],
      { showDoc, selectDoc }
    )
    fireEvent.click(screen.getByRole('button', { name: 'First Kiss' }))
    expect(showDoc).toHaveBeenCalled()
    expect(selectDoc).toHaveBeenCalledWith('a')
  })
})
