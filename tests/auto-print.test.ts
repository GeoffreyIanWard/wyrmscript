// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { AutoPrint } from '../src/renderer/src/lib/autoPrint'
import { blocksFromDoc } from '../src/renderer/src/lib/compile'

/**
 * F-38 part 2. Paper is physical and a runaway trigger is expensive, so the
 * property that actually matters here is that a page is never printed twice —
 * including after the writer deletes text and retypes back through a boundary
 * that has already printed.
 *
 * jsdom has no layout, so `Range.getClientRects` is stubbed to a controlled
 * number of "visual lines" exactly as `page-view.test.ts` does; the point is
 * the page-completion arithmetic, not real wrapping.
 */

let editor: Editor | null = null
let enabled = true
let linesPerPage = 3
/** Visual lines per paragraph, by index. */
let lineCounts: number[] = []
let completed: [number, number][] = []

function stubRect(top: number): DOMRect {
  return { top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: 0 } as DOMRect
}

function paragraphIndex(p: HTMLElement): number {
  return p.parentElement ? [...p.parentElement.children].indexOf(p) : -1
}

function mount(content: string): Editor {
  const container = document.createElement('div')
  document.body.appendChild(container)

  // Installed before construction: the plugin's first check runs inside
  // `new Editor(...)` itself.
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
    const node = this.commonAncestorContainer
    const p = (node.nodeType === 1 ? node : node.parentElement) as HTMLElement
    const index = paragraphIndex(p)
    const count = lineCounts[index] ?? 0
    return Array.from({ length: count }, (_, i) => stubRect(index * 1000 + i * 20)) as DOMRectList
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const index = paragraphIndex(this)
    return stubRect(index >= 0 ? index * 1000 : 0)
  })

  editor = new Editor({
    element: container,
    content,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false }),
      AutoPrint.configure({
        getEnabled: () => enabled,
        getLinesPerPage: () => linesPerPage,
        onPageComplete: (from, to) => completed.push([from, to])
      })
    ]
  })

  // Positions must increase with the y coordinate, or the extension's own
  // `to > from` guard would discard every page — the mapping needs real
  // layout, so it is approximated monotonically here.
  const size = editor.state.doc.content.size
  vi.spyOn(editor.view, 'posAtCoords').mockImplementation((coords) => ({
    pos: Math.max(1, Math.min(size - 1, Math.floor(coords.top / 10))),
    inside: 0
  }))
  return editor
}

/** Force a re-check by making a real edit. */
function edit(ed: Editor): void {
  ed.commands.insertContentAt(ed.state.doc.content.size - 1, '.')
}

afterEach(() => {
  editor?.destroy()
  editor = null
  enabled = true
  linesPerPage = 3
  lineCounts = []
  completed = []
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('auto-print page completion', () => {
  it('does nothing while disabled', () => {
    enabled = false
    lineCounts = [9]
    const ed = mount(`<p>${'word '.repeat(80)}</p>`)
    edit(ed)

    expect(completed).toEqual([])
  })

  it('fires once a full page of lines exists', () => {
    lineCounts = [3]
    const ed = mount(`<p>${'word '.repeat(80)}</p>`)
    edit(ed)

    expect(completed).toHaveLength(1)
  })

  it('does not fire before a page is full', () => {
    lineCounts = [2]
    const ed = mount(`<p>${'word '.repeat(80)}</p>`)
    edit(ed)

    expect(completed).toEqual([])
  })

  it('never prints the same page twice on repeated edits', () => {
    lineCounts = [3]
    const ed = mount(`<p>${'word '.repeat(80)}</p>`)
    edit(ed)
    const afterFirst = completed.length
    edit(ed)
    edit(ed)

    expect(afterFirst).toBe(1)
    expect(completed).toHaveLength(1)
  })

  it('does not reprint a page after text is deleted and retyped', () => {
    // The expensive failure: the live page count drops when a writer cuts a
    // paragraph, then climbs back through a boundary that already printed.
    // Paper must not come out twice for the same page.
    lineCounts = [6]
    const ed = mount(`<p>${'word '.repeat(80)}</p>`)
    edit(ed)
    expect(completed).toHaveLength(2)

    lineCounts = [3] // writer deletes back to one page
    edit(ed)
    lineCounts = [6] // and retypes
    edit(ed)

    expect(completed).toHaveLength(2)
  })

  it('emits every page crossed at once, so a paste does not skip pages', () => {
    lineCounts = [9]
    const ed = mount(`<p>${'word '.repeat(80)}</p>`)
    edit(ed)

    expect(completed).toHaveLength(3)
  })
})

describe('turning a printed page back into blocks', () => {
  it('keeps marks, so a printed page matches what a PDF would render', () => {
    // Extracting plain text here would be simpler and silently wrong.
    const blocks = blocksFromDoc({
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'loud', marks: [{ type: 'bold' }] }]
        }
      ]
    })

    expect(blocks).toEqual([{ kind: 'paragraph', runs: [{ text: 'loud', bold: true }] }])
  })

  it('skips empty paragraphs rather than emitting blank blocks', () => {
    const blocks = blocksFromDoc({
      content: [
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] }
      ]
    })

    expect(blocks).toHaveLength(1)
  })
})
