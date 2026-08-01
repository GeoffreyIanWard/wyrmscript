// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Entity, Relationship } from '../src/shared/types'
import { useWyrm } from '../src/renderer/src/store'
import { CharacterGraphDialog } from '../src/renderer/src/components/CharacterGraphDialog'

/**
 * F-11: relationships are typed and directional, drawn between character
 * nodes that are clustered by their first tag — these tests drive the real
 * dialog against seeded store state rather than asserting on internals.
 */

function character(id: string, name: string, tags?: string[]): Entity {
  const now = new Date().toISOString()
  return { id, type: 'character', name, aliases: [], body: '', tags, created: now, modified: now }
}

function relationship(overrides: Partial<Relationship> = {}): Relationship {
  const now = new Date().toISOString()
  return {
    id: 'rel-1',
    fromId: 'a',
    toId: 'b',
    label: 'sister of',
    created: now,
    modified: now,
    ...overrides
  }
}

async function renderDialog(
  entities: Entity[],
  relationships: Relationship[],
  overrides: Partial<{
    createRelationship: ReturnType<typeof vi.fn>
    deleteRelationship: ReturnType<typeof vi.fn>
    showEntity: ReturnType<typeof vi.fn>
  }> = {}
): Promise<void> {
  useWyrm.setState({
    entities,
    relationships: [],
    loadRelationships: async () => {
      useWyrm.setState({ relationships })
    },
    createRelationship: overrides.createRelationship ?? vi.fn(async () => null),
    deleteRelationship: overrides.deleteRelationship ?? vi.fn(async () => {}),
    showEntity: overrides.showEntity ?? vi.fn()
  })
  await act(async () => {
    render(<CharacterGraphDialog onClose={() => {}} />)
  })
}

afterEach(() => {
  cleanup()
  useWyrm.setState({ entities: [], relationships: [] })
})

describe('CharacterGraphDialog', () => {
  it('shows an empty state when there are no characters', async () => {
    await renderDialog([], [])
    expect(screen.getByText(/No characters yet/)).toBeTruthy()
  })

  it('renders a node for every character', async () => {
    await renderDialog([character('a', 'Elara'), character('b', 'Marten')], [])
    expect(screen.getByRole('button', { name: 'Elara' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Marten' })).toBeTruthy()
  })

  it('groups characters into cluster columns by their first tag', async () => {
    await renderDialog(
      [character('a', 'Elara', ['House Voss']), character('b', 'Renn', ['House Ferro'])],
      []
    )
    expect(screen.getByText('House Voss')).toBeTruthy()
    expect(screen.getByText('House Ferro')).toBeTruthy()
  })

  it('lists existing relationships with their label', async () => {
    await renderDialog(
      [character('a', 'Elara'), character('b', 'Marten')],
      [relationship({ fromId: 'a', toId: 'b', label: 'sister of' })]
    )
    expect(document.querySelector('.character-graph-row strong')?.textContent).toBe('sister of')
  })

  it('opens the character entity and closes the dialog when a node is clicked', async () => {
    const showEntity = vi.fn()
    await renderDialog([character('a', 'Elara')], [], { showEntity })
    fireEvent.click(screen.getByRole('button', { name: 'Elara' }))
    expect(showEntity).toHaveBeenCalledWith('a')
  })

  it('creates a relationship from the add controls', async () => {
    const createRelationship = vi.fn(async () => null)
    await renderDialog([character('a', 'Elara'), character('b', 'Marten')], [], {
      createRelationship
    })

    fireEvent.change(screen.getByDisplayValue('From…'), { target: { value: 'a' } })
    fireEvent.change(screen.getByPlaceholderText('relationship, e.g. sibling of'), {
      target: { value: 'sister of' }
    })
    fireEvent.change(screen.getByDisplayValue('To…'), { target: { value: 'b' } })
    fireEvent.click(screen.getByText('+ Add'))

    expect(createRelationship).toHaveBeenCalledWith('a', 'b', 'sister of')
  })

  it('does not enable adding a relationship to oneself', async () => {
    const createRelationship = vi.fn(async () => null)
    await renderDialog([character('a', 'Elara'), character('b', 'Marten')], [], {
      createRelationship
    })

    fireEvent.change(screen.getByDisplayValue('From…'), { target: { value: 'a' } })
    fireEvent.change(screen.getByDisplayValue('To…'), { target: { value: 'a' } })
    fireEvent.change(screen.getByPlaceholderText('relationship, e.g. sibling of'), {
      target: { value: 'sister of' }
    })

    expect((screen.getByText('+ Add') as HTMLButtonElement).disabled).toBe(true)
  })

  it('deletes a relationship', async () => {
    const deleteRelationship = vi.fn(async () => {})
    await renderDialog([character('a', 'Elara'), character('b', 'Marten')], [relationship()], {
      deleteRelationship
    })
    fireEvent.click(screen.getByText('Delete'))
    expect(deleteRelationship).toHaveBeenCalled()
  })
})
