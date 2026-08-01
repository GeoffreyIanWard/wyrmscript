// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DocFile } from '../src/shared/types'
import { useWyrm } from '../src/renderer/src/store'
import { Editor } from '../src/renderer/src/components/Editor'

/**
 * F-10: tags are free-form and added by typing + Enter; pins toggle a closed,
 * document-scoped vocabulary from a dropdown. Both are chrome, not prose, so
 * they live in the (hover-revealed) terminal-chrome bar rather than the page.
 */

function makeDoc(overrides: Partial<DocFile['meta']> = {}): DocFile {
  const now = new Date().toISOString()
  return {
    meta: { id: 'doc-1', title: 'A Knock at Night', created: now, modified: now, ...overrides },
    body: 'Some prose.'
  }
}

async function renderEditor(doc: DocFile, updateDocMeta = vi.fn()): Promise<typeof updateDocMeta> {
  useWyrm.setState({
    activeId: doc.meta.id,
    activeDoc: doc,
    updateDocMeta: async (patch) => {
      updateDocMeta(patch)
    }
  })
  await act(async () => {
    render(<Editor />)
  })
  return updateDocMeta
}

afterEach(() => {
  cleanup()
  useWyrm.setState({ activeId: null, activeDoc: null })
})

describe('document tags', () => {
  it('renders existing tags as removable chips', async () => {
    await renderEditor(makeDoc({ tags: ['scene', 'chapter-one'] }))
    expect(screen.getByText('#scene')).toBeTruthy()
    expect(screen.getByText('#chapter-one')).toBeTruthy()
  })

  it('adds a typed tag on Enter and clears the input', async () => {
    const updateDocMeta = await renderEditor(makeDoc())
    const input = screen.getByPlaceholderText('+ tag') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'scene' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(updateDocMeta).toHaveBeenCalledWith({ tags: ['scene'] })
    expect(input.value).toBe('')
  })

  it('does not add a blank tag', async () => {
    const updateDocMeta = await renderEditor(makeDoc())
    const input = screen.getByPlaceholderText('+ tag')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(updateDocMeta).not.toHaveBeenCalled()
  })

  it('removes a tag when its chip button is clicked', async () => {
    const updateDocMeta = await renderEditor(makeDoc({ tags: ['scene', 'chapter-one'] }))
    fireEvent.click(screen.getByLabelText('Remove tag scene'))

    expect(updateDocMeta).toHaveBeenCalledWith({ tags: ['chapter-one'] })
  })
})

describe('document pins', () => {
  it('opens the pin menu and shows the fixed vocabulary', async () => {
    await renderEditor(makeDoc())
    fireEvent.click(screen.getByText('+ Pin'))

    expect(screen.getByText(/Climax/)).toBeTruthy()
    expect(screen.getByText(/Rising Action/)).toBeTruthy()
  })

  it('toggles a pin on, then off', async () => {
    const updateDocMeta = await renderEditor(makeDoc())
    fireEvent.click(screen.getByText('+ Pin'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Climax/ }))
    expect(updateDocMeta).toHaveBeenCalledWith({ pins: ['Climax'] })

    cleanup()
    const withPin = await renderEditor(makeDoc({ pins: ['Climax'] }))
    fireEvent.click(screen.getByText('+ Pin'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Climax/ }))
    expect(withPin).toHaveBeenCalledWith({ pins: [] })
  })

  it('shows an active pin as a chip in the bar', async () => {
    await renderEditor(makeDoc({ pins: ['Climax'] }))
    expect(screen.getByText('Climax', { selector: '.pin-chip' })).toBeTruthy()
  })
})
