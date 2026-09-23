import MarkdownIt from 'markdown-it'
import markPlugin from 'markdown-it-mark'
import type { JSONContent } from '@tiptap/core'
import type Token from 'markdown-it/lib/token.mjs'

/**
 * WyrmStar stores prose as Markdown: paragraphs plus the three supported
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
  /** Line after the previous paragraph, for measuring the gap to the next. */
  let previousEnd: number | null = null
  let pendingMap: [number, number] | null = null

  for (const token of tokens) {
    if (token.type === 'paragraph_open') {
      pendingMap = (token.map as [number, number] | null) ?? null
      continue
    }
    if (token.type !== 'inline' || !token.children) continue

    // Authored spacing survives the round trip. markdown-it collapses any run
    // of blank lines into a single paragraph break, so the line numbers are
    // the only surviving record of how many the writer actually typed: one
    // blank line is an ordinary break, and every blank line beyond that is a
    // deliberate gap, kept as an empty paragraph.
    //
    // Without this, a writer's blank line vanished the next time the document
    // was opened — the file on disk kept it (docToMarkdown always wrote it
    // back out), but parsing dropped it, and the following save then erased
    // it for good. Silent loss of something authored, which the house rules
    // do not allow.
    if (pendingMap && previousEnd != null) {
      const blankLines = pendingMap[0] - previousEnd
      for (let i = 1; i < blankLines; i++) paragraphs.push({ type: 'paragraph' })
    }

    const content = inlineToNodes(token.children)
    paragraphs.push(content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' })
    if (pendingMap) previousEnd = pendingMap[1]
    pendingMap = null
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
  /** Serialized text paragraphs, and the empty paragraphs standing before each. */
  const texts: string[] = []
  const gaps: number[] = []
  let pendingEmpties = 0

  for (const block of doc.content ?? []) {
    if (block.type !== 'paragraph') continue
    // Escape block-level markers other tools might interpret at line start.
    const text = serializeInline(block.content ?? []).replace(/^([#>+-])/, '\\$1')
    if (text === '') {
      pendingEmpties++
      continue
    }
    texts.push(text)
    gaps.push(pendingEmpties)
    pendingEmpties = 0
  }

  if (texts.length === 0) return ''

  // An empty paragraph is written as **one** extra newline, not as an empty
  // entry in a `\n\n` join. That asymmetry matters: `markdownToDoc` reads a
  // run of b blank lines back as b-1 empty paragraphs, so writing 2 newlines
  // per empty paragraph would read back as twice as many, and the gap would
  // double on every single save. One newline each is the fixed point —
  // `tests/markdown.test.ts` pins it by round-tripping twice.
  //
  // Leading and trailing empty paragraphs are dropped: a file that opens or
  // ends on blank lines is noise, and Markdown discards them on parse anyway.
  let out = texts[0]
  for (let i = 1; i < texts.length; i++) {
    out += '\n\n' + '\n'.repeat(gaps[i]) + texts[i]
  }
  return out + '\n'
}

// Re-exported so the existing `from './markdown'` imports keep working, but
// the definition lives in shared/ because the main-process stats engine needs
// the identical rule — see the note there.
export { countWords } from '../../../shared/words'
