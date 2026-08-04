// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { Entity } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { EntityPanel } from '../src/renderer/src/components/EntityPanel'

/**
 * F-31: the side panel showed name, aliases, body and backlinks but not the
 * tags and pins the full editor has had since F-10 — so the same entry read
 * differently depending on which surface you happened to open. These drive
 * the real panel; the point is what a writer can see at a glance, and that
 * none of it is falsely pressable.
 */

function entity(overrides: Partial<Entity> & { id: string }): Entity {
  const now = new Date().toISOString()
  return {
    type: 'character',
    name: 'Elara Voss',
    aliases: [],
    body: '',
    created: now,
    modified: now,
    ...overrides
  }
}

async function renderPanel(e: Entity): Promise<void> {
  vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
  useWyrm.setState({
    project: { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } },
    entities: [e],
    panelEntityId: e.id
  })
  await act(async () => {
    render(<EntityPanel />)
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useWyrm.setState({ project: null, entities: [], panelEntityId: null })
})

describe('EntityPanel: tags', () => {
  it('shows an entry’s tags', async () => {
    await renderPanel(entity({ id: 'a', tags: ['House Voss', 'harbor-guard'] }))
    expect(screen.getByText('TAGS')).toBeTruthy()
    expect(screen.getByText('#House Voss')).toBeTruthy()
    expect(screen.getByText('#harbor-guard')).toBeTruthy()
  })

  it('omits the section entirely when there are none', async () => {
    await renderPanel(entity({ id: 'a' }))
    expect(screen.queryByText('TAGS')).toBeNull()
  })

  it('does not offer a remove control — the panel is read-only', async () => {
    await renderPanel(entity({ id: 'a', tags: ['House Voss'] }))
    expect(screen.queryByLabelText('Remove tag House Voss')).toBeNull()
    expect(screen.getByText('#House Voss').tagName).toBe('SPAN')
  })
})

describe('EntityPanel: pins', () => {
  it('shows the pins an entry actually carries', async () => {
    await renderPanel(entity({ id: 'a', pins: ['Protagonist'] }))
    expect(screen.getByText('PINS')).toBeTruthy()
    expect(screen.getByText('Protagonist')).toBeTruthy()
  })

  it('lists only the pins that are set, not the whole vocabulary', async () => {
    await renderPanel(entity({ id: 'a', pins: ['Protagonist'] }))
    expect(screen.queryByText('Antagonist')).toBeNull()
    expect(screen.queryByText('Viewpoint Character')).toBeNull()
  })

  it('omits the section entirely when there are none', async () => {
    await renderPanel(entity({ id: 'a' }))
    expect(screen.queryByText('PINS')).toBeNull()
  })

  it('renders pins as static spans, not pressable toggles', async () => {
    await renderPanel(entity({ id: 'a', pins: ['Protagonist'] }))
    const pin = screen.getByText('Protagonist')
    expect(pin.tagName).toBe('SPAN')
    expect(screen.queryByRole('button', { name: 'Protagonist' })).toBeNull()
  })
})
