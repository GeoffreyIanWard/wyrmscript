import { describe, expect, it } from 'vitest'
import type { BinderNode, CompileOptions, DocFile, ProjectData } from '../src/shared/types'
import {
  DEFAULT_COMPILE_OPTIONS,
  allDocIds,
  compile,
  compileFileName,
  flattenBinder
} from '../src/renderer/src/lib/compile'
import { countWords } from '../src/renderer/src/lib/markdown'

/**
 * Fixture taken verbatim from a real project file (the same one
 * real-content.test.ts guards): a bold run, hard breaks, and a highlight mark
 * that persists across lines.
 */
const REAL_A =
  'This is the first scene! It is the only scene! **IT IS THE FINAL SCENE.**\\\n==**Lorum Impsom**==\\\n==Lorem ipsum==\n\n==*Lorem ipsum*==\n'

/** The demo manuscript's second scene — multi-paragraph, all three marks. */
const REAL_B =
  'The knock came an hour past midnight, three slow raps that carried through the shutters like stones dropped down a well. Elara Voss was awake before the third. Old habits from the war did not sleep, even when she did.\n\nShe lit no candle. The wyrmlight in the window-glass gave enough of a glow to dress by — that faint green shimmer every house in Harrowgate had learned to live with. *Someone is standing very still out there,* she thought, buckling her belt.\n\nThe knock came again. Not louder. **Exactly** as loud, which was worse.\n\nMarten laughed at everything, which was ==the first thing the sea took== and the last thing she intended to get back.\n'

const now = '2026-07-30T00:00:00.000Z'

function doc(id: string, title: string, body: string): DocFile {
  return { meta: { id, title, status: 'draft', created: now, modified: now }, body }
}

function folder(id: string, title: string, children: BinderNode[]): BinderNode {
  return { id, type: 'folder', title, children }
}

function docNode(id: string, title: string): BinderNode {
  return { id, type: 'doc', title }
}

/**
 * Two-part manuscript plus a notes folder, and one document sitting in Trash —
 * the shape that exercises ordering, folders, and exclusion at once.
 */
function fixture(): { project: ProjectData; docs: Map<string, DocFile> } {
  const project: ProjectData = {
    version: 1,
    title: 'The Wyrm of Winter',
    binder: [
      folder('f-ms', 'Manuscript', [
        folder('f-one', 'Part One', [docNode('d1', 'Scene One'), docNode('d2', 'Scene Two')]),
        folder('f-two', 'Part Two', [docNode('d3', 'Scene Three')])
      ]),
      folder('f-notes', 'Notes', [docNode('d4', 'Timeline')])
    ],
    trash: [docNode('d-trash', 'Cut Scene')]
  }
  const docs = new Map<string, DocFile>([
    ['d1', doc('d1', 'Scene One', 'Alpha one.\n')],
    ['d2', doc('d2', 'Scene Two', 'Beta two.\n')],
    ['d3', doc('d3', 'Scene Three', 'Gamma three.\n')],
    ['d4', doc('d4', 'Timeline', 'Year zero.\n')],
    ['d-trash', doc('d-trash', 'Cut Scene', 'This was cut and must never compile.\n')]
  ])
  return { project, docs }
}

function options(overrides: Partial<CompileOptions> = {}): CompileOptions {
  return { ...DEFAULT_COMPILE_OPTIONS, ...overrides }
}

