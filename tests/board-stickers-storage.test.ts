import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import matter from 'gray-matter'
import {
  deleteBoardSticker,
  listBoardStickers,
  writeBoardSticker
} from '../src/main/wyrm/boardStickers'
import { listBoardStrings, writeBoardString } from '../src/main/wyrm/boardStrings'
import { createProject } from '../src/main/wyrm/project'
import type { BoardSticker } from '../src/shared/types'

/**
 * F-45: stickers on disk, one file each in `stickers/`, as strings are. Red
 * is the colour nobody writes, as for strings and relationships — a board
 * from before colours reads back the same — and a sticker on a card names
 * the card, while one on the cork names nothing.
 */

const tmpDirs: string[] = []

async function makeProject(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-stickers-test-'))
  tmpDirs.push(dir)
  await createProject(dir, 'Sticker Novel')
  return dir
}

function makeSticker(overrides: Partial<BoardSticker> = {}): BoardSticker {
  const now = new Date().toISOString()
  return {
    id: Math.random().toString(36).slice(2, 10),
    kind: 'star',
    rotation: -7.3,
    x: 120,
    y: 40,
    created: now,
    modified: now,
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('writeBoardSticker / listBoardStickers', () => {
  it('round-trips a sticker on a card, at <project>/stickers/<id>.md', async () => {
    const dir = await makeProject()
    const s = makeSticker({ kind: 'question', colour: 'blue', cardId: 'scene-3', x: 0, y: 12 })
    await writeBoardSticker(dir, s)
    const raw = await fsp.readFile(join(dir, 'stickers', `${s.id}.md`), 'utf8')
    expect(matter(raw).data).toMatchObject({ kind: 'question', colour: 'blue', cardId: 'scene-3' })
    const [found] = await listBoardStickers(dir)
    expect(found).toMatchObject({
      id: s.id,
      kind: 'question',
      colour: 'blue',
      cardId: 'scene-3',
      rotation: -7.3,
      // An x of 0, a sticker at a card's very edge, is still a place.
      x: 0,
      y: 12
    })
  })

  it('writes no colour for red, and no card for a sticker on the cork', async () => {
    const dir = await makeProject()
    const s = makeSticker({ colour: 'red' })
    await writeBoardSticker(dir, s)
    const data = matter(await fsp.readFile(join(dir, 'stickers', `${s.id}.md`), 'utf8')).data
    expect('colour' in data).toBe(false)
    expect('cardId' in data).toBe(false)
    const [found] = await listBoardStickers(dir)
    expect('colour' in found).toBe(false)
    expect('cardId' in found).toBe(false)
  })

  it('rounds the place to the pixel and the tilt to a tenth of a degree', async () => {
    const dir = await makeProject()
    await writeBoardSticker(dir, makeSticker({ x: 10.6, y: -3.2, rotation: 4.444 }))
    const [found] = await listBoardStickers(dir)
    expect([found.x, found.y, found.rotation]).toEqual([11, -3, 4.4])
  })

  it('skips a file that is not a sticker it can draw, and reads an untilted one as square', async () => {
    const dir = await makeProject()
    const folder = join(dir, 'stickers')
    await fsp.mkdir(folder, { recursive: true })
    const put = (name: string, data: Record<string, unknown>): Promise<void> =>
      fsp.writeFile(join(folder, name), matter.stringify('', data), 'utf8')
    await put('a.md', { id: 'a', kind: 'unicorn', x: 1, y: 1 })
    await put('b.md', { id: 'b', kind: 'star', x: 'left', y: 1 })
    await put('c.md', { id: '../c', kind: 'star', x: 1, y: 1 })
    await put('d.md', { id: 'd', kind: 'heart', x: 5, y: 6, colour: 'purple' })
    await fsp.writeFile(join(folder, 'notes.txt'), 'not a sticker', 'utf8')
    const found = await listBoardStickers(dir)
    expect(found.map((s) => s.id)).toEqual(['d'])
    // A colour it does not know is read as the default, red, not kept.
    expect(found[0].rotation).toBe(0)
    expect('colour' in found[0]).toBe(false)
  })

  it('lists none before the first is stuck down, and deletes one (twice is fine)', async () => {
    const dir = await makeProject()
    expect(await listBoardStickers(dir)).toEqual([])
    const s = makeSticker()
    await writeBoardSticker(dir, s)
    await deleteBoardSticker(dir, s.id)
    await deleteBoardSticker(dir, s.id)
    expect(await listBoardStickers(dir)).toEqual([])
  })

  it('refuses an id that would reach outside the folder', async () => {
    const dir = await makeProject()
    await expect(writeBoardSticker(dir, makeSticker({ id: '../escape' }))).rejects.toThrow()
    await expect(deleteBoardSticker(dir, 'a/b')).rejects.toThrow()
  })
})

describe("a string's colour on disk", () => {
  it('keeps blue, and writes nothing for red', async () => {
    const dir = await makeProject()
    const now = new Date().toISOString()
    const base = { from: { cardId: 'a', dx: 1, dy: 1 }, to: { cardId: 'b', dx: 1, dy: 1 } }
    await writeBoardString(dir, {
      id: 'blue',
      ...base,
      colour: 'blue',
      created: now,
      modified: now
    })
    await writeBoardString(dir, { id: 'red', ...base, colour: 'red', created: now, modified: now })
    const raw = await fsp.readFile(join(dir, 'strings', 'red.md'), 'utf8')
    expect('colour' in matter(raw).data).toBe(false)
    const byId = Object.fromEntries((await listBoardStrings(dir)).map((s) => [s.id, s]))
    expect(byId.blue.colour).toBe('blue')
    expect('colour' in byId.red).toBe(false)
  })
})
