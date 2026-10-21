import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { deleteMapShape, listMapShapes, writeMapShape } from '../src/main/wyrm/mapShapes'
import matter from 'gray-matter'
import { createProject } from '../src/main/wyrm/project'
import type { MapShape, MapShapeKind } from '../src/shared/types'

/**
 * F-12: shapes drawn on the world map, one gray-matter file each in `map-shapes/`,
 * beside the pins. Frontmatter is read field by field, so a file that is not
 * a usable shape (a pin, a bad kind, too few points) is skipped, never
 * returned half-formed.
 */

const tmpDirs: string[] = []

async function makeProject(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-shapes-test-'))
  tmpDirs.push(dir)
  await createProject(dir, 'Shape Novel')
  return dir
}

function makeShape(kind: MapShapeKind, overrides: Partial<MapShape> = {}): MapShape {
  const now = new Date().toISOString()
  return {
    id: Math.random().toString(36).slice(2, 10),
    kind,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 10 },
      { x: 50, y: 80 }
    ],
    created: now,
    modified: now,
    ...overrides
  }
}

async function writeRaw(project: string, name: string, body: string): Promise<void> {
  await fsp.mkdir(join(project, 'map-shapes'), { recursive: true })
  await fsp.writeFile(join(project, 'map-shapes', name), body, 'utf8')
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('writeMapShape / listMapShapes', () => {
  it('round-trips each kind with its points', async () => {
    const project = await makeProject()
    const land = makeShape('land')
    const area = makeShape('area', {
      points: [
        { x: -20, y: 5 },
        { x: 0, y: 0 },
        { x: 7, y: 9 },
        { x: 3, y: 30 }
      ]
    })
    const border = makeShape('border', {
      points: [
        { x: 1, y: 2 },
        { x: 300, y: 400 }
      ]
    })
    for (const s of [land, area, border]) await writeMapShape(project, s)
    const listed = await listMapShapes(project)
    const byId = new Map(listed.map((s) => [s.id, s]))
    expect(listed).toHaveLength(3)
    for (const s of [land, area, border]) {
      const got = byId.get(s.id)!
      expect(got.kind).toBe(s.kind)
      expect(got.points).toEqual(s.points)
      expect(got.created).toBe(s.created)
    }
  })

  it('writes to <project>/map-shapes/<id>.md and stamps modified', async () => {
    const project = await makeProject()
    const shape = makeShape('land', { modified: '2000-01-01T00:00:00.000Z' })
    await writeMapShape(project, shape)
    const raw = await fsp.readFile(join(project, 'map-shapes', `${shape.id}.md`), 'utf8')
    expect(raw).toContain('kind: land')
    const [listed] = await listMapShapes(project)
    expect(listed.modified).not.toBe('2000-01-01T00:00:00.000Z')
  })

  it('rounds points written with fractions', async () => {
    const project = await makeProject()
    const shape = makeShape('border', {
      points: [
        { x: 1.4, y: 2.6 },
        { x: -3.5, y: 9.49 }
      ]
    })
    await writeMapShape(project, shape)
    const [listed] = await listMapShapes(project)
    const rounded = [
      { x: 1, y: 3 },
      { x: -3, y: 9 }
    ]
    expect(listed.points).toEqual(rounded)
    // And the file itself holds the rounded values, not the fractions.
    const raw = await fsp.readFile(join(project, 'map-shapes', `${shape.id}.md`), 'utf8')
    expect(matter(raw).data.points).toEqual(rounded)
  })

  it('never writes an undefined value', async () => {
    const project = await makeProject()
    const shape = makeShape('area')
    await writeMapShape(project, shape)
    const raw = await fsp.readFile(join(project, 'map-shapes', `${shape.id}.md`), 'utf8')
    expect(raw).not.toMatch(/undefined|null/)
  })

  it('gives [] for a project with no map directory', async () => {
    const project = await makeProject()
    expect(await listMapShapes(project)).toEqual([])
  })

  it('keeps rivers, roads and railways, lines of two points or more', async () => {
    const project = await makeProject()
    const two = [
      { x: 0, y: 0 },
      { x: 50, y: 60 }
    ]
    const lines = (['river', 'road', 'rail'] as const).map((kind) =>
      makeShape(kind, { points: two })
    )
    for (const s of lines) await writeMapShape(project, s)
    await writeRaw(
      project,
      'stub.md',
      '---\nid: stub\nkind: river\npoints:\n  - {x: 0, y: 0}\n---\n'
    )
    const listed = await listMapShapes(project)
    expect(listed.map((s) => s.kind).sort()).toEqual(['rail', 'river', 'road'])
    expect(listed.every((s) => s.points.length === 2)).toBe(true)
  })

  it('skips pins, bad kinds, too few points and unparsable files', async () => {
    const project = await makeProject()
    const good = makeShape('land')
    await writeMapShape(project, good)
    // A pin-shaped file (id, no kind) that ended up in map-shapes/ must not
    // come back as a shape.
    await writeRaw(project, 'pin1.md', '---\nid: pin1\nentityId: e\nx: 1\ny: 2\n---\n')
    const pts = '\npoints:\n  - {x: 0, y: 0}\n  - {x: 1, y: 1}\n  - {x: 2, y: 0}\n---\n'
    await writeRaw(project, 'noid.md', '---\nkind: land' + pts)
    await writeRaw(project, 'numid.md', '---\nid: 42\nkind: land' + pts)
    await writeRaw(
      project,
      'badkind.md',
      '---\nid: badkind\nkind: sea\npoints:\n  - {x: 0, y: 0}\n  - {x: 1, y: 1}\n  - {x: 2, y: 0}\n---\n'
    )
    await writeRaw(
      project,
      'fewland.md',
      '---\nid: fewland\nkind: land\npoints:\n  - {x: 0, y: 0}\n  - {x: 1, y: 1}\n---\n'
    )
    await writeRaw(
      project,
      'fewborder.md',
      '---\nid: fewborder\nkind: border\npoints:\n  - {x: 0, y: 0}\n---\n'
    )
    // Three entries, but one is non-numeric: two left is too few for an area.
    await writeRaw(
      project,
      'junkarea.md',
      '---\nid: junkarea\nkind: area\npoints:\n  - {x: 0, y: 0}\n  - {x: north, y: 1}\n  - {x: 2, y: 0}\n---\n'
    )
    await writeRaw(project, 'broken.md', '---\nid: [unclosed\n---\n')
    const listed = await listMapShapes(project)
    expect(listed.map((s) => s.id)).toEqual([good.id])
  })

  it('drops non-numeric points and keeps a shape that still has enough', async () => {
    const project = await makeProject()
    await writeRaw(
      project,
      'line.md',
      '---\nid: line\nkind: border\npoints:\n  - {x: 0.6, y: 0}\n  - {x: "5", y: 1}\n  - nope\n  - {x: 9, y: 9.2}\n---\n'
    )
    const [shape] = await listMapShapes(project)
    expect(shape.id).toBe('line')
    expect(shape.points).toEqual([
      { x: 1, y: 0 },
      { x: 9, y: 9 }
    ])
  })
})

describe('shape names', () => {
  it('round-trips a name, and writes it into the file', async () => {
    const project = await makeProject()
    const shape = makeShape('land', { name: 'The Saltmarsh' })
    await writeMapShape(project, shape)
    const raw = await fsp.readFile(join(project, 'map-shapes', `${shape.id}.md`), 'utf8')
    expect(matter(raw).data.name).toBe('The Saltmarsh')
    const [listed] = await listMapShapes(project)
    expect(listed.name).toBe('The Saltmarsh')
  })

  it('omits the key when the name is missing or empty', async () => {
    const project = await makeProject()
    const none = makeShape('land')
    const empty = makeShape('area', { name: '' })
    for (const s of [none, empty]) await writeMapShape(project, s)
    for (const s of [none, empty]) {
      const raw = await fsp.readFile(join(project, 'map-shapes', `${s.id}.md`), 'utf8')
      expect(raw).not.toContain('name')
      expect(raw).not.toMatch(/undefined|null/)
    }
    for (const s of await listMapShapes(project)) expect('name' in s).toBe(false)
  })

  it('reads a non-string or empty name as none, keeping the shape', async () => {
    const project = await makeProject()
    const pts = '\npoints:\n  - {x: 0, y: 0}\n  - {x: 1, y: 1}\n  - {x: 2, y: 0}\n'
    await writeRaw(project, 'num.md', '---\nid: num\nkind: land\nname: 7' + pts + '---\n')
    await writeRaw(project, 'blank.md', '---\nid: blank\nkind: land\nname: ""' + pts + '---\n')
    const listed = await listMapShapes(project)
    expect(listed.map((s) => s.id).sort()).toEqual(['blank', 'num'])
    for (const s of listed) expect('name' in s).toBe(false)
  })
})

describe('deleteMapShape', () => {
  it('removes the file, and a missing one is not an error', async () => {
    const project = await makeProject()
    const shape = makeShape('border', {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ]
    })
    await writeMapShape(project, shape)
    await deleteMapShape(project, shape.id)
    expect(await listMapShapes(project)).toEqual([])
    await expect(deleteMapShape(project, shape.id)).resolves.toBeUndefined()
  })
})
