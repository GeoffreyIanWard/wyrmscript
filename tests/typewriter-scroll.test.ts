// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TypewriterScroll } from '../src/renderer/src/lib/typewriterScroll'

/**
 * F-37: keeps the active line centered only while the writer is actively
 * extending the manuscript. jsdom does no real layout, so `coordsAtPos` and
 * `getBoundingClientRect` are stubbed to deterministic values — the point is
 * exercising the three-condition gate (doc changed, cursor in the last
 * paragraph, cursor past the viewport midpoint), not real pixel geometry.
 */

let editor: Editor | null = null
let enabled = true

function mount(content: string): Editor {
  // `.terminal-scroll` is the extension's containing scroll element in the
  // real app (`Editor.tsx`) — it looks one up via `closest`.
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
      TypewriterScroll.configure({ getEnabled: () => enabled })
    ]
  })
  return editor
}

/** Midpoint of the stubbed 400px-tall scroll element is y=200. */
function stubCoords(top: number): void {
  vi.spyOn(editor!.view, 'coordsAtPos').mockReturnValue({
    top,
    bottom: top + 20,
    left: 0,
    right: 0
  })
}

afterEach(() => {
  editor?.destroy()
  editor = null
  enabled = true
  document.body.innerHTML = ''
})

describe('TypewriterScroll', () => {
  it('does nothing while disabled', () => {
    const ed = mount('<p>Elara waited at the gate.</p>')
    const scroll = ed.view.dom.closest('.terminal-scroll') as HTMLElement
    enabled = false
    stubCoords(300)
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, '!')
    expect(scroll.scrollTop).toBe(0)
  })

  it('does nothing on a pure selection change, no document edit', () => {
    const ed = mount('<p>Elara waited at the gate.</p>')
    const scroll = ed.view.dom.closest('.terminal-scroll') as HTMLElement
    stubCoords(300)
    ed.commands.setTextSelection(2)
    expect(scroll.scrollTop).toBe(0)
  })

  it('does nothing while the cursor has not reached the viewport midpoint', () => {
    const ed = mount('<p>Elara waited at the gate.</p>')
    const scroll = ed.view.dom.closest('.terminal-scroll') as HTMLElement
    stubCoords(50) // above the stubbed midpoint of 200
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, '!')
    expect(scroll.scrollTop).toBe(0)
  })

  it('does nothing while editing outside the document’s last paragraph', () => {
    const ed = mount('<p>First paragraph.</p><p>Second, and last.</p>')
    const scroll = ed.view.dom.closest('.terminal-scroll') as HTMLElement
    stubCoords(300)
    // Position 5 lands inside the first paragraph, not the last one.
    ed.commands.insertContentAt(5, '!')
    expect(scroll.scrollTop).toBe(0)
  })

  it('scrolls to recenter once writing in the last paragraph reaches the midpoint', () => {
    const ed = mount('<p>Elara waited at the gate.</p>')
    const scroll = ed.view.dom.closest('.terminal-scroll') as HTMLElement
    stubCoords(300) // 100px past the stubbed midpoint of 200
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, '!')
    expect(scroll.scrollTop).toBe(100)
  })
})
