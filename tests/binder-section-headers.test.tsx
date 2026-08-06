// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Entity } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { Binder } from '../src/renderer/src/components/Binder'

function character(id: string, name: string): Entity {
  const now = new Date().toISOString()
  return { id, type: 'character', name, aliases: [], body: '', created: now, modified: now }
}

/**
 * F-25: the story-bible section headers (Glossary/Character Book/World Book)
 * rendered through the exact same `.binder-row` style as their own entries —
 * nothing distinguished "this is a section" from "this is an entry that
 * happens to be first". These check the distinguishing class landed on the
 * three headers specifically, not on the entries beneath them or the
 * manuscript folder tree above them (out of scope for this request).
 */

async function setup(): Promise<void> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({
    project: info,
    booted: true,
    saveState: 'saved',
    entities: [character('a', 'Elara Voss')]
  })
  render(<Binder />)
}

afterEach(() => {
  cleanup()
  useWyrm.setState({ project: null, booted: false, entities: [] })
})

describe('story-bible section headers', () => {
  it('marks Glossary, Character Book and World Book as section headers', async () => {
    await setup()
    for (const label of ['Glossary', 'Character Book', 'World Book']) {
      const row = screen.getByText(label).closest('.binder-row')
      expect(row?.className).toContain('section-header')
    }
  })

  it('does not mark an entry underneath a section as a header', async () => {
    await setup()
    const header = screen.getByText('Character Book').closest('.binder-row')!
    fireEvent.click(header)
    const entry = screen.getByText('Elara Voss').closest('.binder-row')
    expect(entry?.className ?? '').not.toContain('section-header')
  })

  it('leaves the manuscript folder tree untouched — out of scope for this request', async () => {
    await setup()
    const manuscript = screen.getByText('Manuscript').closest('.binder-row')
    expect(manuscript?.className ?? '').not.toContain('section-header')
  })
})