describe('selection and ordering', () => {
  it('walks the binder in reading order, flattening folders', () => {
    const { project } = fixture()
    expect(flattenBinder(project.binder, null).map((i) => i.node.id)).toEqual([
      'd1',
      'd2',
      'd3',
      'd4'
    ])
    expect(allDocIds(project.binder)).toEqual(['d1', 'd2', 'd3', 'd4'])
  })

  it('records the folder path above each document', () => {
    const { project } = fixture()
    const flat = flattenBinder(project.binder, null)
    expect(flat[0].folders).toEqual(['Manuscript', 'Part One'])
    expect(flat[3].folders).toEqual(['Notes'])
  })

  it('keeps only the selected documents, still in binder order', () => {
    const { project, docs } = fixture()
    const out = compile(project, docs, options({ includeIds: ['d3', 'd1'] })).text
    expect(out).toContain('Alpha one.')
    expect(out).toContain('Gamma three.')
    expect(out).not.toContain('Beta two.')
    expect(out.indexOf('Alpha one.')).toBeLessThan(out.indexOf('Gamma three.'))
  })

  it('never compiles a document in Trash, even if its id is selected', () => {
    const { project, docs } = fixture()
    const out = compile(project, docs, options({ includeIds: ['d1', 'd-trash'] }))
    expect(out.text).not.toContain('must never compile')
    expect(out.docCount).toBe(1)
  })

  it('skips documents that are missing or empty rather than emitting a stray separator', () => {
    const { project, docs } = fixture()
    docs.set('d2', doc('d2', 'Scene Two', '   \n'))
    docs.delete('d3')
    const out = compile(project, docs, options())
    expect(out.docCount).toBe(2)
    expect(out.text.match(/^#$/gm) ?? []).toHaveLength(1)
  })
})

describe('separators, titles and page breaks', () => {
  it('puts the separator between documents but not before the first', () => {
    const { project, docs } = fixture()
    const out = compile(project, docs, options({ separator: '* * *' })).text
    expect(out.startsWith('Alpha one.')).toBe(true)
    expect(out.match(/\* \* \*/g) ?? []).toHaveLength(3)
  })

  it('uses a bare blank line when the separator is empty', () => {
    const { project, docs } = fixture()
    const out = compile(project, docs, options({ separator: '', includeIds: ['d1', 'd2'] })).text
    expect(out).toBe('Alpha one.\n\nBeta two.\n')
  })

  it('adds a title page carrying the project title and compiled word count', () => {
    const { project, docs } = fixture()
    const out = compile(project, docs, options({ titlePage: true }))
    expect(out.text.startsWith('The Wyrm of Winter\n\n8 words\n')).toBe(true)
    expect(out.wordCount).toBe(8)
  })

  it('prints folder and document titles when asked', () => {
    const { project, docs } = fixture()
    const out = compile(
      project,
      docs,
      options({ folderTitles: true, docTitles: true, includeIds: ['d1', 'd3'] })
    ).text
    expect(out).toContain('Part One')
    expect(out).toContain('Scene One')
    expect(out).toContain('Part Two')
  })

  it('replaces the separator with a page break at folder boundaries when enabled', () => {
    const { project, docs } = fixture()
    const out = compile(project, docs, options({ pageBreakBetweenFolders: true })).text
    // d1→d2 stays inside Part One; d2→d3 and d3→d4 cross folders.
    expect(out.match(/\f/g) ?? []).toHaveLength(2)
    expect(out.match(/^#$/gm) ?? []).toHaveLength(1)
  })

  it('marks headings with Markdown hashes in Markdown output', () => {
    const { project, docs } = fixture()
    const out = compile(
      project,
      docs,
      options({ format: 'md', folderTitles: true, docTitles: true, includeIds: ['d1'] })
    ).text
    expect(out).toContain('## Part One')
    expect(out).toContain('### Scene One')
  })
})

describe('formatting', () => {
  it('round-trips real Markdown fixtures byte for byte', () => {
    for (const body of [REAL_A, REAL_B]) {
      const project: ProjectData = {
        version: 1,
        title: 'T',
        binder: [docNode('only', 'Only')],
        trash: []
      }
      const docs = new Map([['only', doc('only', 'Only', body)]])
      expect(compile(project, docs, options({ format: 'md' })).text).toBe(body)
    }
  })

  it('keeps every word but no markup in plain text', () => {
    const project: ProjectData = {
      version: 1,
      title: 'T',
      binder: [docNode('only', 'Only')],
      trash: []
    }
    const docs = new Map([['only', doc('only', 'Only', REAL_A)]])
    const out = compile(project, docs, options({ format: 'txt' })).text
    expect(out).toContain('IT IS THE FINAL SCENE.')
    expect(out).toContain('Lorum Impsom')
    expect(out).not.toContain('**')
    expect(out).not.toContain('==')
  })

  it('carries bold, italic and highlight into the block model', () => {
    const project: ProjectData = {
      version: 1,
      title: 'T',
      binder: [docNode('only', 'Only')],
      trash: []
    }
    const docs = new Map([['only', doc('only', 'Only', 'a **b** *c* ==d==\n')]])
    const runs = compile(project, docs, options()).blocks.flatMap((b) =>
      b.kind === 'paragraph' ? b.runs : []
    )
    const marked = runs.filter(
      (r): r is { text: string } & Record<string, boolean> => !('break' in r)
    )
    expect(marked.find((r) => r.text === 'b')?.bold).toBe(true)
    expect(marked.find((r) => r.text === 'c')?.italic).toBe(true)
    expect(marked.find((r) => r.text === 'd')?.highlight).toBe(true)
  })

  it('turns hard breaks into line breaks, not paragraph breaks', () => {
    const project: ProjectData = {
      version: 1,
      title: 'T',
      binder: [docNode('only', 'Only')],
      trash: []
    }
    const docs = new Map([['only', doc('only', 'Only', 'first\\\nsecond\n')]])
    expect(compile(project, docs, options()).text).toBe('first\nsecond\n')
  })

  it('emits no link markup for text naming story-bible entities', () => {
    // Auto-links are ProseMirror decorations, never marks, so they are not in
    // the stored Markdown and cannot survive into a compile. Pin that down.
    const project: ProjectData = {
      version: 1,
      title: 'T',
      binder: [docNode('only', 'Only')],
      trash: []
    }
    const docs = new Map([['only', doc('only', 'Only', REAL_B)]])
    for (const format of ['txt', 'md'] as const) {
      const out = compile(project, docs, options({ format })).text
      expect(out).toContain('Elara Voss')
      expect(out).toContain('Harrowgate')
      expect(out).not.toMatch(/\[[^\]]*]\([^)]*\)/)
      expect(out).not.toContain('wyrm-entity')
      expect(out).not.toContain('<a ')
    }
  })
})

describe('reporting', () => {
  it('counts prose words only, matching the status bar', () => {
    const { project, docs } = fixture()
    const out = compile(project, docs, options({ titlePage: true, docTitles: true }))
    const prose = ['Alpha one.', 'Beta two.', 'Gamma three.', 'Year zero.']
    expect(out.wordCount).toBe(prose.reduce((n, body) => n + countWords(body), 0))
    expect(out.docCount).toBe(4)
  })

  it('names the file after the project, without path-hostile characters', () => {
    expect(compileFileName('The Wyrm of Winter', 'txt')).toBe('The Wyrm of Winter.txt')
    expect(compileFileName('A/B: "C"', 'md')).toBe('AB C.md')
    expect(compileFileName('   ', 'docx')).toBe('Manuscript.docx')
  })
})
