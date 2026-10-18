import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import {
  copyPortrait,
  deleteEntity,
  listEntities,
  readAllDocs,
  readPortraitDataUrl,
  removePortrait,
  writeEntity
} from '../src/main/wyrm/entities'
import { createProject } from '../src/main/wyrm/project'
import type { Entity, EntityType } from '../src/shared/types'

const tmpDirs: string[] = []

async function makeProject(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-entities-test-'))
  tmpDirs.push(dir)
  await createProject(dir, 'Entity Novel')
  return dir
}

function makeEntity(overrides: Partial<Entity> & { type: EntityType }): Entity {
  const now = new Date().toISOString()
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: 'Unnamed',
    aliases: [],
    body: 'Some body text.',
    created: now,
    modified: now,
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('writeEntity / listEntities', () => {
  it('round-trips id, type, name, aliases, and body for all three types', async () => {
    const dir = await makeProject()
    const glossary = makeEntity({
      type: 'glossary',
      name: 'wyrmlight',
      aliases: ['wyrm-light'],
      body: 'A faint green luminescence.'
    })
    const character = makeEntity({
      type: 'character',
      name: 'Elara Voss',
      aliases: ['Elara', 'Captain Voss'],
      body: 'Former harbor-guard captain.'
    })
    const world = makeEntity({
      type: 'world',
      name: 'Harrowgate',
      aliases: ['the harbor city'],
      body: 'Salt-eaten harbor city.'
    })

    await writeEntity(dir, glossary)
    await writeEntity(dir, character)
    await writeEntity(dir, world)

    const all = await listEntities(dir)
    expect(all).toHaveLength(3)

    for (const original of [glossary, character, world]) {
      const found = all.find((e) => e.id === original.id)
      expect(found).toBeTruthy()
      expect(found?.type).toBe(original.type)
      expect(found?.name).toBe(original.name)
      expect(found?.aliases).toEqual(original.aliases)
      expect(found?.body.trim()).toBe(original.body.trim())
    }
  })

  it('returns [] for a project with no entity directories yet, without throwing', async () => {
    const dir = await makeProject()
    await expect(listEntities(dir)).resolves.toEqual([])
  })

  it('survives aliases containing punctuation through the YAML round-trip', async () => {
    const dir = await makeProject()
    const entity = makeEntity({
      type: 'world',
      name: "St. Vurm's Reach",
      aliases: ["St. Vurm's", 'the Reach, so-called', "Vurm's End"]
    })
    await writeEntity(dir, entity)

    const [found] = await listEntities(dir)
    expect(found.aliases).toEqual(entity.aliases)
  })

  it('stamps modified with the current timestamp on write, distinct from created', async () => {
    const dir = await makeProject()
    const created = new Date(Date.now() - 10_000).toISOString()
    const entity = makeEntity({ type: 'character', created, modified: created })

    const before = Date.now()
    await writeEntity(dir, entity)
    const [written] = await listEntities(dir)

    expect(written.created).toBe(created)
    expect(Date.parse(written.modified)).toBeGreaterThanOrEqual(before)
  })

  it('writes each entry into its type-specific directory', async () => {
    const dir = await makeProject()
    const character = makeEntity({ type: 'character', name: 'Marten' })
    await writeEntity(dir, character)

    await expect(fsp.stat(join(dir, 'characters', `${character.id}.md`))).resolves.toBeTruthy()
  })

  it('round-trips tags and pins (F-10)', async () => {
    const dir = await makeProject()
    const entity = makeEntity({
      type: 'character',
      name: 'Elara Voss',
      tags: ['House Voss', 'harbor-guard'],
      pins: ['Protagonist']
    })
    await writeEntity(dir, entity)

    const [found] = await listEntities(dir)
    expect(found.tags).toEqual(['House Voss', 'harbor-guard'])
    expect(found.pins).toEqual(['Protagonist'])
  })

  it('leaves tags/pins undefined rather than writing empty-array frontmatter', async () => {
    const dir = await makeProject()
    const entity = makeEntity({ type: 'glossary', name: 'wyrmlight' })
    await writeEntity(dir, entity)

    const raw = await fsp.readFile(join(dir, 'glossary', `${entity.id}.md`), 'utf8')
    expect(raw).not.toContain('tags:')
    expect(raw).not.toContain('pins:')

    const [found] = await listEntities(dir)
    expect(found.tags).toBeUndefined()
    expect(found.pins).toBeUndefined()
  })

  it('round-trips parentId (F-13)', async () => {
    const dir = await makeProject()
    const country = makeEntity({ type: 'world', name: 'Narrow Coast' })
    const city = makeEntity({ type: 'world', name: 'Harrowgate', parentId: country.id })
    await writeEntity(dir, country)
    await writeEntity(dir, city)

    const all = await listEntities(dir)
    const found = all.find((e) => e.name === 'Harrowgate')
    expect(found?.parentId).toBe(country.id)
  })

  it('leaves parentId undefined rather than writing an empty-string frontmatter value', async () => {
    const dir = await makeProject()
    const entity = makeEntity({ type: 'world', name: 'Narrow Coast' })
    await writeEntity(dir, entity)

    const raw = await fsp.readFile(join(dir, 'world', `${entity.id}.md`), 'utf8')
    expect(raw).not.toContain('parentId:')

    const [found] = await listEntities(dir)
    expect(found.parentId).toBeUndefined()
  })

  // F-45: a card on the corkboard. Entity frontmatter is read field by field,
  // so a field missing from either side of the round trip is silently dropped
  // — unlike DocMeta, which passes through whole.
  it('round-trips the corkboard fields, including a position of zero', async () => {
    const dir = await makeProject()
    const entity = makeEntity({
      type: 'character',
      name: 'Elara',
      onBoard: true,
      boardX: 0,
      boardY: 240
    })
    await writeEntity(dir, entity)

    const [found] = await listEntities(dir)
    expect(found.onBoard).toBe(true)
    // 0 is a real coordinate: a card at the board's left edge. A truthiness
    // check on write would have dropped it and the card would wander.
    expect(found.boardX).toBe(0)
    expect(found.boardY).toBe(240)
  })

  it('leaves the corkboard fields out of the file when unset', async () => {
    const dir = await makeProject()
    const entity = makeEntity({ type: 'character', name: 'Marten' })
    await writeEntity(dir, entity)

    const raw = await fsp.readFile(join(dir, 'characters', `${entity.id}.md`), 'utf8')
    expect(raw).not.toContain('onBoard:')
    expect(raw).not.toContain('boardX:')

    const [found] = await listEntities(dir)
    expect(found.onBoard).toBeUndefined()
    expect(found.boardX).toBeUndefined()
  })

  it('does not write onBoard: false, which is the same as absent', async () => {
    const dir = await makeProject()
    await writeEntity(dir, makeEntity({ type: 'world', name: 'Harrowgate', onBoard: false }))

    const raw = await fsp.readFile(
      join(dir, 'world', (await listEntities(dir))[0].id + '.md'),
      'utf8'
    )
    expect(raw).not.toContain('onBoard:')
  })

  // F-47: the portrait filename, with the same field-by-field caveat as the
  // corkboard fields — missing from either side of the round trip and it is
  // silently dropped, and the card shows no face with no error anywhere.
  it('round-trips portrait (F-47) and leaves it out of the file when unset', async () => {
    const dir = await makeProject()
    const withFace = makeEntity({ type: 'character', name: 'Elara', portrait: 'characters/x.png' })
    const bare = makeEntity({ type: 'character', name: 'Marten' })
    await writeEntity(dir, withFace)
    await writeEntity(dir, bare)

    const all = await listEntities(dir)
    expect(all.find((e) => e.id === withFace.id)?.portrait).toBe('characters/x.png')
    expect(all.find((e) => e.id === bare.id)?.portrait).toBeUndefined()
    const raw = await fsp.readFile(join(dir, 'characters', `${bare.id}.md`), 'utf8')
    expect(raw).not.toContain('portrait:')
  })
})

describe('deleteEntity', () => {
  it('removes only the targeted entry and is a no-op for a missing id', async () => {
    const dir = await makeProject()
    const a = makeEntity({ type: 'glossary', name: 'Alpha' })
    const b = makeEntity({ type: 'glossary', name: 'Beta' })
    await writeEntity(dir, a)
    await writeEntity(dir, b)

    await deleteEntity(dir, 'glossary', a.id)
    const remaining = await listEntities(dir)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(b.id)

    await expect(deleteEntity(dir, 'glossary', 'nonexistent-id')).resolves.not.toThrow()
    expect(await listEntities(dir)).toHaveLength(1)
  })
})

describe('readAllDocs', () => {
  it('returns every document with its title and body', async () => {
    const dir = await makeProject()
    const docs = await readAllDocs(dir)
    expect(docs).toHaveLength(1)
    expect(docs[0].meta.title).toBe('First Scene')
    expect(typeof docs[0].body).toBe('string')
  })
})

/* ---------- portraits (F-47) ---------- */

/** A picked image, as the native picker hands one over: an absolute path outside the project. */
async function makeSourceImage(name: string, bytes: Uint8Array): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-portrait-src-'))
  tmpDirs.push(dir)
  const file = join(dir, name)
  await fsp.writeFile(file, bytes)
  return file
}

