// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { BlockCursor } from '../src/renderer/src/lib/blockCursor'

/**
 * F-23: the block cursor is a positioned overlay tracking the real
 * selection, not a CSS tweak (browsers have no reliable block-shaped
 * `caret-color`). jsdom does no real layout, so pixel position isn't
 * checkable here — these cover the behaviour that doesn't depend on it:
 * the element exists as a sibling of ProseMirror's own DOM (never a child,
 * which PM's reconciliation would fight over), and shows only when the
 * editor is focused with a collapsed selection.
 */

let editor: Editor | null = null

function mount(content: string): Editor {
  // `.terminal-scroll` is the plugin's containing block in the real app
  // (`Editor.tsx`) — it looks one up via `closest`, so the bare container
  // needs the same wrapper or every position update is a silent no-op.
  const scroll = document.createElement('div')
  scroll.className = 'terminal-scroll'
  const container = document.createElement('div')
  scroll.appendChild(container)
  document.body.appendChild(scroll)
  editor = new Editor({
    element: container,
    content,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false }),
      BlockCursor
    ]
  })
  return editor
}

function cursorEl(ed: Editor): HTMLElement | null {
  return ed.view.dom.parentElement?.querySelector<HTMLElement>('.block-cursor') ?? null
}

// `editor.commands.focus()` does not reliably move jsdom's `activeElement`
// for a contenteditable div — a real `.focus()` call does, once the element
// is focusable at all.
function focus(ed: Editor): void {
  ed.view.dom.setAttribute('tabindex', '0')
  ed.view.dom.focus()
}

afterEach(() => {
  editor?.destroy()
  editor = null
  document.body.innerHTML = ''
})

describe('BlockCursor', () => {
  it('appends the cursor element as a sibling of the ProseMirror DOM, never a child', () => {
    const ed = mount('<p>Elara waited.</p>')
    const el = cursorEl(ed)
    expect(el).toBeTruthy()
    expect(ed.view.dom.contains(el)).toBe(false)
    expect(el?.parentElement).toBe(ed.view.dom.parentElement)
  })

  it('stays hidden without focus', () => {
    const ed = mount('<p>Elara waited.</p>')
    ed.view.dom.blur()
    expect(cursorEl(ed)?.style.display).toBe('none')
  })

  it('stays hidden while a range is selected, not a single caret', () => {
    const ed = mount('<p>Elara waited.</p>')
    focus(ed)
    ed.commands.setTextSelection({ from: 1, to: 5 })
    expect(cursorEl(ed)?.style.display).toBe('none')
  })

  it('shows once focused with a collapsed selection', () => {
    const ed = mount('<p>Elara waited.</p>')
    focus(ed)
    ed.commands.setTextSelection(2)
    expect(cursorEl(ed)?.style.display).toBe('block')
  })

  it('cleans up its DOM element and listeners on destroy, without throwing', () => {
    const ed = mount('<p>Elara waited.</p>')
    focus(ed)
    const parent = ed.view.dom.parentElement
    expect(() => ed.destroy()).not.toThrow()
    expect(parent?.querySelector('.block-cursor')).toBeNull()
    editor = null
  })
})
