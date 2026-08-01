import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import {
  deleteRelationship,
  listRelationships,
  writeRelationship
} from '../src/main/wyrm/relationships'
import { createProject } from '../src/main/wyrm/project'
import type { Relationship } from '../src/shared/types'

const tmpDirs: string[] = []

async function makeProject(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-relationships-test-'))
  tmpDirs.push(dir)
  await createProject(dir, 'Relationship Novel')
  return dir
}

function makeRelationship(overrides: Partial<Relationship> = {}): Relationship {
  const now = new Date().toISOString()
  return {
    id: Math.random().toString(36).slice(2, 10),
    fromId: 'elara',
    toId: 'marten',
    label: 'sister of',
    created: now,
    modified: now,
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('writeRelationship / listRelationships', () => {
  it('round-trips fromId, toId and label', async () => {
    const dir = await makeProject()
    const relationship = makeRelationship()
    await writeRelationship(dir, relationship)

    const [found] = await listRelationships(dir)
    expect(found.id).toBe(relationship.id)
    expect(found.fromId).toBe('elara')
    expect(found.toId).toBe('marten')
    expect(found.label).toBe('sister of')
  })

  it('returns [] for a project with no relationships directory yet, without throwing', async () => {
    const dir = await makeProject()
    await expect(listRelationships(dir)).resolves.toEqual([])
  })

  it('stamps modified with the current timestamp on write, distinct from created', async () => {
    const dir = await makeProject()
    const created = new Date(Date.now() - 10_000).toISOString()
    const relationship = makeRelationship({ created, modified: created })

    const before = Date.now()
    await writeRelationship(dir, relationship)
    const [written] = await listRelationships(dir)

    expect(written.created).toBe(created)
    expect(Date.parse(written.modified)).toBeGreaterThanOrEqual(before)
  })

  it('lists multiple relationships', async () => {
    const dir = await makeProject()
    await writeRelationship(dir, makeRelationship({ label: 'sister of' }))
    await writeRelationship(dir, makeRelationship({ label: 'estranged from' }))
    const all = await listRelationships(dir)
    expect(all.map((r) => r.label).sort()).toEqual(['estranged from', 'sister of'])
  })
})

describe('deleteRelationship', () => {
  it('removes only the targeted relationship and is a no-op for a missing id', async () => {
    const dir = await makeProject()
    const a = makeRelationship({ label: 'sister of' })
    const b = makeRelationship({ label: 'rival of' })
    await writeRelationship(dir, a)
    await writeRelationship(dir, b)

    await deleteRelationship(dir, a.id)
    const remaining = await listRelationships(dir)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(b.id)

    await expect(deleteRelationship(dir, 'nonexistent-id')).resolves.not.toThrow()
    expect(await listRelationships(dir)).toHaveLength(1)
  })
})
