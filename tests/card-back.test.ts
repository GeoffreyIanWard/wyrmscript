import matter from 'gray-matter'
import { describe, expect, it } from 'vitest'
import type { DocFile, DocMeta } from '../src/shared/types'
import { SCENE_TAG } from '../src/shared/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  backChanged,
  backOf,
  backPatch,
  withPatch,
  hasBack,
  outlineLine,
  suggestionsFor,
  withBack,
  type CardBack
} from '../src/renderer/src/lib/cardBack'
import { sceneCards } from '../src/renderer/src/lib/corkboard'

/**
 * F-42, the back of the card: what reaches the file. The rule worth pinning
 * is that a cleared field is a deleted key — gray-matter's dumper throws on
 * `undefined`, and an empty string on disk is noise in every diff and sync.
 */

const meta = (extra: Partial<DocMeta> = {}): DocMeta => ({
  id: 'd1',
  title: 'The Harbor',
  tags: [SCENE_TAG],
  created: '2026-10-19T00:00:00.000Z',
  modified: '2026-10-19T00:00:00.000Z',
  ...extra
})

const blank: CardBack = {
  synopsis: '',
  act: '',
  sceneType: '',
  location: '',
  conflict: '',
  cast: []
}

describe('writing the back', () => {
  it('writes what was filled in, trimmed, and nothing for what was not', () => {
    const out = withBack(meta(), { ...blank, synopsis: '  Reed comes at night. ', act: ' II ' })
    expect(out.synopsis).toBe('Reed comes at night.')
    expect(out.act).toBe('II')
    for (const key of ['sceneType', 'location', 'conflict', 'cast']) expect(key in out).toBe(false)
  })

  it('deletes a field the writer cleared, rather than writing it empty', () => {
    const out = withBack(meta({ act: 'II', synopsis: 'Old', cast: [{ entityId: 'e1' }] }), {
      ...blank,
      act: '   '
    })
    expect('act' in out).toBe(false)
    expect('synopsis' in out).toBe(false)
    expect('cast' in out).toBe(false)
  })

  it('keeps line breaks inside a synopsis', () => {
    expect(withBack(meta(), { ...blank, synopsis: 'One.\nTwo.' }).synopsis).toBe('One.\nTwo.')
  })

  it('cleans each character: trimmed, empty fields dropped, listed once', () => {
    const out = withBack(meta(), {
      ...blank,
      cast: [
        { entityId: 'e1', motivation: ' Debt ', goal: '', note: '  ' },
        { entityId: 'e2', goal: 'Leave' },
        { entityId: 'e1', motivation: 'A second mention' },
        { entityId: '' }
      ]
    })
    expect(out.cast).toEqual([
      { entityId: 'e1', motivation: 'Debt' },
      { entityId: 'e2', goal: 'Leave' }
    ])
  })

  it('leaves everything else on the document alone', () => {
    const out = withBack(meta({ boardX: 40, tension: 7 }), { ...blank, act: 'I' })
    expect(out).toMatchObject({ id: 'd1', title: 'The Harbor', boardX: 40, tension: 7 })
  })

  it('round-trips through the frontmatter without a single undefined', () => {
    // The real writer's failure mode: js-yaml refuses `undefined` outright.
    const out = withBack(meta({ conflict: 'Old' }), {
      ...blank,
      synopsis: 'Reed comes.\nMaren will not open.',
      act: 'II',
      location: 'w1',
      cast: [{ entityId: 'e1', motivation: 'Debt', goal: '', note: undefined }]
    })
    const file = matter.stringify('\n', out)
    expect(matter(file).data).toEqual(JSON.parse(JSON.stringify(out)))
  })
})

describe('reading the back', () => {
  it('starts the form from what is on disk, with every field present', () => {
    const back = backOf(meta({ act: 'II', cast: [{ entityId: 'e1', goal: 'Leave' }] }))
    expect(back).toEqual({ ...blank, act: 'II', cast: [{ entityId: 'e1', goal: 'Leave' }] })
  })

  it('copies the cast, so editing the form never edits the document', () => {
    const m = meta({ cast: [{ entityId: 'e1' }] })
    backOf(m).cast[0].goal = 'Changed'
    expect(m.cast![0].goal).toBeUndefined()
  })

  it('says nothing changed for a card that was only looked at', () => {
    const m = meta({ act: 'II', cast: [{ entityId: 'e1', goal: 'Leave' }] })
    expect(backChanged(m, backOf(m))).toBe(false)
    expect(backChanged(m, { ...backOf(m), act: 'II ' })).toBe(false)
    expect(backChanged(m, { ...backOf(m), act: 'III' })).toBe(true)
    expect(backChanged(meta(), blank)).toBe(false)
  })

  it('knows whether anything is written on the back', () => {
    expect(hasBack(meta())).toBe(false)
    expect(hasBack(meta({ conflict: 'x' }))).toBe(true)
    expect(hasBack(meta({ cast: [{ entityId: 'e1' }] }))).toBe(true)
    expect(hasBack(meta({ cast: [] }))).toBe(false)
  })
})

