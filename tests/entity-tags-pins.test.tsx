// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Entity } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { EntityEditor } from '../src/renderer/src/components/EntityEditor'

/**
 * F-10 on the story-bible side: tags are free-form on every entity type
 * (factions live here — a faction is just a tag several entities share);
 * pins are a closed vocabulary but only meaningful on characters, so the
 * field must not appear for glossary/world entries.
 */

function makeEntity(overrides: Partial<Entity> & { type: Entity['type'] }): Entity {
  const now = new Date().toISOString()
  return {
    id: 'ent-1',
    name: 'Elara Voss',
    aliases: [],
    body: '',
    created: now,
    modified: now,
    ...overrides
  }
}

async function renderEditor(entity: Entity, saveEntity = vi.fn()): Promise<typeof saveEntity> {
  vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
  useWyrm.setState({
    project: { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } },
    entities: [entity],
    saveEntity: async (e) => {
      saveEntity(e)
    }
  })
  await act(async () => {
    render(<EntityEditor entityId={entity.id} />)
  })
  return saveEntity
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useWyrm.setState({ project: null, entities: [] })
})

describe('entity tags', () => {
  it('renders existing tags as removable chips', async () => {
    await renderEditor(makeEntity({ type: 'world', tags: ['House Voss'] }))
    expect(screen.getByText('#House Voss')).toBeTruthy()
  })

  it('queues a typed tag and includes it on Save Entry', async () => {
    const saveEntity = await renderEditor(makeEntity({ type: 'world' }))
    const input = screen.getByPlaceholderText('+ tag')
    fireEvent.change(input, { target: { value: 'House Voss' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    fireEvent.click(screen.getByText('Save Entry'))
    expect(saveEntity).toHaveBeenCalledWith(expect.objectContaining({ tags: ['House Voss'] }))
  })
})

describe('entity pins', () => {
  it('shows the pin field for characters only', async () => {
    await renderEditor(makeEntity({ type: 'character' }))
    expect(screen.getByText('Protagonist')).toBeTruthy()
  })

  it('hides the pin field for glossary and world entries', async () => {
    await renderEditor(makeEntity({ type: 'glossary' }))
    expect(screen.queryByText('Protagonist')).toBeNull()
  })

  it('toggles a pin and includes it on Save Entry', async () => {
    const saveEntity = await renderEditor(makeEntity({ type: 'character' }))
    fireEvent.click(screen.getByText('Protagonist'))
    fireEvent.click(screen.getByText('Save Entry'))

    expect(saveEntity).toHaveBeenCalledWith(expect.objectContaining({ pins: ['Protagonist'] }))
  })
})
