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

describe("a string's label on disk", () => {
  it('round-trips a label, trimmed', async () => {
    const dir = await makeProject()
    await writeBoardString(dir, makeString({ label: '  same night ' }))
    const [found] = await listBoardStrings(dir)
    expect(found.label).toBe('same night')
  })

  it('writes no label key at all for a plain string, or a blank label', async () => {
    const dir = await makeProject()
    const plain = makeString()
    const blank = makeString({ label: '   ' })
    await writeBoardString(dir, plain)
    await writeBoardString(dir, blank)
    for (const s of [plain, blank]) {
      const raw = await fsp.readFile(join(dir, 'strings', `${s.id}.md`), 'utf8')
      expect(raw).not.toContain('label')
    }
    for (const found of await listBoardStrings(dir)) expect('label' in found).toBe(false)
  })

  it('reads an empty or blank label on disk as no label', async () => {
    const dir = await makeProject()
    for (const value of ["''", "'   '"]) {
      const s = makeString()
      await writeBoardString(dir, s)
      const file = join(dir, 'strings', `${s.id}.md`)
      const raw = await fsp.readFile(file, 'utf8')
      await fsp.writeFile(file, raw.replace('---\n', `---\nlabel: ${value}\n`), 'utf8')
      const found = (await listBoardStrings(dir)).find((x) => x.id === s.id)!
      expect('label' in found).toBe(false)
    }
  })

  it('ignores a label key that is not a real label', async () => {
    const dir = await makeProject()
    const s = makeString()
    await writeBoardString(dir, s)
    const file = join(dir, 'strings', `${s.id}.md`)
    const raw = await fsp.readFile(file, 'utf8')
    await fsp.writeFile(file, raw.replace('---\n', '---\nlabel: 42\n'), 'utf8')
    const [found] = await listBoardStrings(dir)
    expect('label' in found).toBe(false)
  })
})