describe('the front of the card', () => {
  it('reads the act and scene type as one line, never "Act Act"', () => {
    expect(outlineLine(meta({ act: 'II', sceneType: 'Reveal' }))).toBe('Act II · Reveal')
    expect(outlineLine(meta({ act: 'Act Two' }))).toBe('Act Two')
    expect(outlineLine(meta({ sceneType: 'Reveal' }))).toBe('Reveal')
    expect(outlineLine(meta())).toBe('')
  })

  it("puts an outlined scene's synopsis and line on its card", () => {
    const docs: DocFile[] = [
      { meta: meta({ act: 'I', sceneType: 'Confrontation', synopsis: 'Reed comes.' }), body: '' },
      { meta: meta({ id: 'd2', title: 'Bare' }), body: '' }
    ]
    const binder = [
      { id: 'd1', type: 'doc' as const, title: 'The Harbor' },
      { id: 'd2', type: 'doc' as const, title: 'Bare' }
    ]
    const [outlined, bare] = sceneCards(docs, binder)
    expect(outlined).toMatchObject({
      synopsis: 'Reed comes.',
      outline: 'Act I · Confrontation',
      back: true
    })
    expect(bare.synopsis).toBeUndefined()
    expect(bare.outline).toBeUndefined()
    expect(bare.back).toBe(false)
  })
})

describe('remembered suggestions', () => {
  it('offers the values already used, most used first, ties alphabetically', () => {
    const doc = (act?: string): DocFile => ({ meta: meta({ act }), body: '' })
    const docs = [doc('II'), doc('I'), doc('II'), doc(' III '), doc(), doc('')]
    expect(suggestionsFor(docs, 'act')).toEqual(['II', 'I', 'III'])
  })
})

describe('writing only what was edited', () => {
  it('finds nothing to write on a card only looked at, or only given a stray space', () => {
    const seed = backOf(meta({ act: 'II', cast: [{ entityId: 'e1', goal: 'Leave' }] }))
    expect(backPatch(seed, seed)).toBeNull()
    expect(backPatch(seed, { ...seed, act: ' II ' })).toBeNull()
    expect(
      backPatch(seed, { ...seed, cast: [{ entityId: 'e1', goal: 'Leave', note: '' }] })
    ).toBeNull()
  })

  it('names exactly the fields that changed', () => {
    const seed = backOf(meta({ act: 'II' }))
    expect(backPatch(seed, { ...seed, conflict: 'x' })).toEqual({ conflict: 'x' })
    expect(backPatch(seed, { ...seed, act: '' })).toEqual({ act: '' })
    expect(backPatch(seed, { ...seed, cast: [{ entityId: 'e1' }] })).toEqual({
      cast: [{ entityId: 'e1' }]
    })
  })

  it('writes the patch over the file as it is now, leaving every other field exactly as found', () => {
    // The file gained a synopsis on another device, written untrimmed by hand.
    const disk = meta({ act: 'III', synopsis: ' From elsewhere ', cast: [{ entityId: 'e9' }] })
    const out = withPatch(disk, { conflict: ' Ours ' })
    expect(out).toMatchObject({
      act: 'III',
      synopsis: ' From elsewhere ',
      cast: [{ entityId: 'e9' }],
      conflict: 'Ours'
    })
    const cleared = withPatch(disk, { act: '' })
    expect('act' in cleared).toBe(false)
    expect(cleared.synopsis).toBe(' From elsewhere ')
  })
})

describe('the card in a pile', () => {
  it("isolates each card's stacking, so a buried card's corner never covers the top card", () => {
    // jsdom has no layout, so this is asserted against the stylesheet.
    const css = readFileSync(join(__dirname, '../src/renderer/src/styles/retro.css'), 'utf8')
    const rule = /\n\.scene-card \{([^}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1]
    expect(rule).toContain('isolation: isolate')
  })
})
