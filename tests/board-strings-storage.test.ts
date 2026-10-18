import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import {
  deleteBoardString,
  listBoardStrings,
  writeBoardString
} from '../src/main/wyrm/boardStrings'
import { createProject } from '../src/main/wyrm/project'
import type { BoardString } from '../src/shared/types'

/**
 * F-46: red strings on disk, one gray-matter file each, exactly as map pins
 * are stored. What is worth pinning beyond the MapPin cases: the ends are
 * nested mappings, and a `dx` of 0 (a string pinned at a card's left edge)
 * has to come back as 0, not be dropped as falsy.
 */

const tmpDirs: string[] = []

async function makeProject(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-strings-test-'))
  tmpDirs.push(dir)
  await createProject(dir, 'String Novel')
  return dir
}

function makeString(overrides: Partial<BoardString> = {}): BoardString {
  const now = new Date().toISOString()
  return {
    id: Math.random().toString(36).slice(2, 10),
    from: { cardId: 'scene-a', dx: 12, dy: 8 },
    to: { cardId: 'scene-b', dx: 40, dy: 16 },
    created: now,
    modified: now,
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('writeBoardString / listBoardStrings', () => {
  it('round-trips both ends as nested objects, including a dx of 0', async () => {
    const dir = await makeProject()
    const s = makeString({
      from: { cardId: 'elara', dx: 0, dy: 24 },
      to: { cardId: 'scene-3', dx: 96, dy: 0 }
    })
    await writeBoardString(dir, s)

    const [found] = await listBoardStrings(dir)
    expect(found.id).toBe(s.id)
    expect(found.from).toEqual({ cardId: 'elara', dx: 0, dy: 24 })
    expect(found.to).toEqual({ cardId: 'scene-3', dx: 96, dy: 0 })
  })

  it('lands at <project>/strings/<id>.md', async () => {
    const dir = await makeProject()
    const s = makeString()
    await writeBoardString(dir, s)
    await expect(fsp.stat(join(dir, 'strings', `${s.id}.md`))).resolves.toBeTruthy()
  })

  it('returns [] for a project with no strings directory yet, without throwing', async () => {
    const dir = await makeProject()
    await expect(listBoardStrings(dir)).resolves.toEqual([])
  })

  it('stamps modified with the current timestamp on write, distinct from created', async () => {
    const dir = await makeProject()
    const created = new Date(Date.now() - 10_000).toISOString()
    const s = makeString({ created, modified: created })

    const before = Date.now()
    await writeBoardString(dir, s)
    const [written] = await listBoardStrings(dir)

    expect(written.created).toBe(created)
    expect(Date.parse(written.modified)).toBeGreaterThanOrEqual(before)
  })

  it('overwrites in place when a string with the same id is written again', async () => {
    const dir = await makeProject()
    const s = makeString()
    await writeBoardString(dir, s)
    await writeBoardString(dir, { ...s, to: { cardId: 'scene-c', dx: 1, dy: 2 } })

    const all = await listBoardStrings(dir)
    expect(all).toHaveLength(1)
    expect(all[0].to).toEqual({ cardId: 'scene-c', dx: 1, dy: 2 })
  })

  it('lists multiple strings', async () => {
    const dir = await makeProject()
    await writeBoardString(dir, makeString({ from: { cardId: 'a', dx: 0, dy: 0 } }))
    await writeBoardString(dir, makeString({ from: { cardId: 'b', dx: 0, dy: 0 } }))
    const all = await listBoardStrings(dir)
    expect(all.map((s) => s.from.cardId).sort()).toEqual(['a', 'b'])
  })
})

describe('deleteBoardString', () => {
  it('removes only the targeted string and is a no-op for a missing id', async () => {
    const dir = await makeProject()
    const a = makeString()
    const b = makeString()
    await writeBoardString(dir, a)
    await writeBoardString(dir, b)

    await deleteBoardString(dir, a.id)
    const remaining = await listBoardStrings(dir)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(b.id)

    await expect(deleteBoardString(dir, 'nonexistent-id')).resolves.not.toThrow()
    expect(await listBoardStrings(dir)).toHaveLength(1)
  })
})