/** A few recognisable bytes — the PNG signature and a tail. Nothing decodes it; equality is the test. */
const FACE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('copyPortrait', () => {
  it('copies the image into the collection folder, creating it, with the extension lowercased', async () => {
    // No entry written first: the folder does not exist yet, and the copy
    // has to make it rather than fail on a project whose bible is empty.
    const dir = await makeProject()
    const id = 'elara'
    // Uppercase on purpose: a camera's FACE.PNG must land as .png, or the
    // reader, which looks for the lowercase extensions, never finds it.
    const source = await makeSourceImage('face.PNG', FACE)

    const rel = await copyPortrait(dir, 'character', id, source)

    expect(rel).toBe('characters/elara.png')
    const copied = await fsp.readFile(join(dir, 'characters', 'elara.png'))
    expect(Buffer.compare(copied, FACE)).toBe(0)
  })

  it('replaces an older portrait of a different extension', async () => {
    const dir = await makeProject()
    await copyPortrait(dir, 'character', 'elara', await makeSourceImage('old.jpg', FACE))

    const rel = await copyPortrait(
      dir,
      'character',
      'elara',
      await makeSourceImage('new.png', FACE)
    )

    expect(rel).toBe('characters/elara.png')
    // Both left on disk, the reader picks by extension order rather than by
    // date: the writer chooses a new face and keeps seeing the old one.
    await expect(fsp.access(join(dir, 'characters', 'elara.jpg'))).rejects.toThrow()
    await expect(fsp.access(join(dir, 'characters', 'elara.png'))).resolves.toBeUndefined()
  })

  it('refuses an id that could leave the collection folder', async () => {
    const dir = await makeProject()
    const source = await makeSourceImage('face.png', FACE)

    await expect(copyPortrait(dir, 'character', '../escape', source)).rejects.toThrow()
    await expect(readPortraitDataUrl(dir, 'character', '../escape')).rejects.toThrow()
    await expect(removePortrait(dir, 'character', '../escape')).rejects.toThrow()
    // And nothing landed a level up, where `..` would have put it.
    await expect(fsp.access(join(dir, 'escape.png'))).rejects.toThrow()
  })

  it('refuses a file that is not an image', async () => {
    const dir = await makeProject()
    const source = await makeSourceImage('notes.txt', Buffer.from('not a picture'))

    await expect(copyPortrait(dir, 'character', 'elara', source)).rejects.toThrow()
    await expect(fsp.access(join(dir, 'characters', 'elara.txt'))).rejects.toThrow()
  })
})

