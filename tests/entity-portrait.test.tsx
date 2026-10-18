// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Entity } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { EntityEditor } from '../src/renderer/src/components/EntityEditor'

/**
 * F-47: the portrait field in the entry editor. The storage, the picker and
 * the store actions are tested where they live; this covers the half a
 * writer touches, driving the real component with the actions replaced, the
 * way nested-locations.test.tsx does.
 */

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function entry(type: Entity['type'], extra: Partial<Entity> = {}): Entity {
  const now = new Date().toISOString()
  return {
    id: 'a',
    type,
    name: 'Elara',
    aliases: [],
    body: '',
    created: now,
    modified: now,
    ...extra
  }
}

async function renderFor(
  entity: Entity
): Promise<{ setPortrait: ReturnType<typeof vi.fn>; clearPortrait: ReturnType<typeof vi.fn> }> {
  vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
  const setPortrait = vi.fn(async () => true)
  const clearPortrait = vi.fn(async () => undefined)
  useWyrm.setState({
    project: { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } },
    entities: [entity],
    setPortrait,
    clearPortrait
  })
  await act(async () => {
    render(<EntityEditor entityId="a" />)
  })
  return { setPortrait, clearPortrait }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useWyrm.setState({ project: null, entities: [], panelEntityId: null })
})

describe('the portrait field', () => {
  it('is offered for a character and a location, not a glossary term', async () => {
    await renderFor(entry('character'))
    expect(screen.getByText('PORTRAIT')).toBeTruthy()
    cleanup()
    await renderFor(entry('world'))
    expect(screen.getByText('PORTRAIT')).toBeTruthy()
    cleanup()
    await renderFor(entry('glossary'))
    expect(screen.queryByText('PORTRAIT')).toBeNull()
  })

  it('asks the store to choose an image for this entry', async () => {
    const { setPortrait } = await renderFor(entry('character'))
    await act(async () => {
      fireEvent.click(screen.getByText('Choose Image…'))
    })
    expect(setPortrait).toHaveBeenCalledWith('a')
  })

  it('shows the picture once the entry has one, read by id over the bridge', async () => {
    vi.spyOn(api, 'readPortrait').mockResolvedValue(PNG)
    await renderFor(entry('character', { portrait: 'characters/a.png' }))

    await waitFor(() => expect(document.querySelector('.entity-portrait-img')).toBeTruthy())
    expect((document.querySelector('.entity-portrait-img') as HTMLImageElement).src).toContain(
      'data:image/png'
    )
    expect(api.readPortrait).toHaveBeenCalledWith('/demo', 'a')
    // With a picture there, the button offers to change it and one to remove.
    expect(screen.getByText('Change Image…')).toBeTruthy()
    expect(screen.getByText('Remove')).toBeTruthy()
  })

  it('offers no Remove when there is nothing to remove', async () => {
    await renderFor(entry('character'))
    expect(screen.queryByText('Remove')).toBeNull()
    expect(document.querySelector('.entity-portrait-img')).toBeNull()
  })

  it('asks the store to remove it', async () => {
    vi.spyOn(api, 'readPortrait').mockResolvedValue(PNG)
    const { clearPortrait } = await renderFor(entry('world', { portrait: 'world/a.png' }))
    await waitFor(() => expect(screen.getByText('Remove')).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByText('Remove'))
    })

    expect(clearPortrait).toHaveBeenCalledWith('a')
  })
})
