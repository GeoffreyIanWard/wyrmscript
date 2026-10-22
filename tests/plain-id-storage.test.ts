import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import {
  deleteBoardString,
  listBoardStrings,
  writeBoardString
} from '../src/main/wyrm/boardStrings'
import { deleteMapShape, listMapShapes, writeMapShape } from '../src/main/wyrm/mapShapes'
import { isPlainId } from '../src/main/wyrm/plainId'
import { createProject } from '../src/main/wyrm/project'
import { deleteMapPin, listMapPins, writeMapPin } from '../src/main/wyrm/worldMap'

/**
 * Map pins, map shapes and board strings are one file each at
 * `<dir>/<id>.md`, with the id read back from frontmatter. A synced or
 * hand-edited file can carry any id at all, so one with a separator or `..`
 * is skipped on read and refused on write and delete — otherwise a later
 * move or rename writes outside the folder, and a delete removes a file
 * outside it.
 */

const BAD_IDS = ['../evil', 'a/b', 'a\\b', '..', '']

const tmpDirs: string[] = []

/** The project sits inside its own temp dir, so `../../evil` from a store's
 *  folder lands in a directory the test owns, not in the system tmp. */
async function makeProject(): Promise<{ root: string; project: string }> {
  const root = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-plain-id-test-'))
  tmpDirs.push(root)
  const project = join(root, 'Novel.wyrm')
  await fsp.mkdir(project)
  await createProject(project, 'Plain Id Novel')
  return { root, project }
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

const now = '2026-10-21T00:00:00.000Z'

interface Store {
  name: string
  dir: string
  write: (project: string, id: string) => Promise<void>
  remove: (project: string, id: string) => Promise<void>
  list: (project: string) => Promise<{ id: string }[]>
  /** A file body that would parse, but for its id. */
  raw: (id: string) => string
}

const STORES: Store[] = [
  {
    name: 'map pins',
    dir: 'map',
    write: (p, id) =>
      writeMapPin(p, { id, entityId: 'place', x: 1, y: 2, created: now, modified: now }),
    remove: deleteMapPin,
    list: listMapPins,
    raw: (id) => `---\nid: '${id}'\nentityId: place\nx: 1\ny: 2\n---\n`
  },
  {
    name: 'map shapes',
    dir: 'map-shapes',
    write: (p, id) =>
      writeMapShape(p, {
        id,
        kind: 'border',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 }
        ],
        created: now,
        modified: now
      }),
    remove: deleteMapShape,
    list: listMapShapes,
    raw: (id) =>
      `---\nid: '${id}'\nkind: border\npoints:\n  - {x: 0, y: 0}\n  - {x: 5, y: 5}\n---\n`
  },
  {
    name: 'board strings',
    dir: 'strings',
    write: (p, id) =>
      writeBoardString(p, {
        id,
        from: { cardId: 'a', dx: 0, dy: 0 },
        to: { cardId: 'b', dx: 0, dy: 0 },
        created: now,
        modified: now
      }),
    remove: deleteBoardString,
    list: listBoardStrings,
    raw: (id) =>
      `---\nid: '${id}'\nfrom: {cardId: a, dx: 0, dy: 0}\nto: {cardId: b, dx: 0, dy: 0}\n---\n`
  }
]

describe('isPlainId', () => {
  it('accepts a minted id and refuses separators, .., empty and non-strings', () => {
    expect(isPlainId('k3x9a1')).toBe(true)
    for (const id of BAD_IDS) expect(isPlainId(id)).toBe(false)
    expect(isPlainId(42)).toBe(false)
    expect(isPlainId(undefined)).toBe(false)
  })
})

describe.each(STORES)('$name', (store) => {
  it.each(BAD_IDS)('refuses to write id %j', async (id) => {
    const { project } = await makeProject()
    await expect(store.write(project, id)).rejects.toThrow(/Not a valid/)
  })

  it.each(BAD_IDS)('refuses to delete id %j', async (id) => {
    const { project } = await makeProject()
    await expect(store.remove(project, id)).rejects.toThrow(/Not a valid/)
  })

  it('a write with a traversing id creates nothing outside the folder', async () => {
    const { root, project } = await makeProject()
    await expect(store.write(project, '../../evil')).rejects.toThrow()
    await expect(fsp.access(join(root, 'evil.md'))).rejects.toThrow()
  })

  it('a delete with a traversing id leaves the outside file alone', async () => {
    const { root, project } = await makeProject()
    const outside = join(root, 'evil.md')
    await fsp.writeFile(outside, 'keep me', 'utf8')
    await expect(store.remove(project, '../../evil')).rejects.toThrow()
    expect(await fsp.readFile(outside, 'utf8')).toBe('keep me')
  })

  it('skips a file whose frontmatter id traverses, and keeps the rest', async () => {
    const { project } = await makeProject()
    await store.write(project, 'good')
    await fsp.writeFile(join(project, store.dir, 'evil.md'), store.raw('../../evil'), 'utf8')
    await fsp.writeFile(join(project, store.dir, 'slash.md'), store.raw('a/b'), 'utf8')
    expect((await store.list(project)).map((x) => x.id)).toEqual(['good'])
  })

  it('still round-trips and deletes a plain id', async () => {
    const { project } = await makeProject()
    await store.write(project, 'plain1')
    expect((await store.list(project)).map((x) => x.id)).toEqual(['plain1'])
    await store.remove(project, 'plain1')
    expect(await store.list(project)).toEqual([])
  })
})
