import MarkdownIt from 'markdown-it'
import markPlugin from 'markdown-it-mark'
import type { JSONContent } from '@tiptap/core'
import type Token from 'markdown-it/lib/token.mjs'

/**
 * Wyrmscript stores prose as Markdown: paragraphs plus the three supported
 * marks — **bold**, *italic*, ==highlight== (markdown-it-mark syntax).
 * These converters translate between that format and TipTap's JSON document.
 */

const md = new MarkdownIt('zero', { breaks: false })
md.enable(['emphasis', 'escape', 'paragraph', 'newline'])
md.use(markPlugin)

type MarkName = 'bold' | 'italic' | 'highlight'

const OPEN_TOKEN_MARK: Record<string, MarkName> = {
  strong_open: 'bold',
  em_open: 'italic',
  mark_open: 'highlight'
}

const CLOSE_TOKEN_MARK: Record<string, MarkName> = {
  strong_close: 'bold',
  em_close: 'italic',
  mark_close: 'highlight'
}

function inlineToNodes(tokens: Token[]): JSONContent[] {
  const nodes: JSONContent[] = []
  const active: MarkName[] = []

  const pushText = (text: string): void => {
    if (!text) return
    const node: JSONContent = { type: 'text', text }
    if (active.length > 0) node.marks = active.map((m) => ({ type: m }))
    nodes.push(node)
  }

  for (const token of tokens) {
    if (token.type in OPEN_TOKEN_MARK) {
      active.push(OPEN_TOKEN_MARK[token.type])
    } else if (token.type in CLOSE_TOKEN_MARK) {
      const i = active.lastIndexOf(CLOSE_TOKEN_MARK[token.type])
      if (i !== -1) active.splice(i, 1)
    } else if (token.type === 'text') {
      pushText(token.content)
    } else if (token.type === 'softbreak') {
      pushText(' ')
    } else if (token.type === 'hardbreak') {
      nodes.push({ type: 'hardBreak' })
    } else if (token.content) {
      // Unknown inline construct — keep its text so nothing is ever lost.
      pushText(token.content)
    }
  }
  return nodes
}

export function markdownToDoc(source: string): JSONContent {
  const tokens = md.parse(source, {})
  const paragraphs: JSONContent[] = []
  for (const token of tokens) {
    if (token.type === 'inline' && token.children) {
      const content = inlineToNodes(token.children)
      paragraphs.push(content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' })
    }
  }
  if (paragraphs.length === 0) paragraphs.push({ type: 'paragraph' })
  return { type: 'doc', content: paragraphs }
}

/** Escape characters that would be re-interpreted as Markdown syntax. */
function escapeText(text: string): string {
  return text.replace(/([\\*_`[\]~])/g, '\\$1').replace(/==/g, '\\=\\=')
}

const MARK_DELIMS: Record<MarkName, string> = { bold: '**', italic: '*', highlight: '==' }
// Serialization order: outermost first so nesting is stable across round-trips.
const MARK_ORDER: MarkName[] = ['highlight', 'bold', 'italic']

function hasMark(node: JSONContent, mark: MarkName): boolean {
  return node.type === 'text' && (node.marks ?? []).some((m) => m.type === mark)
}

/** Wrap in delimiters, keeping edge whitespace outside them (Markdown requires it). */
function wrapRun(inner: string, delim: string): string {
  const match = inner.match(/^(\s*)([\s\S]*?)(\s*)$/)
  if (!match) return inner
  const [, lead, core, trail] = match
  if (!core) return inner
  return `${lead}${delim}${core}${delim}${trail}`
}

/**
 * Serialize inline nodes by grouping maximal runs sharing each mark (in
 * MARK_ORDER precedence), so adjacent nodes merge into one delimited span:
 * bold / bold+italic / bold → `**bold *both* bold**`, not three bold spans.
 */
function serializeInline(nodes: JSONContent[], level = 0): string {
  if (level >= MARK_ORDER.length) {
    return nodes
      .map((node) => (node.type === 'hardBreak' ? '\\\n' : escapeText(node.text ?? '')))
      .join('')
  }
  const mark = MARK_ORDER[level]
  let out = ''
  let i = 0
  while (i < nodes.length) {
    const marked = hasMark(nodes[i], mark)
    let j = i
    while (j < nodes.length && hasMark(nodes[j], mark) === marked) j++
    const run = serializeInline(nodes.slice(i, j), level + 1)
    out += marked ? wrapRun(run, MARK_DELIMS[mark]) : run
    i = j
  }
  return out
}

export function docToMarkdown(doc: JSONContent): string {
  const paragraphs: string[] = []
  for (const block of doc.content ?? []) {
    if (block.type !== 'paragraph') continue
    // Escape block-level markers other tools might interpret at line start.
    paragraphs.push(serializeInline(block.content ?? []).replace(/^([#>+-])/, '\\$1'))
  }
  // Drop trailing empty paragraphs but keep interior ones meaningful (as best
  // Markdown allows — consecutive blanks collapse on the next parse).
  while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1] === '') paragraphs.pop()
  return paragraphs.join('\n\n') + (paragraphs.length > 0 ? '\n' : '')
}

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.length
}
