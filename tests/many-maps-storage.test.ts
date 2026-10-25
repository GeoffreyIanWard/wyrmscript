import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import matter from 'gray-matter'
import { createProject } from '../src/main/wyrm/project'
import { listMapMarks, writeMapMark } from '../src/main/wyrm/mapMarks'
import { listMapShapes, writeMapShape } from '../src/main/wyrm/mapShapes'
import { listMapPins, writeMapPin } from '../src/main/wyrm/worldMap'
import { WORLD_MAP } from '../src/shared/types'

/**
 * F-12, several maps: every pin, shape and mark says which map it is on —
 * written only for a map other than World, so a project from before there
 * were several maps, and everything drawn on World since, reads and writes
 * exactly as it did. Read field by field: a `map` that is not a usable id is
 * World.
 */

const tmpDirs: string[] = []
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await fsp.rm(d, { recursive: true, force: true })
})

async function makeProject(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-maps-test-'))
  tmpDirs.push(dir)
  await createProject(dir, 'Maps Novel')
  return dir
}

const at = '2026-01-01T00:00:00.000Z'
const frontmatter = async (path: string): Promise<Record<string, unknown>> =>
  matter(await fsp.readFile(path, 'utf8')).data

describe('a record’s map, on disk', () => {
  it('is written and read back for a map other than World', async () => {
    const dir = await makeProject()
    await writeMapPin(dir, {
      id: 'p1',
      entityId: 'e',
      x: 1,
      y: 2,
      map: 'cray',
      created: at,
      modified: at
    })
    await writeMapShape(dir, {
      id: 's1',
      kind: 'border',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 }
      ],
      map: 'cray',
      created: at,
      modified: at
    })
    await writeMapMark(dir, {
      id: 'm1',
      kind: 'town',
      x: 3,
      y: 4,
      map: 'cray',
      created: at,
      modified: at
    })
    expect((await listMapPins(dir))[0].map).toBe('cray')
    expect((await listMapShapes(dir))[0].map).toBe('cray')
    expect((await listMapMarks(dir))[0].map).toBe('cray')
    expect((await frontmatter(join(dir, 'map', 'p1.md'))).map).toBe('cray')
  })

  it('is never written for World, so World’s files are as they always were', async () => {
    const dir = await makeProject()
    await writeMapPin(dir, {
      id: 'p1',
      entityId: 'e',
      x: 1,
      y: 2,
      map: WORLD_MAP,
      created: at,
      modified: at
    })
    await writeMapMark(dir, { id: 'm1', kind: 'town', x: 3, y: 4, created: at, modified: at })
    await writeMapShape(dir, {
      id: 's1',
      kind: 'border',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 }
      ],
      map: WORLD_MAP,
      created: at,
      modified: at
    })
    expect('map' in (await frontmatter(join(dir, 'map-shapes', 's1.md')))).toBe(false)
    expect('map' in (await frontmatter(join(dir, 'map', 'p1.md')))).toBe(false)
    expect('map' in (await frontmatter(join(dir, 'map-marks', 'm1.md')))).toBe(false)
    expect('map' in (await listMapPins(dir))[0]).toBe(false)
  })

  it('reads a map that is not a usable id as World, never failing the record', async () => {
    const dir = await makeProject()
    await fsp.mkdir(join(dir, 'map-marks'), { recursive: true })
    await fsp.writeFile(
      join(dir, 'map-marks', 'm1.md'),
      matter.stringify('', {
        id: 'm1',
        kind: 'town',
        x: 1,
        y: 1,
        map: 7,
        created: at,
        modified: at
      })
    )
    await fsp.writeFile(
      join(dir, 'map-marks', 'm2.md'),
      matter.stringify('', {
        id: 'm2',
        kind: 'town',
        x: 1,
        y: 1,
        map: 'world',
        created: at,
        modified: at
      })
    )
    const marks = await listMapMarks(dir)
    expect(marks).toHaveLength(2)
    for (const m of marks) expect('map' in m).toBe(false)
    // Pins and shapes alike.
    await fsp.mkdir(join(dir, 'map'), { recursive: true })
    await fsp.writeFile(
      join(dir, 'map', 'p1.md'),
      matter.stringify('', {
        id: 'p1',
        entityId: 'e',
        x: 1,
        y: 1,
        map: 7,
        created: at,
        modified: at
      })
    )
    await fsp.mkdir(join(dir, 'map-shapes'), { recursive: true })
    await fsp.writeFile(
      join(dir, 'map-shapes', 's1.md'),
      matter.stringify('', {
        id: 's1',
        kind: 'border',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 }
        ],
        map: 'world',
        created: at,
        modified: at
      })
    )
    expect('map' in (await listMapPins(dir))[0]).toBe(false)
    expect('map' in (await listMapShapes(dir))[0]).toBe(false)
  })
})
