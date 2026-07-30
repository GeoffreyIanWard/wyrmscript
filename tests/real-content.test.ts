import { describe, expect, it } from 'vitest'
import { docToMarkdown, markdownToDoc } from '../src/renderer/src/lib/markdown'

/**
 * Regression fixture taken verbatim from a real project file after the
 * "indentation drifts right" report: bold run, hard breaks, and a highlight
 * mark that persisted across lines.
 */
const real =
  'This is the first scene! It is the only scene! **IT IS THE FINAL SCENE.**\\\n==**Lorum Impsom**==\\\n==Lorem ipsum==\n\n==*Lorem ipsum*==\n'

describe('real-world content round-trip', () => {
  it('is stable and preserves structure', () => {
    const doc = markdownToDoc(real)
    const out = docToMarkdown(doc)
    expect(out).toBe(real)
    expect(docToMarkdown(markdownToDoc(out))).toBe(out)
  })

  it('keeps hard breaks inside one paragraph and does not inject leading space', () => {
    const doc = markdownToDoc(real)
    expect(doc.content).toHaveLength(2)
    const first = doc.content![0]
    expect(first.content!.filter((n) => n.type === 'hardBreak')).toHaveLength(2)
    // No paragraph may start with whitespace — that would read as drifting indent.
    for (const para of doc.content!) {
      const firstText = para.content?.find((n) => n.type === 'text')
      if (firstText?.text) expect(firstText.text).toBe(firstText.text.trimStart())
    }
  })

  it('does not spread the highlight mark onto unmarked text', () => {
    const doc = markdownToDoc(real)
    const firstPara = doc.content![0]
    const opening = firstPara.content![0]
    expect(opening.text).toContain('This is the first scene!')
    expect(opening.marks ?? []).toHaveLength(0)
  })
})
