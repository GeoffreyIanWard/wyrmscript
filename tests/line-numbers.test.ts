// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { LineNumbers } from '../src/renderer/src/lib/lineNumbers'

/**
 * F-27: paragraph numbers in a gutter left of the page. jsdom does no real
 * layout (and has no `ResizeObserver` at all), so both are stubbed to
 * deterministic values — the point is exercising "one row per paragraph,
 * numbered in document order, hidden entirely while disabled", not real
 * pixel geometry.
 */

let editor: Editor | null = null
let enabled = true

function mount(content: string): Editor {
  const scroll = document.createElement('div')
  scroll.className = 'terminal-scroll'
  const container = document.createElement('div')
  scroll.appendChild(container)
  document.body.appendChild(scroll)

  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    height: 400,
    bottom: 400,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ''
  })

  editor = new Editor({
    element: container,
    content,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false }),
      LineNumbers.configure({ getEnabled: () => enabled })
    ]
  })

  vi.spyOn(editor.view.dom, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    height: 800,
    bottom: 800,
    left: 100,
    right: 500,
    width: 400,
    x: 100,
    y: 0,
    toJSON: () => ''
  })
  vi.spyOn(editor.view, 'coordsAtPos').mockImplementation((pos) => ({
    top: pos * 10,
    bottom: pos * 10 + 20,
    left: 100,
    right: 100
  }))

  return editor
}

function gutter(): HTMLElement {
  return document.querySelector('.line-number-gutter') as HTMLElement
}

function numbers(): string[] {
  return [...gutter().querySelectorAll('.line-number')].map((el) => el.textContent ?? '')
}

afterEach(() => {
  editor?.destroy()
  editor = null
  enabled = true
  document.body.innerHTML = ''
})

describe('LineNumbers', () => {
  it('numbers each paragraph in document order, starting at 1', () => {
    mount('<p>First.</p><p>Second.</p><p>Third.</p>')

    expect(numbers()).toEqual(['1', '2', '3'])
  })

  it('stays hidden while disabled', () => {
    enabled = false
    mount('<p>First.</p><p>Second.</p>')

    expect(gutter().style.display).toBe('none')
  })

  it('renumbers after a paragraph is added', () => {
    const ed = mount('<p>First.</p>')

    ed.commands.insertContentAt(ed.state.doc.content.size, { type: 'paragraph' })
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: 'paragraph' })

    expect(numbers()).toEqual(['1', '2', '3'])
  })

  it('shows again once re-enabled', () => {
    enabled = false
    const ed = mount('<p>First.</p>')
    expect(gutter().style.display).toBe('none')

    enabled = true
    // Nothing dispatches on its own when only the live getter's answer
    // changes — the same reason Editor.tsx fires a no-op transaction after a
    // Preferences toggle. A real edit stands in for that here — inside the
    // existing paragraph (`size - 1`), not at the very end, which would open
    // a second one and defeat the "still just one paragraph" assertion.
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, '!')

    expect(gutter().style.display).toBe('block')
    expect(numbers()).toEqual(['1'])
  })
})
