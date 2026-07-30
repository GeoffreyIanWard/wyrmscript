// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { CompileDialog } from '../src/renderer/src/components/CompileDialog'

/**
 * Drives the real store and the in-memory demo project — the point is to prove
 * the safety commit really happens before anything is written, and that the
 * selection tree actually changes what comes out.
 */

const NOTES_LINE = 'Year 0 — the Siege of the Narrows.'
const SCENE_LINE = 'The knock came an hour past midnight'

async function openDialog(): Promise<void> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved' })
  render(<CompileDialog onClose={() => {}} />)
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Notes' })).toBeTruthy())
}

function previewText(): string {
  return document.querySelector('.compile-preview')?.textContent ?? ''
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ project: null, booted: false })
})

describe('compile dialog', () => {
  it('previews every document in binder order by default', async () => {
    await openDialog()
    await waitFor(() => expect(previewText()).toContain(SCENE_LINE))
    const preview = previewText()
    expect(preview).toContain('The last of the wyrmlight')
    expect(preview).toContain(NOTES_LINE)
    expect(preview.indexOf('The last of the wyrmlight')).toBeLessThan(preview.indexOf(SCENE_LINE))
  })

  it('commits a checkpoint before it writes anything', async () => {
    const commit = vi.spyOn(api, 'commit')
    const exportFile = vi.spyOn(api, 'exportFile')
    await openDialog()
    await waitFor(() => expect(previewText()).toContain(SCENE_LINE))

    fireEvent.click(screen.getByRole('button', { name: 'Compile' }))

    await waitFor(() => expect(exportFile).toHaveBeenCalled())
    expect(commit).toHaveBeenCalledWith(expect.any(String), 'Auto: before compile')
    // Ordering is the whole point: an export must never precede its checkpoint.
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(exportFile.mock.invocationCallOrder[0])
    const [name, data] = exportFile.mock.calls[0]
    expect(name).toBe('The Wyrm of Winter.txt')
    expect(String(data)).toContain(SCENE_LINE)
    await waitFor(() => expect(screen.getByText(/WRITTEN TO/)).toBeTruthy())
  })

  it('drops a folder from the output when it is unticked', async () => {
    await openDialog()
    await waitFor(() => expect(previewText()).toContain(NOTES_LINE))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Notes' }))

    await waitFor(() => expect(previewText()).not.toContain(NOTES_LINE))
    expect(previewText()).toContain(SCENE_LINE)
  })

  it('disables Compile when nothing is selected', async () => {
    await openDialog()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Notes' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Manuscript' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Compile' }).hasAttribute('disabled')).toBe(true)
    )
    expect(screen.getByText(/Nothing selected yet/)).toBeTruthy()
  })

  it('switching to Markdown keeps the marks that plain text drops', async () => {
    await openDialog()
    await waitFor(() => expect(previewText()).toContain(SCENE_LINE))
    expect(previewText()).not.toContain('**Exactly**')

    fireEvent.click(screen.getByRole('radio', { name: 'Markdown (.md)' }))

    await waitFor(() => expect(previewText()).toContain('**Exactly**'))
    expect(previewText()).toContain('==the first thing the sea took==')
  })

  it('reports a failed export in the dialog instead of taking the app down', async () => {
    vi.spyOn(api, 'exportFile').mockRejectedValue(new Error('Disk is full'))
    await openDialog()
    await waitFor(() => expect(previewText()).toContain(SCENE_LINE))

    fireEvent.click(screen.getByRole('button', { name: 'Compile' }))

    await waitFor(() => expect(screen.getByText('Disk is full')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Compile' })).toBeTruthy()
  })
})
