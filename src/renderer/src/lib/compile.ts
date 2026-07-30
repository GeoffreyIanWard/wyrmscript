import type { JSONContent } from '@tiptap/core'
import type {
  BinderNode,
  CompileBlock,
  CompileInline,
  CompileOptions,
  CompileResult,
  CompileRun,
  DocFile,
  ProjectData
} from '../../../shared/types'
import { countWords, docToMarkdown, markdownToDoc } from './markdown'
import { docxBytes } from './docx'

/**
 * Compile: assemble binder items into a finished manuscript (brief §8).
 *
 * The pipeline is deliberately two-stage — binder + documents are flattened
 * into a format-independent block list first (`buildBlocks`), and each output
 * format is a pure function of that list. Selection, ordering and separator
 * behaviour therefore exist in exactly one place regardless of how many
 * formats are added later.
 *
 * Story-bible auto-links never appear here by construction: they are
 * ProseMirror decorations, never marks, so they are not part of the stored
 * Markdown at all (house rules). `tests/compile.test.ts` pins that down.
 */

export const SEPARATOR_PRESETS = ['#', '* * *', '~', ''] as const

export const DEFAULT_COMPILE_OPTIONS: CompileOptions = {
  format: 'txt',
  includeIds: null,
  separator: '#',
  titlePage: false,
  docTitles: false,
  folderTitles: false,
  pageBreakBetweenFolders: false
}

/** One binder document, in binder order, with the folder path above it. */
interface FlatItem {
  node: BinderNode
  /** Folder titles from the root down to this document's parent. */
  folders: string[]
}

/**
 * Flatten the binder in reading order, keeping only documents whose id is
 * selected. Trash is skipped by construction: `ProjectData.trash` is a
 * separate tree and is never walked here.
 */
export function flattenBinder(binder: BinderNode[], includeIds: string[] | null): FlatItem[] {
  const wanted = includeIds === null ? null : new Set(includeIds)
  const items: FlatItem[] = []
  const walk = (nodes: BinderNode[], folders: string[]): void => {
    for (const node of nodes) {
      if (node.type === 'folder') {
        walk(node.children ?? [], [...folders, node.title])
      } else if (wanted === null || wanted.has(node.id)) {
        items.push({ node, folders })
      }
    }
  }
  walk(binder, [])
  return items
}

/** Every document id in the binder, in order — the "whole project" selection. */
export function allDocIds(binder: BinderNode[]): string[] {
  return flattenBinder(binder, null).map((item) => item.node.id)
}

function runsFromParagraph(paragraph: JSONContent): CompileInline[] {
  const runs: CompileInline[] = []
  for (const node of paragraph.content ?? []) {
    if (node.type === 'hardBreak') {
      runs.push({ break: true })
      continue
    }
    if (node.type !== 'text' || !node.text) continue
    const marks = (node.marks ?? []).map((m) => m.type)
    const run: CompileRun = { text: node.text }
    if (marks.includes('bold')) run.bold = true
    if (marks.includes('italic')) run.italic = true
    if (marks.includes('highlight')) run.highlight = true
    runs.push(run)
  }
  return runs
}

function isBlank(body: string): boolean {
  return body.trim().length === 0
}

/**
 * The selected documents that will actually contribute output. A missing
 * document is skipped rather than throwing — a compile must never fail
 * because one file went missing.
 */
function compiledItems(
  project: ProjectData,
  docs: Map<string, DocFile>,
  options: CompileOptions
): FlatItem[] {
  return flattenBinder(project.binder, options.includeIds).filter((item) => {
    const doc = docs.get(item.node.id)
    // An empty document contributes nothing unless its title is being printed,
    // so an unwritten scene never shows up as a stray separator.
    return doc != null && (options.docTitles || !isBlank(doc.body))
  })
}

/**
 * Turn a project's binder plus its documents into the block list.
 * `docs` is keyed by document id.
 */
export function buildBlocks(
  project: ProjectData,
  docs: Map<string, DocFile>,
  options: CompileOptions
): CompileBlock[] {
  const items = compiledItems(project, docs, options)
  const blocks: CompileBlock[] = []
  let previousFolders: string[] | null = null

  items.forEach((item, index) => {
    const doc = docs.get(item.node.id)
    if (!doc) return
    const folderPath = item.folders.join(' / ')
    const newFolder = previousFolders === null || folderPath !== previousFolders.join(' / ')

    if (index > 0) {
      if (newFolder && options.pageBreakBetweenFolders) blocks.push({ kind: 'pageBreak' })
      else blocks.push({ kind: 'separator', text: options.separator })
    }
    if (newFolder && options.folderTitles && item.folders.length > 0) {
      blocks.push({ kind: 'heading', level: 1, text: item.folders[item.folders.length - 1] })
    }
    if (options.docTitles) {
      blocks.push({ kind: 'heading', level: 2, text: item.node.title })
    }
    for (const paragraph of markdownToDoc(doc.body).content ?? []) {
      if (paragraph.type !== 'paragraph') continue
      const runs = runsFromParagraph(paragraph)
      // Parsing never yields interior empty paragraphs (blank lines collapse),
      // so an empty one is noise from a blank document, not authored spacing.
      if (runs.length > 0) blocks.push({ kind: 'paragraph', runs })
    }
    previousFolders = item.folders
  })

  if (options.titlePage) {
    const words = countBlockWords(blocks)
    blocks.unshift({
      kind: 'titlePage',
      title: project.title,
      lines: [`${words.toLocaleString()} words`]
    })
  }
  return blocks
}

