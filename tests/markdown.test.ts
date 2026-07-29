import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { countWords, docToMarkdown, markdownToDoc } from '../src/renderer/src/lib/markdown'

function roundTrip(md: string): string {
  return docToMarkdown(markdownToDoc(md))
}

function docText(doc: JSONContent): string {
  const parts: string[] = []
  const visit = (node: JSONContent): void => {
    if (node.text) parts.push(node.text)
    node.content?.forEach(visit)
  }
  visit(doc)
  return parts.join('')
}

describe('markdownToDoc', () => {
  it('parses a simple paragraph', () => {
    expect(markdownToDoc('Hello world.\n')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world.' }] }]
    })
  })

  it('parses bold, italic, and highlight marks', () => {
    const doc = markdownToDoc('a **bold** b *italic* c ==lit== d\n')
    const para = doc.content![0]
    const marked = para.content!.filter((n) => n.marks)
    expect(marked.map((n) => [n.text, n.marks![0].type])).toEqual([
      ['bold', 'bold'],
      ['italic', 'italic'],
      ['lit', 'highlight']
    ])
  })

  it('parses nested marks', () => {
    const doc = markdownToDoc('**bold *both* bold**\n')
    const nodes = doc.content![0].content!
    expect(nodes[0].marks!.map((m) => m.type)).toEqual(['bold'])
    expect(nodes[1].marks!.map((m) => m.type).sort()).toEqual(['bold', 'italic'])
    expect(nodes[2].marks!.map((m) => m.type)).toEqual(['bold'])
  })

  it('splits paragraphs on blank lines', () => {
    const doc = markdownToDoc('One.\n\nTwo.\n\nThree.\n')
    expect(doc.content).toHaveLength(3)
  })

  it('produces a single empty paragraph for empty input', () => {
    expect(markdownToDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })
})

describe('docToMarkdown', () => {
  it('serializes an empty doc to an empty string', () => {
    expect(docToMarkdown({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('')
  })

  it('keeps mark delimiters off surrounding whitespace', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: ' padded ', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'z' }
          ]
        }
      ]
    }
    const md = docToMarkdown(doc)
    expect(md).toBe('a **padded** z\n')
    expect(docText(markdownToDoc(md))).toBe('a padded z')
  })

  it('escapes markdown punctuation so text survives a round-trip', () => {
    const text = 'stars *literal*, under_score, brackets [x], tick `y`, back\\slash, eq == eq'
    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
    }
    const md = docToMarkdown(doc)
    expect(docText(markdownToDoc(md))).toBe(text)
  })
})

describe('round-trip stability', () => {
  const cases = [
    'Plain paragraph.\n',
    'With **bold** and *italic* and ==highlight==.\n',
    'Nested **bold *both* bold** run.\n',
    'One.\n\nTwo with **marks**.\n\nThree.\n'
  ]
  for (const md of cases) {
    it(`is a fixed point for: ${JSON.stringify(md.slice(0, 30))}`, () => {
      const once = roundTrip(md)
      expect(roundTrip(once)).toBe(once)
      expect(once).toBe(md)
    })
  }
})

describe('countWords', () => {
  it('counts simple words', () => {
    expect(countWords('one two three')).toBe(3)
  })
  it('handles empty and whitespace-only strings', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n ')).toBe(0)
  })
  it('splits on any whitespace run', () => {
    expect(countWords('a\nb\t c  d')).toBe(4)
  })
})