describe('readPortraitDataUrl', () => {
  it('returns a data: URL whose bytes are the file, with the mime of the extension', async () => {
    const dir = await makeProject()
    await copyPortrait(dir, 'world', 'harrowgate', await makeSourceImage('city.png', FACE))
    await copyPortrait(dir, 'character', 'marten', await makeSourceImage('face.JPG', FACE))

    const png = await readPortraitDataUrl(dir, 'world', 'harrowgate')
    expect(png).toMatch(/^data:image\/png;base64,/)
    const decoded = Buffer.from(png!.slice('data:image/png;base64,'.length), 'base64')
    expect(Buffer.compare(decoded, FACE)).toBe(0)

    const jpg = await readPortraitDataUrl(dir, 'character', 'marten')
    expect(jpg).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('returns null when the entry has no portrait, folder or no folder', async () => {
    const dir = await makeProject()
    // No characters/ at all yet.
    await expect(readPortraitDataUrl(dir, 'character', 'nobody')).resolves.toBeNull()
    // The folder exists, but holds only the entry's own file.
    const entity = makeEntity({ type: 'character', name: 'Marten' })
    await writeEntity(dir, entity)
    await expect(readPortraitDataUrl(dir, 'character', entity.id)).resolves.toBeNull()
  })
})

describe('removePortrait', () => {
  it('deletes the image, and is a no-op when there is none', async () => {
    const dir = await makeProject()
    await copyPortrait(dir, 'character', 'elara', await makeSourceImage('face.png', FACE))

    await removePortrait(dir, 'character', 'elara')

    await expect(readPortraitDataUrl(dir, 'character', 'elara')).resolves.toBeNull()
    await expect(removePortrait(dir, 'character', 'elara')).resolves.toBeUndefined()
    // The collection folder itself stays: the entries live there.
    await expect(fsp.access(join(dir, 'characters'))).resolves.toBeUndefined()
  })
})

describe('deleting an entry that has a portrait', () => {
  it('takes the portrait with it rather than leaving it orphaned', async () => {
    // Nothing else would ever list or remove the image: it would sit in the
    // folder, in every backup and on every synced device, for an entry that
    // no longer exists.
    const dir = await makeProject()
    const entity = makeEntity({ type: 'character', name: 'Elara' })
    await writeEntity(dir, entity)
    const src = join(dir, 'face.png')
    await fsp.writeFile(src, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await copyPortrait(dir, 'character', entity.id, src)
    expect(await readPortraitDataUrl(dir, 'character', entity.id)).not.toBeNull()

    await deleteEntity(dir, 'character', entity.id)

    expect(await readPortraitDataUrl(dir, 'character', entity.id)).toBeNull()
    expect(await fsp.readdir(join(dir, 'characters'))).toEqual([])
  })
})