/** Prose words only — headings, separators and the title page do not count. */
export function countBlockWords(blocks: CompileBlock[]): number {
  let total = 0
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue
    total += countWords(runsToPlain(block.runs, ' '))
  }
  return total
}

function runsToPlain(runs: CompileInline[], breakAs: string): string {
  return runs.map((run) => ('break' in run ? breakAs : run.text)).join('')
}

/* ---------- plain text ---------- */

/**
 * Plain text keeps the words and drops the markup — there is no honest way to
 * render bold in a .txt file, and inventing asterisks would be Markdown.
 */
export function renderText(blocks: CompileBlock[]): string {
  const chunks: string[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'titlePage':
        chunks.push([block.title, '', ...block.lines].join('\n'))
        break
      case 'heading':
        chunks.push(block.text)
        break
      case 'separator':
        if (block.text) chunks.push(block.text)
        break
      case 'pageBreak':
        // Form feed is the plain-text page break, and has been since teletypes.
        chunks.push('\f')
        break
      case 'paragraph':
        chunks.push(runsToPlain(block.runs, '\n'))
        break
    }
  }
  return chunks.join('\n\n') + (chunks.length > 0 ? '\n' : '')
}

/* ---------- markdown ---------- */

function runsToJson(runs: CompileInline[]): JSONContent {
  const content: JSONContent[] = runs.map((run) => {
    if ('break' in run) return { type: 'hardBreak' }
    const marks: { type: string }[] = []
    if (run.highlight) marks.push({ type: 'highlight' })
    if (run.bold) marks.push({ type: 'bold' })
    if (run.italic) marks.push({ type: 'italic' })
    const node: JSONContent = { type: 'text', text: run.text }
    if (marks.length > 0) node.marks = marks
    return node
  })
  return { type: 'doc', content: [{ type: 'paragraph', content }] }
}

/**
 * Paragraphs are serialized by the same writer the editor saves through
 * (`docToMarkdown`), so compiled Markdown is byte-identical to the stored
 * files — escaping, mark nesting and hard breaks included.
 */
export function renderMarkdown(blocks: CompileBlock[]): string {
  const chunks: string[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'titlePage':
        chunks.push([`# ${block.title}`, '', ...block.lines].join('\n'))
        break
      case 'heading':
        chunks.push(`${'#'.repeat(block.level + 1)} ${block.text}`)
        break
      case 'separator':
        chunks.push(block.text || '')
        break
      case 'pageBreak':
        chunks.push('---')
        break
      case 'paragraph':
        chunks.push(docToMarkdown(runsToJson(block.runs)).replace(/\n$/, ''))
        break
    }
  }
  // An empty separator means "blank line between scenes", which the join
  // already provides — keeping it would double the gap.
  const kept = chunks.filter((chunk) => chunk !== '')
  return kept.join('\n\n') + (kept.length > 0 ? '\n' : '')
}

/* ---------- entry point ---------- */

const EXTENSIONS: Record<CompileOptions['format'], string> = {
  txt: 'txt',
  md: 'md',
  docx: 'docx'
}

/**
 * `withBytes` is off by default because the compile dialog recomputes on every
 * option change: building the .docx container for a 100,000-word manuscript on
 * each keystroke would stall the UI, and the preview only ever shows text.
 */
export function compile(
  project: ProjectData,
  docs: Map<string, DocFile>,
  options: CompileOptions,
  withBytes = false
): CompileResult {
  const blocks = buildBlocks(project, docs, options)
  const result: CompileResult = {
    blocks,
    wordCount: countBlockWords(blocks),
    docCount: compiledItems(project, docs, options).length,
    text: options.format === 'md' ? renderMarkdown(blocks) : renderText(blocks),
    extension: EXTENSIONS[options.format]
  }
  // The .docx preview shows the plain-text rendering; the bytes are what gets
  // written to disk.
  if (withBytes && options.format === 'docx') result.bytes = docxBytes(blocks)
  return result
}

/** Filesystem-safe default filename for a compiled manuscript. */
export function compileFileName(title: string, extension: string): string {
  const base = title.replace(/[/\\:*?"<>|]/g, '').trim() || 'Manuscript'
  return `${base}.${extension}`
}
