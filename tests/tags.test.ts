import { describe, expect, it } from 'vitest'
import { addTag, removeTag, togglePin } from '../src/renderer/src/lib/tags'

describe('addTag', () => {
  it('trims and appends a new tag', () => {
    expect(addTag(['scene'], '  chapter-one  ')).toEqual(['scene', 'chapter-one'])
  })

  it('is a no-op for blank input', () => {
    expect(addTag(['scene'], '   ')).toEqual(['scene'])
  })

  it('does not duplicate an exact match', () => {
    expect(addTag(['scene'], 'scene')).toEqual(['scene'])
  })

  it('starts a fresh list when none exists yet', () => {
    expect(addTag(undefined, 'scene')).toEqual(['scene'])
  })
})

describe('removeTag', () => {
  it('drops the named tag and leaves the rest', () => {
    expect(removeTag(['scene', 'chapter-one'], 'scene')).toEqual(['chapter-one'])
  })

  it('is a no-op for an absent list', () => {
    expect(removeTag(undefined, 'scene')).toEqual([])
  })
})

describe('togglePin', () => {
  it('adds a pin not yet present', () => {
    expect(togglePin(['Protagonist'], 'Antagonist')).toEqual(['Protagonist', 'Antagonist'])
  })

  it('removes a pin already present', () => {
    expect(togglePin(['Protagonist', 'Antagonist'], 'Protagonist')).toEqual(['Antagonist'])
  })

  it('starts a fresh list when none exists yet', () => {
    expect(togglePin(undefined, 'Protagonist')).toEqual(['Protagonist'])
  })
})
