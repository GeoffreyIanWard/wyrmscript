// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DropCaps } from '../src/renderer/src/lib/dropCaps'
import { markdownToDoc } from '../src/renderer/src/lib/markdown'

/**
 * F-15: which paragraphs get an illuminated capital. The rule is the
 * writer's — the opening paragraph, plus any paragraph following a deliberate
 * blank line — so what matters is that an ordinary paragraph break does
 * *not* trigger one, or every paragraph would be illuminated and the control
 * would be meaningless.
 */

let editor: Editor | null = null

function mount(content: string): Editor {
  const container = document.createElement('div')
  document.body.appendChild(container)
  editor = new Editor({
    element: container,
    content,
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, code: false }), DropCaps]
  })
  return editor
}

/** Which rendered paragraphs carry the drop-cap class, by index. */
function capped(): number[] {
  const paragraphs = [...(editor?.view.dom.querySelectorAll('p') ?? [])]
  return paragraphs.flatMap((p, i) => (p.classList.contains('drop-cap') ? [i] : []))
}

/** Mount straight from stored Markdown, the way a document actually loads. */
function mountMarkdown(src: string): Editor {
  return mount(markdownToDoc(src) as never)
}

afterEach(() => {
  editor?.destroy()
  editor = null
  document.body.innerHTML = ''
})

describe('drop caps', () => {
  it('illuminates the opening paragraph', () => {
    mount('<p>First.</p><p>Second.</p>')

    expect(capped()).toEqual([0])
  })

  it('leaves an ordinary paragraph break alone', () => {
    // The whole point of the rule: a normal break must not illuminate, or
    // every paragraph gets a capital and the writer has no control.
    mount('<p>a</p><p>b</p><p>c</p>')

    expect(capped()).toEqual([0])
  })

  it('illuminates a paragraph that follows a deliberate gap', () => {
    // An empty paragraph is what an extra blank line becomes (markdown.ts).
    mount('<p>a</p><p></p><p>b</p>')

    expect(capped()).toContain(0)
    expect(capped()).toContain(2)
  })

  it('works from stored Markdown end to end', () => {
    // The gesture the writer actually performs: an extra Return, saved as an
    // extra blank line, parsed back into an empty paragraph.
    mountMarkdown('One.\n\nTwo.\n\n\nThree.\n')
    const paragraphs = [...(editor?.view.dom.querySelectorAll('p') ?? [])]
    const withCap = paragraphs.filter((p) => p.classList.contains('drop-cap'))

    expect(withCap).toHaveLength(2)
    expect(withCap[0].textContent).toBe('One.')
    expect(withCap[1].textContent).toBe('Three.')
  })

  it('does not illuminate the empty paragraph itself', () => {
    mount('<p>a</p><p></p><p>b</p>')
    const paragraphs = [...(editor?.view.dom.querySelectorAll('p') ?? [])]

    expect(paragraphs[1].classList.contains('drop-cap')).toBe(false)
  })

  it('still opens on the first paragraph with words, after leading blanks', () => {
    mount('<p></p><p>Real opening.</p>')
    const paragraphs = [...(editor?.view.dom.querySelectorAll('p') ?? [])]

    expect(paragraphs[1].classList.contains('drop-cap')).toBe(true)
  })

  it('illuminates once, not twice, after several blank lines', () => {
    mount('<p>a</p><p></p><p></p><p>b</p>')

    expect(capped()).toEqual([0, 3])
  })
})
