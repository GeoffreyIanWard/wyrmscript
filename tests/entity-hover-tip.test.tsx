// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DocFile, Entity } from '../src/shared/types'
import { buildEntityIndex } from '../src/renderer/src/lib/entities'
import { useWyrm } from '../src/renderer/src/store'
import { Editor } from '../src/renderer/src/components/Editor'

/**
 * F-30: hovering an auto-linked mention surfaces that entity's pins/tags
 * without leaving the page. Reveal is delayed (so reading a sentence doesn't
 * flash a tooltip on every name it passes over) and dismissal is instant, per
 * the page-is-sacred house rule — informational only, never lingering.
 */

function character(overrides: Partial<Entity> & { id: string; name: string }): Entity {
  const now = new Date().toISOString()
  return { type: 'character', aliases: [], body: '', created: now, modified: now, ...overrides }
}

function doc(overrides: Partial<DocFile['meta']> = {}): DocFile {
  const now = new Date().toISOString()
  return {
    meta: { id: 'doc-1', title: 'A Knock at Night', created: now, modified: now, ...overrides },
    body: 'Elara Voss stood at the window.'
  }
}

async function renderEditor(entities: Entity[], docFile: DocFile = doc()): Promise<void> {
  useWyrm.setState({
    activeId: docFile.meta.id,
    activeDoc: docFile,
    entities,
    entityIndex: buildEntityIndex(entities)
  })
  await act(async () => {
    render(<Editor />)
  })
}

function mention(): HTMLElement {
  return screen.getByText('Elara Voss', { selector: '[data-entity]' })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useWyrm.setState({
    activeId: null,
    activeDoc: null,
    entities: [],
    entityIndex: buildEntityIndex([])
  })
})

describe('EntityHoverTip', () => {
  it('does not appear immediately on hover', async () => {
    await renderEditor([character({ id: 'a', name: 'Elara Voss', tags: ['House Voss'] })])
    fireEvent.mouseOver(mention())
    expect(document.querySelector('.entity-hover-tip')).toBeNull()
  })

  it('appears after the reveal delay, showing tags and pins', async () => {
    await renderEditor([
      character({ id: 'a', name: 'Elara Voss', tags: ['House Voss'], pins: ['Protagonist'] })
    ])
    fireEvent.mouseOver(mention())
    act(() => vi.advanceTimersByTime(400))

    expect(screen.getByText('#House Voss')).toBeTruthy()
    expect(screen.getByText('Protagonist')).toBeTruthy()
  })

  it('never appears for an entity with neither tags nor pins', async () => {
    await renderEditor([character({ id: 'a', name: 'Elara Voss' })])
    fireEvent.mouseOver(mention())
    act(() => vi.advanceTimersByTime(1000))
    expect(document.querySelector('.entity-hover-tip')).toBeNull()
  })

  it('cancels the reveal if the mouse leaves before the delay elapses', async () => {
    await renderEditor([character({ id: 'a', name: 'Elara Voss', tags: ['House Voss'] })])
    const el = mention()
    fireEvent.mouseOver(el)
    act(() => vi.advanceTimersByTime(200))
    fireEvent.mouseOut(el)
    act(() => vi.advanceTimersByTime(400))

    expect(document.querySelector('.entity-hover-tip')).toBeNull()
  })

  it('dismisses instantly on mouseout once shown, no fade', async () => {
    await renderEditor([character({ id: 'a', name: 'Elara Voss', tags: ['House Voss'] })])
    const el = mention()
    fireEvent.mouseOver(el)
    act(() => vi.advanceTimersByTime(400))
    expect(document.querySelector('.entity-hover-tip')).toBeTruthy()

    fireEvent.mouseOut(el)
    expect(document.querySelector('.entity-hover-tip')).toBeNull()
  })

  it('clears a pending or shown tooltip when the document switches', async () => {
    await renderEditor([character({ id: 'a', name: 'Elara Voss', tags: ['House Voss'] })])
    fireEvent.mouseOver(mention())
    act(() => vi.advanceTimersByTime(400))
    expect(document.querySelector('.entity-hover-tip')).toBeTruthy()

    await act(async () => {
      useWyrm.setState({
        activeId: 'doc-2',
        activeDoc: {
          meta: { id: 'doc-2', title: 'Elsewhere', created: '', modified: '' },
          body: 'Nothing to see here.'
        }
      })
    })

    expect(document.querySelector('.entity-hover-tip')).toBeNull()
  })
})
