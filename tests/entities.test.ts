import { describe, expect, it } from 'vitest'
import type { Entity, EntityType } from '../src/shared/types'
import {
  buildEntityIndex,
  findBacklinks,
  findEntityMatches
} from '../src/renderer/src/lib/entities'

let n = 0
function entity(type: EntityType, name: string, aliases: string[] = []): Entity {
  n += 1
  return {
    id: `e${n}`,
    type,
    name,
    aliases,
    body: '',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z'
  }
}

function matchTexts(text: string, entities: Entity[]): string[] {
  return findEntityMatches(text, buildEntityIndex(entities)).map((m) => m.text)
}

describe('buildEntityIndex', () => {
  it('indexes canonical names and aliases', () => {
    const index = buildEntityIndex([entity('character', 'Elara Voss', ['Elara', 'the Captain'])])
    expect([...index.terms.keys()].sort()).toEqual(['elara', 'elara voss', 'the captain'])
  })

  it('ignores blank and whitespace-only aliases', () => {
    const index = buildEntityIndex([entity('character', 'Marten', ['', '   '])])
    expect([...index.terms.keys()]).toEqual(['marten'])
  })

  it('has no pattern when there is nothing to match', () => {
    expect(buildEntityIndex([]).pattern).toBeNull()
    expect(findEntityMatches('any prose at all', buildEntityIndex([]))).toEqual([])
  })

  it('records collisions without letting one entry shadow another silently', () => {
    const index = buildEntityIndex([
      entity('character', 'Voss', ['the Captain']),
      entity('world', 'Harrowgate', ['the Captain'])
    ])
    expect(index.collisions).toContain('the Captain')
    expect(index.terms.get('the captain')).toBeDefined()
  })
})

describe('findEntityMatches', () => {
  const elara = entity('character', 'Elara Voss', ['Elara', 'Captain Voss'])
  const harrowgate = entity('world', 'Harrowgate')
  const wyrmlight = entity('glossary', 'wyrmlight', ['wyrm-light'])

  it('matches names and aliases, tagging the entity and type', () => {
    const matches = findEntityMatches(
      'Elara walked to Harrowgate under the wyrmlight.',
      buildEntityIndex([elara, harrowgate, wyrmlight])
    )
    expect(matches.map((m) => [m.text, m.type])).toEqual([
      ['Elara', 'character'],
      ['Harrowgate', 'world'],
      ['wyrmlight', 'glossary']
    ])
    expect(matches[0].entityId).toBe(elara.id)
  })

  it('prefers the longest name when several overlap', () => {
    // The brief's own example: "Captain Elara Voss" must not match "Elara" alone.
    const captain = entity('character', 'Captain Elara Voss', ['Elara', 'Elara Voss'])
    expect(matchTexts('Captain Elara Voss drew the bolt.', [captain])).toEqual([
      'Captain Elara Voss'
    ])
    expect(matchTexts('Elara Voss drew the bolt.', [captain])).toEqual(['Elara Voss'])
    expect(matchTexts('Elara drew the bolt.', [captain])).toEqual(['Elara'])
  })

  it('is case-insensitive but reports the author’s own casing', () => {
    expect(matchTexts('ELARA and elara and Elara', [elara])).toEqual(['ELARA', 'elara', 'Elara'])
  })

  it('matches whole words only', () => {
    expect(matchTexts('Elaraship sailed', [elara])).toEqual([])
    expect(matchTexts('preElara', [elara])).toEqual([])
    expect(matchTexts('(Elara)', [elara])).toEqual(['Elara'])
    expect(matchTexts('"Elara," she said', [elara])).toEqual(['Elara'])
  })

  it('matches possessives, since the apostrophe is not a word character', () => {
    expect(matchTexts("Elara's tobacco tin", [elara])).toEqual(['Elara'])
  })

  it('respects Unicode word boundaries', () => {
    const accented = entity('character', 'Élara')
    expect(matchTexts('Élara waited', [accented])).toEqual(['Élara'])
    // A preceding accented letter must still block the match.
    expect(matchTexts('xÉlara', [accented])).toEqual([])
  })

  it('handles names containing regex metacharacters', () => {
    const saint = entity('world', "St. Vurm's (Old Quarter)", ['C++ Wharf'])
    expect(matchTexts("She crossed St. Vurm's (Old Quarter) at dusk.", [saint])).toEqual([
      "St. Vurm's (Old Quarter)"
    ])
    expect(matchTexts('Docked at C++ Wharf.', [saint])).toEqual(['C++ Wharf'])
  })

  it('finds every occurrence, with correct offsets', () => {
    const text = 'Elara, then Elara again.'
    const matches = findEntityMatches(text, buildEntityIndex([elara]))
    expect(matches).toHaveLength(2)
    for (const m of matches) expect(text.slice(m.start, m.end)).toBe(m.text)
  })

  it('matches hyphenated aliases and adjacent mentions', () => {
    expect(matchTexts('the wyrm-light in the glass', [wyrmlight])).toEqual(['wyrm-light'])
    expect(matchTexts('Elara Harrowgate', [elara, harrowgate])).toEqual(['Elara', 'Harrowgate'])
  })

  it('does not match across a line break', () => {
    expect(matchTexts('Elara\nVoss', [entity('character', 'Elara Voss')])).toEqual([])
  })
})

describe('findBacklinks', () => {
  it('reports the documents mentioning an entity, with counts', () => {
    const elara = entity('character', 'Elara Voss', ['Elara'])
    const docs = [
      { meta: { id: 'd1', title: 'Scene One' }, body: 'Elara woke. Elara Voss listened.' },
      { meta: { id: 'd2', title: 'Scene Two' }, body: 'Nobody here.' },
      { meta: { id: 'd3', title: 'Scene Three' }, body: "Elara's tin." }
    ]
    expect(findBacklinks(docs, elara)).toEqual([
      { docId: 'd1', title: 'Scene One', count: 2 },
      { docId: 'd3', title: 'Scene Three', count: 1 }
    ])
  })
})
