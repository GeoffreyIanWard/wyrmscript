// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { PageView } from '../src/renderer/src/lib/pageView'

/**
 * F-27: a dotted rule every N *visual* lines, counted across paragraph
 * boundaries (a page has no idea where one paragraph ends and another
 * begins). jsdom does no real layout, so `Range.getClientRects` is stubbed
 * per paragraph to a controlled number of "visual lines" — the point is
 * exercising the counting and the empty-paragraph fallback, not real pixel
 * wrapping.
 */

let editor: Editor | null = null
let enabled = true
let linesPerPage = 3

/** Visual-line count per paragraph, keyed by its position in the doc. A
 *  paragraph missing from this map is treated as empty (no text rects at
 *  all), exercising the bounding-box fallback. */
let lineCounts: number[] = []

function stubRect(top: number): DOMRect {
  return { top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: 0 } as DOMRect
}

/** A paragraph's position among its siblings, computed fresh at call time
 *  rather than from a list captured once — the plugin's very first render
 *  runs synchronously *during* `new Editor(...)`, before there is any editor
 *  reference to query paragraphs from, so the mocks below have to work
 *  without one. */
function paragraphIndex(p: HTMLElement): number {
  return p.parentElement ? [...p.parentElement.children].indexOf(p) : -1
}

function mount(content: string): Editor {
  const scroll = document.createElement('div')
  scroll.className = 'terminal-scroll'
  const container = document.createElement('div')
  scroll.appendChild(container)
  document.body.appendChild(scroll)

  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    height: 4000,
    bottom: 4000,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ''
  })

  // Installed before construction: the plugin's first render happens inside
  // `new Editor(...)` itself, so a mock added afterward would miss it.
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
      PageView.configure({ getEnabled: () => enabled, getLinesPerPage: () => linesPerPage })
    ]
  })

  return editor
}

function rules(): HTMLElement[] {
  return [...document.querySelectorAll('.page-view-rule')]
}

beforeEach(() => {
  linesPerPage = 3
})

afterEach(() => {
  editor?.destroy()
  editor = null
  enabled = true
  lineCounts = []
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('PageView', () => {
  it('places no rules while disabled', () => {
    enabled = false
    lineCounts = [5]
    mount('<p>One long wrapped paragraph.</p>')

    expect(rules()).toHaveLength(0)
    expect(document.querySelector('.page-view-rules')).toHaveProperty('style.display', 'none')
  })

  it('counts visual lines across a paragraph boundary, not per paragraph', () => {
    // Paragraph 1: 2 lines (cumulative 1, 2). Paragraph 2: 4 lines
    // (cumulative 3, 4, 5, 6). With 3 lines/page, rules land after
    // cumulative line 3 (mid paragraph 2) and line 6 (its last line) — two
    // rules, neither aligned to a paragraph's own start or end.
    lineCounts = [2, 4]
    mount('<p>First.</p><p>Second.</p>')

    expect(rules()).toHaveLength(2)
  })

  it('counts an empty paragraph as exactly one line via its own bounding box', () => {
    // No text rects at all for either paragraph (both empty), so each
    // contributes exactly one line from the fallback — two paragraphs, one
    // rule at the 2-line mark under a 2-lines-per-page setting.
    linesPerPage = 2
    lineCounts = []
    mount('<p></p><p></p>')

    expect(rules()).toHaveLength(1)
  })

  it('places no rule short of a full page', () => {
    lineCounts = [2]
    mount('<p>Short.</p>')

    expect(rules()).toHaveLength(0)
  })
})
