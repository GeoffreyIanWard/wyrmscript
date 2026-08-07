// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Entity } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { Binder } from '../src/renderer/src/components/Binder'

/**
 * F-32/F-33: the sort control for a story-bible section. Drives the real
 * `Binder` so the whole path — clicking the toggle, picking a mode, the list
 * re-rendering in the new order, persisting to the project — is exercised
 * together rather than the sort routine in isolation (covered separately in
 * `entity-sort.test.ts`).
 */

function character(overrides: Partial<Entity> & { id: string; name: string }): Entity {
  const now = new Date().toISOString()
  return { type: 'character', aliases: [], body: '', created: now, modified: now, ...overrides }
}

async function setup(entities: Entity[]): Promise<void> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved', entities })
  render(<Binder />)
}

function openCharacterBook(): void {
  fireEvent.click(screen.getByText('Character Book').closest('.binder-row')!)
}

/** The sort control sits in its own row once a section is expanded — see
 *  the "does not offer Pin for World Book" test for why it isn't in the
 *  header itself. */
function sortRow(type: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`.sort-row[data-entity-type="${type}"]`)
  if (!row) throw new Error(`No sort row for "${type}" — is its section expanded?`)
  return row
}

/** The sort menu's items interleave "[x] " / "[ ] " with the label as
 *  separate text nodes under one span, so `getByText` can't match the whole
 *  string — find by role and compare normalized textContent instead. */
function sortMenuItem(row: HTMLElement, label: string): HTMLElement {
  const item = within(row)
    .getAllByRole('menuitemradio')
    .find((el) => el.textContent?.trim().endsWith(label))
  if (!item) throw new Error(`No sort menu item for "${label}"`)
  return item
}

afterEach(() => {
  cleanup()
  useWyrm.setState({ project: null, booted: false, entities: [] })
})

describe('story-bible sort control', () => {
  it('defaults Character Book to Pin (F-32) — a Protagonist leads an alphabetically-earlier unpinned entry', async () => {
    await setup([
      character({ id: 'a', name: 'Anna' }),
      character({ id: 'b', name: 'Zed', pins: ['Protagonist'] })
    ])
    openCharacterBook()

    const names = screen.getAllByText(/^(Anna|Zed)$/).map((el) => el.textContent)
    expect(names).toEqual(['Zed', 'Anna'])
  })

  it('re-sorts the list when a different mode is chosen, and persists the choice', async () => {
    await setup([
      character({ id: 'a', name: 'Anna' }),
      character({ id: 'b', name: 'Zed', pins: ['Protagonist'] })
    ])
    openCharacterBook()

    const row = sortRow('character')
    fireEvent.click(within(row).getByText(/Sort:/))
    fireEvent.click(sortMenuItem(row, 'A–Z'))

    const names = screen.getAllByText(/^(Anna|Zed)$/).map((el) => el.textContent)
    expect(names).toEqual(['Anna', 'Zed'])
    expect(useWyrm.getState().project?.data.entitySort).toEqual({ character: 'alphabetical' })
  })

  it('choosing a sort mode does not also collapse the section', async () => {
    await setup([character({ id: 'a', name: 'Anna' })])
    openCharacterBook()
    expect(screen.getByText('Anna')).toBeTruthy()

    const row = sortRow('character')
    fireEvent.click(within(row).getByText(/Sort:/))
    fireEvent.click(sortMenuItem(row, 'A–Z'))

    expect(screen.getByText('Anna')).toBeTruthy()
  })

  it('does not offer Pin for World Book, which has no pin vocabulary', async () => {
    await setup([])
    fireEvent.click(screen.getByText('World Book').closest('.binder-row')!)

    const row = sortRow('world')
    fireEvent.click(within(row).getByText(/Sort:/))

    const labels = within(row)
      .getAllByRole('menuitemradio')
      .map((el) => el.textContent?.trim())
    expect(labels).toEqual(['[x] A–Z', '[ ] Tag'])
  })

  it('does not render a sort row for a collapsed section', async () => {
    await setup([])
    expect(document.querySelector('.sort-row[data-entity-type="character"]')).toBeNull()
  })

  it('keeps Character Book and World Book sort choices independent', async () => {
    await act(async () => {
      const path = (await api.getLastProjectPath())!
      const info = (await api.openProjectPath(path))!
      useWyrm.setState({ project: info, booted: true, saveState: 'saved', entities: [] })
    })
    render(<Binder />)

    await useWyrm.getState().setEntitySort('character', 'tag')

    expect(useWyrm.getState().project?.data.entitySort).toEqual({ character: 'tag' })
  })
})
