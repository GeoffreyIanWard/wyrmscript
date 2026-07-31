import { describe, expect, it } from 'vitest'
import type { BinderNode, DocFile, Entity } from '../src/shared/types'
import {
  folderPaths,
  fuzzyMatch,
  plainTextOf,
  quickOpen,
  searchProject
} from '../src/renderer/src/lib/search'

const now = '2026-07-30T00:00:00.000Z'

function doc(id: string, title: string, body: string): DocFile {
  return { meta: { id, title, status: 'draft', created: now, modified: now }, body }
}

function entity(
  id: string,
  type: Entity['type'],
  name: string,
  body: string,
  aliases: string[] = []
): Entity {
  return { id, type, name, aliases, body, created: now, modified: now }
}

const binder: BinderNode[] = [
  {
    id: 'f-ms',
    type: 'folder',
    title: 'Manuscript',
    children: [
      {
        id: 'f-one',
        type: 'folder',
        title: 'Part One',
        children: [
          { id: 'd1', type: 'doc', title: 'The Wyrmlight Fades' },
          { id: 'd2', type: 'doc', title: 'A Knock at Night' }
        ]
      }
    ]
  },
  {
    id: 'f-notes',
    type: 'folder',
    title: 'Notes',
    children: [{ id: 'd3', type: 'doc', title: 'Timeline' }]
  }
]

const docs: DocFile[] = [
  doc(
    'd1',
    'The Wyrmlight Fades',
    'The last of the wyrmlight was going out of the harbor glass.\n'
  ),
  doc(
    'd2',
    'A Knock at Night',
    'The knock came an hour past midnight.\n\nThe knock came again. Not louder. **Exactly** as loud.\n'
  ),
  doc('d3', 'Timeline', 'Year 0 — the Siege of the Narrows.\n'),
  // Present on disk but absent from the binder: this one is in Trash.
  doc('d-trash', 'Cut Scene', 'The knock that was cut.\n')
]

const entities: Entity[] = [
  entity('e1', 'character', 'Elara Voss', 'Former harbor-guard captain.', ['the Captain']),
  entity('e2', 'glossary', 'wyrmlight', 'The faint green luminescence on glass.')
]

describe('folder paths', () => {
  it('records where each document lives', () => {
    const paths = folderPaths(binder)
    expect(paths.get('d1')).toBe('Manuscript / Part One')
    expect(paths.get('d3')).toBe('Notes')
  })
})

describe('full-project search', () => {
  it('finds a phrase in prose and reports how often it occurs', () => {
    const hits = searchProject('the knock came', docs, entities, binder)
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('A Knock at Night')
    expect(hits[0].total).toBe(2)
  })

  it('never returns a document that is only in Trash', () => {
    const hits = searchProject('knock', docs, entities, binder)
    expect(hits.map((h) => h.id)).not.toContain('d-trash')
  })

  it('searches story-bible bodies and matches on names and aliases', () => {
    expect(searchProject('harbor-guard', docs, entities, binder).map((h) => h.id)).toContain('e1')
    expect(searchProject('the captain', docs, entities, binder).map((h) => h.id)).toContain('e1')
  })

  it('is case-insensitive and returns readable snippets around the match', () => {
    const [hit] = searchProject('WYRMLIGHT', docs, entities, binder)
    const snippet = hit.snippets[0]
    expect(snippet.match.toLowerCase()).toBe('wyrmlight')
    expect(`${snippet.before}${snippet.match}${snippet.after}`).toContain('the harbor glass')
    // Newlines are collapsed so a row stays one line.
    expect(snippet.before + snippet.after).not.toContain('\n')
  })

  it('ranks the document with the most matches first', () => {
    const hits = searchProject('the', docs, entities, binder)
    expect(hits[0].total).toBeGreaterThanOrEqual(hits[hits.length - 1].total)
  })

  it('finds a phrase that spans a bold word', () => {
    // Stored as `Not louder. **Exactly** as loud`, so searching the raw
    // Markdown would fail here — the asterisks sit inside the phrase.
    const hits = searchProject('not louder. exactly as loud', docs, entities, binder)
    expect(hits.map((h) => h.id)).toContain('d2')
  })

  it('shows prose in snippets, never storage syntax', () => {
    const [hit] = searchProject('exactly', docs, entities, binder)
    const line = hit.snippets.map((s) => s.before + s.match + s.after).join(' ')
    expect(line).toContain('Exactly')
    expect(line).not.toContain('**')
  })

  it('stays quiet until the query is worth running', () => {
    expect(searchProject('', docs, entities, binder)).toEqual([])
    expect(searchProject('t', docs, entities, binder)).toEqual([])
  })
})

describe('quick open', () => {
  it('matches initials across a title', () => {
    const items = quickOpen('akn', binder, entities)
    expect(items[0].title).toBe('A Knock at Night')
  })

  it('offers everything when nothing is typed, documents first', () => {
    const items = quickOpen('', binder, entities)
    expect(items).toHaveLength(5) // 3 docs + 2 entities
    expect(items[0].kind).toBe('doc')
    expect(items[items.length - 1].kind).toBe('entity')
  })

  it('finds story-bible entries alongside documents', () => {
    expect(quickOpen('elara', binder, entities)[0].id).toBe('e1')
  })

  it('falls back to the folder path so a part name finds its scenes', () => {
    const items = quickOpen('part one', binder, entities)
    expect(items.map((i) => i.id)).toContain('d1')
  })

  it('includes actions when given them, ranked by the same match', () => {
    const items = quickOpen('comp', binder, entities, [
      { id: 'compile', title: 'Compile Manuscript…', subtitle: 'File' }
    ])
    expect(items[0].id).toBe('compile')
    expect(items[0].kind).toBe('action')
  })

  it('returns nothing when the query is not a subsequence of anything', () => {
    expect(quickOpen('zzzz', binder, entities)).toEqual([])
  })

  it('reports which characters matched, for emphasis', () => {
    const [hit] = quickOpen('wyrm', binder, entities)
    expect(hit.positions.length).toBe(4)
    expect(hit.title.toLowerCase()[hit.positions[0]]).toBe('w')
  })
})

describe('fuzzy scoring', () => {
  it('prefers word starts over incidental letter runs', () => {
    const atStarts = fuzzyMatch('pow', 'Part One Wyrm')!
    const buried = fuzzyMatch('pow', 'Apostrophe Below')!
    expect(atStarts.score).toBeGreaterThan(buried.score)
  })

  it('rejects a query whose letters are out of order', () => {
    expect(fuzzyMatch('nkock', 'A Knock at Night')).toBeNull()
  })
})

describe('plain-text projection', () => {
  it('strips the marks a body is stored with', () => {
    expect(plainTextOf('The knock came. **Exactly** as ==loud== and *soft*.\n')).toBe(
      'The knock came. Exactly as loud and soft.'
    )
  })

  it('keeps paragraph and hard breaks so snippets read naturally', () => {
    expect(plainTextOf('One\\\ntwo\n\nthree\n')).toBe('One\ntwo\n\nthree')
  })
})
