// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import type { Entity } from '../src/shared/types'
import { buildEntityIndex } from '../src/renderer/src/lib/entities'
import { EntityLinks } from '../src/renderer/src/lib/entityLinks'

/**
 * The decoration layer draws entity links in the live document. The subtle case
 * is a name split across formatting boundaries — "Elara **Voss**" is several
 * ProseMirror text nodes but one name — so these tests drive a real editor.
 */

function makeEntity(
  name: string,
  aliases: string[] = [],
  type: Entity['type'] = 'character'
): Entity {
  return {
    id: `id-${name}`,
    type,
    name,
    aliases,
    body: '',
    created: '',
    modified: ''
  }
}

let editor: Editor | null = null

function mount(content: string, entities: Entity[]): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const index = buildEntityIndex(entities)
  editor = new Editor({
    element,
    content,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false }),
      Highlight,
      EntityLinks.configure({ getIndex: () => index, onClickEntity: () => {}, debounceMs: 5 })
    ]
  })
  return editor
}

function linked(ed: Editor): { text: string; type: string }[] {
  return [...ed.view.dom.querySelectorAll('[data-entity]')].map((el) => ({
    text: el.textContent ?? '',
    type: (el.className.match(/entity (\w+)/) ?? [])[1] ?? ''
  }))
}

afterEach(() => {
  editor?.destroy()
  editor = null
  document.body.innerHTML = ''
})

describe('entity link decorations', () => {
  it('decorates a plain mention with its type class', () => {
    const ed = mount('<p>Elara waited at the gate.</p>', [makeEntity('Elara')])
    expect(linked(ed)).toEqual([{ text: 'Elara', type: 'character' }])
  })

  it('finds a name split across a formatting boundary', () => {
    const ed = mount('<p>Elara <strong>Voss</strong> drew the bolt.</p>', [
      makeEntity('Elara Voss')
    ])
    // The decoration spans both text nodes, so the rendered pieces together
    // reconstruct the full name.
    const joined = linked(ed)
      .map((l) => l.text)
      .join('')
    expect(joined).toBe('Elara Voss')
  })

  it('does not match across a hard break', () => {
    const ed = mount('<p>Elara<br>Voss</p>', [makeEntity('Elara Voss')])
    expect(linked(ed)).toEqual([])
  })

  it('decorates mentions in every paragraph, with per-type styling', () => {
    const ed = mount('<p>Elara in Harrowgate.</p><p>The wyrmlight again.</p>', [
      makeEntity('Elara'),
      makeEntity('Harrowgate', [], 'world'),
      makeEntity('wyrmlight', [], 'glossary')
    ])
    expect(linked(ed)).toEqual([
      { text: 'Elara', type: 'character' },
      { text: 'Harrowgate', type: 'world' },
      { text: 'wyrmlight', type: 'glossary' }
    ])
  })

  it('renders nothing when the index is empty, and never touches the stored text', () => {
    const ed = mount('<p>Elara waited.</p>', [])
    expect(linked(ed)).toEqual([])
    // Links are decorations, so the document itself carries no link marks.
    expect(JSON.stringify(ed.getJSON())).not.toContain('entity')
  })

  it('keeps the document free of link marks even when decorated', () => {
    const ed = mount('<p>Elara waited.</p>', [makeEntity('Elara')])
    expect(linked(ed)).toHaveLength(1)
    expect(JSON.stringify(ed.getJSON())).not.toContain('entity')
  })
})
