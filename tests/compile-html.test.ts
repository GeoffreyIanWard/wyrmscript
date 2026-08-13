import { describe, expect, it } from 'vitest'
import { renderHtml } from '../src/renderer/src/lib/compile'
import type { CompileBlock } from '../src/shared/types'

/**
 * F-38: the HTML that becomes a PDF. Pagination itself is Chromium's job and
 * cannot be asserted here — what can, and what actually breaks, is the
 * escaping (manuscript prose is full of quotes and angle brackets), the mark
 * mapping, and the page-model CSS that tells the print engine what a page is.
 */

const para = (text: string): CompileBlock => ({
  kind: 'paragraph',
  runs: [{ text }]
})

describe('rendering compile blocks to print HTML', () => {
  it('escapes characters that would otherwise be markup', () => {
    // A novel containing <, > or & is not exotic, and an unescaped one would
    // silently swallow the rest of the paragraph in the PDF.
    const html = renderHtml([para('Ampersands & <angles> and "quotes"')])

    expect(html).toContain('Ampersands &amp; &lt;angles&gt; and &quot;quotes&quot;')
    expect(html).not.toContain('<angles>')
  })

  it('maps the three supported marks and nothing else', () => {
    const html = renderHtml([
      {
        kind: 'paragraph',
        runs: [
          { text: 'b', bold: true },
          { text: 'i', italic: true },
          { text: 'h', highlight: true }
        ]
      }
    ])

    expect(html).toContain('<strong>b</strong>')
    expect(html).toContain('<em>i</em>')
    expect(html).toContain('<mark>h</mark>')
  })

  it('nests overlapping marks rather than dropping one', () => {
    const html = renderHtml([
      { kind: 'paragraph', runs: [{ text: 'x', bold: true, italic: true }] }
    ])

    expect(html).toContain('<strong><em>x</em></strong>')
  })

  it('renders a hard break as a line break, not a paragraph', () => {
    const html = renderHtml([
      { kind: 'paragraph', runs: [{ text: 'a' }, { break: true }, { text: 'b' }] }
    ])

    expect(html).toContain('a<br>b')
  })

  it('declares a real paper size and margins — the whole page model', () => {
    // Without an @page rule the print engine falls back to its own defaults,
    // which is how a "manuscript format" PDF quietly stops being one.
    const html = renderHtml([para('x')])

    expect(html).toMatch(/@page\s*\{[^}]*size:\s*Letter/)
    expect(html).toMatch(/@page\s*\{[^}]*margin:\s*1in/)
  })

  it('turns a page-break block into an actual forced break', () => {
    const html = renderHtml([para('one'), { kind: 'pageBreak' }, para('two')])

    expect(html).toContain('class="page-break"')
    expect(html).toMatch(/\.page-break\s*\{\s*page-break-after:\s*always/)
  })

  it('puts the title page on its own sheet', () => {
    const html = renderHtml([
      { kind: 'titlePage', title: 'The Wyrm of Winter', lines: ['A novel'] }
    ])

    expect(html).toContain('The Wyrm of Winter')
    expect(html).toContain('A novel')
    expect(html).toMatch(/\.title-page\s*\{[^}]*page-break-after:\s*always/)
  })

  it('omits an empty separator rather than emitting a blank paragraph', () => {
    // The "blank line between scenes" preset has no text; rendering it as an
    // empty <p> would double the gap in print.
    const html = renderHtml([para('one'), { kind: 'separator', text: '' }, para('two')])

    expect(html).not.toContain('<p class="sep"></p>')
  })

  it('centres a separator that does have text', () => {
    const html = renderHtml([{ kind: 'separator', text: '* * *' }])

    expect(html).toContain('<p class="sep">* * *</p>')
  })
})
