// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Entity } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { EntityEditor } from '../src/renderer/src/components/EntityEditor'
import { EntityPanel } from '../src/renderer/src/components/EntityPanel'

/**
 * F-13: nesting is a plain `parentId` field, set via a dropdown in the full
 * editor and surfaced as a read-only "located in" breadcrumb wherever a
 * world entity is shown. These tests drive the real components rather than
 * asserting on `lib/locations.ts` a second time (that's covered directly).
 */

function place(id: string, name: string, parentId?: string): Entity {
  const now = new Date().toISOString()
  return { id, type: 'world', name, aliases: [], body: '', parentId, created: now, modified: now }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useWyrm.setState({ project: null, entities: [], panelEntityId: null })
})

describe('EntityEditor: parent location', () => {
  it('does not show a parent-location field for non-world entities', async () => {
    const character: Entity = {
      id: 'a',
      type: 'character',
      name: 'Elara',
      aliases: [],
      body: '',
      created: '',
      modified: ''
    }
    vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
    useWyrm.setState({
      project: { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } },
      entities: [character]
    })
    await act(async () => {
      render(<EntityEditor entityId="a" />)
    })
    expect(screen.queryByText('PARENT LOCATION')).toBeNull()
  })

  it('lists other world entities as parent options, excluding itself', async () => {
    const country = place('country', 'Narrow Coast')
    const city = place('city', 'Harrowgate')
    vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
    useWyrm.setState({
      project: { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } },
      entities: [country, city]
    })
    await act(async () => {
      render(<EntityEditor entityId="city" />)
    })
    const select = screen.getByDisplayValue('None') as HTMLSelectElement
    const optionLabels = [...select.options].map((o) => o.textContent)
    expect(optionLabels).toContain('Narrow Coast')
    expect(optionLabels).not.toContain('Harrowgate')
  })

  it('excludes a candidate that would create a cycle', async () => {
    const country = place('country', 'Narrow Coast')
    const city = place('city', 'Harrowgate', 'country')
    vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
    useWyrm.setState({
      project: { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } },
      entities: [country, city]
    })
    // Editing country: city (its own descendant) must not be offered as a parent.
    await act(async () => {
      render(<EntityEditor entityId="country" />)
    })
    const select = screen.getByDisplayValue('None') as HTMLSelectElement
    const optionLabels = [...select.options].map((o) => o.textContent)
    expect(optionLabels).not.toContain('Harrowgate')
  })

  it('shows a live breadcrumb preview as the parent dropdown changes', async () => {
    const country = place('country', 'Narrow Coast')
    const city = place('city', 'Harrowgate')
    vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
    useWyrm.setState({
      project: { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } },
      entities: [country, city]
    })
    await act(async () => {
      render(<EntityEditor entityId="city" />)
    })
    expect(screen.queryByText(/Located in/)).toBeNull()

    fireEvent.change(screen.getByDisplayValue('None'), { target: { value: 'country' } })
    expect(screen.getByText(/Located in: Narrow Coast/)).toBeTruthy()
  })

  it('saves the chosen parentId on Save Entry', async () => {
    const country = place('country', 'Narrow Coast')
    const city = place('city', 'Harrowgate')
    const saveEntity = vi.fn(async () => {})
    vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
    useWyrm.setState({
      project: { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } },
      entities: [country, city],
      saveEntity
    })
    await act(async () => {
      render(<EntityEditor entityId="city" />)
    })
    fireEvent.change(screen.getByDisplayValue('None'), { target: { value: 'country' } })
    fireEvent.click(screen.getByText('Save Entry'))
    expect(saveEntity).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'country' }))
  })
})

describe('EntityPanel: located in', () => {
  it('shows the breadcrumb for a nested location', async () => {
    const country = place('country', 'Narrow Coast')
    const city = place('city', 'Harrowgate', 'country')
    vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
    useWyrm.setState({
      project: { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } },
      entities: [country, city],
      panelEntityId: 'city'
    })
    await act(async () => {
      render(<EntityPanel />)
    })
    expect(screen.getByText('LOCATED IN')).toBeTruthy()
    expect(screen.getByText('Narrow Coast')).toBeTruthy()
  })

  it('shows no breadcrumb for a location with no parent', async () => {
    const country = place('country', 'Narrow Coast')
    vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
    useWyrm.setState({
      project: { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } },
      entities: [country],
      panelEntityId: 'country'
    })
    await act(async () => {
      render(<EntityPanel />)
    })
    expect(screen.queryByText('LOCATED IN')).toBeNull()
  })
})
