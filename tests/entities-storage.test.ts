import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { deleteEntity, listEntities, readAllDocs, writeEntity } from '../src/main/wyrm/entities'
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
