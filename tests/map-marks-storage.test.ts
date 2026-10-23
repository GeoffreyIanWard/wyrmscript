import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import matter from 'gray-matter'
import { deleteMapMark, listMapMarks, writeMapMark } from '../src/main/wyrm/mapMarks'
import { createProject } from '../src/main/wyrm/project'
import { MAP_MARK_KINDS, MAP_STAMP_KINDS, MARK_SIZES } from '../src/shared/types'
import type { MapMark, MapMarkKind } from '../src/shared/types'

/**
 * F-12 part 4: stamps and labels, one gray-matter file each in `map-marks/`.
 * Frontmatter is read field by field, so a file that is not a usable mark is
 * skipped, never returned half-formed — one fixture per broken field.
 */

const tmpDirs: string[] = []

async function makeProject(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-marks-test-'))
  tmpDirs.push(dir)
  await createProject(dir, 'Mark Novel')
  return dir
}

function makeMark(kind: MapMarkKind, overrides: Partial<MapMark> = {}): MapMark {
  const now = new Date().toISOString()
  return {
    id: Math.random().toString(36).slice(2, 10),
    kind,
    x: 10,
    y: 20,
    created: now,
    modified: now,
    ...overrides
  }
}

async function writeRaw(project: string, name: string, body: string): Promise<void> {
  await fsp.mkdir(join(project, 'map-marks'), { recursive: true })
  await fsp.writeFile(join(project, 'map-marks', name), body, 'utf8')
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('writeMapMark / listMapMarks', () => {
  it('round-trips every kind', async () => {
    const project = await makeProject()
    const marks = MAP_MARK_KINDS.map((kind, i) =>
      makeMark(kind, { x: i * 10 - 5, y: -i, name: kind === 'label' ? 'The Sea' : undefined })
    )
    for (const m of marks) await writeMapMark(project, m)
    const listed = await listMapMarks(project)
    expect(listed).toHaveLength(MAP_MARK_KINDS.length)
    const byId = new Map(listed.map((m) => [m.id, m]))
    for (const m of marks) {
      const got = byId.get(m.id)!
      expect(got.kind).toBe(m.kind)
      expect(got.x).toBe(m.x)
      expect(got.y).toBe(m.y)
      expect(got.name).toBe(m.name)
      expect(got.created).toBe(m.created)
    }
  })

  it('round-trips every stamp kind, with and without a size', async () => {
    const project = await makeProject()
    const marks = MAP_STAMP_KINDS.flatMap((kind) => [makeMark(kind), makeMark(kind, { size: 1.5 })])
    for (const m of marks) await writeMapMark(project, m)
    const byId = new Map((await listMapMarks(project)).map((m) => [m.id, m]))
    expect(byId.size).toBe(marks.length)
    for (const m of marks) {
      expect(byId.get(m.id)!.kind).toBe(m.kind)
      expect(byId.get(m.id)!.size).toBe(m.size)
    }
  })

  it.each(MARK_SIZES.filter((s) => s !== 1))('round-trips size %s', async (size) => {
    const project = await makeProject()
    const mark = makeMark('hills', { size })
    await writeMapMark(project, mark)
    const raw = await fsp.readFile(join(project, 'map-marks', `${mark.id}.md`), 'utf8')
    expect(matter(raw).data.size).toBe(size)
    expect((await listMapMarks(project))[0].size).toBe(size)
  })

  it.each([1, 0, 3, -1, 'big', NaN, null])('does not store or read size %s', async (size) => {
    const project = await makeProject()
    const mark = makeMark('hills', { size: size as number })
    await writeMapMark(project, mark)
    const raw = await fsp.readFile(join(project, 'map-marks', `${mark.id}.md`), 'utf8')
    expect(raw).not.toContain('size')
    expect(raw).not.toMatch(/undefined|null|NaN/)
    expect('size' in (await listMapMarks(project))[0]).toBe(false)
    const text = typeof size === 'string' ? `'${size}'` : String(size)
    await writeRaw(project, 'raw.md', `---\nid: raw\nkind: hills\nx: 1\ny: 2\nsize: ${text}\n---\n`)
    const raws = (await listMapMarks(project)).find((m) => m.id === 'raw')!
    expect('size' in raws).toBe(false)
  })

  it('writes to <project>/map-marks/<id>.md and stamps modified', async () => {
    const project = await makeProject()
    const mark = makeMark('forest', { modified: '2000-01-01T00:00:00.000Z' })
    await writeMapMark(project, mark)
    const raw = await fsp.readFile(join(project, 'map-marks', `${mark.id}.md`), 'utf8')
    expect(raw).toContain('kind: forest')
    const [listed] = await listMapMarks(project)
    expect(listed.modified).not.toBe('2000-01-01T00:00:00.000Z')
  })

  it('rounds x and y on write, and on read', async () => {
    const project = await makeProject()
    const mark = makeMark('town', { x: 1.4, y: -3.5 })
    await writeMapMark(project, mark)
    const raw = await fsp.readFile(join(project, 'map-marks', `${mark.id}.md`), 'utf8')
    expect(matter(raw).data.x).toBe(1)
    expect(matter(raw).data.y).toBe(-3)
    await writeRaw(project, 'frac.md', '---\nid: frac\nkind: hills\nx: 2.6\ny: 9.49\n---\n')
    const frac = (await listMapMarks(project)).find((m) => m.id === 'frac')!
    expect([frac.x, frac.y]).toEqual([3, 9])
  })

  it('writes a name only when it is a non-empty string', async () => {
    const project = await makeProject()
    const stamp = makeMark('mountain')
    const empty = makeMark('hills', { name: '' })
    const named = makeMark('marsh', { name: 'Saltmarsh' })
    for (const m of [stamp, empty, named]) await writeMapMark(project, m)
    for (const m of [stamp, empty]) {
      const raw = await fsp.readFile(join(project, 'map-marks', `${m.id}.md`), 'utf8')
      expect(raw).not.toContain('name')
      expect(raw).not.toMatch(/undefined|null/)
    }
    const raw = await fsp.readFile(join(project, 'map-marks', `${named.id}.md`), 'utf8')
    expect(matter(raw).data.name).toBe('Saltmarsh')
    const byId = new Map((await listMapMarks(project)).map((m) => [m.id, m]))
    expect('name' in byId.get(stamp.id)!).toBe(false)
    expect('name' in byId.get(empty.id)!).toBe(false)
    expect(byId.get(named.id)!.name).toBe('Saltmarsh')
  })

  it('gives [] for a project with no marks directory', async () => {
    const project = await makeProject()
    expect(await listMapMarks(project)).toEqual([])
  })

  it('skips each kind of unusable file on its own', async () => {
    const project = await makeProject()
    const good = makeMark('forest')
    await writeMapMark(project, good)
    await writeRaw(project, 'noid.md', '---\nkind: forest\nx: 1\ny: 1\n---\n')
    await writeRaw(project, 'numid.md', '---\nid: 42\nkind: forest\nx: 1\ny: 1\n---\n')
    await writeRaw(project, 'nokind.md', '---\nid: nokind\nx: 1\ny: 1\n---\n')
    await writeRaw(project, 'badkind.md', '---\nid: badkind\nkind: dragon\nx: 1\ny: 1\n---\n')
    await writeRaw(project, 'nox.md', '---\nid: nox\nkind: forest\ny: 1\n---\n')
    await writeRaw(project, 'noy.md', '---\nid: noy\nkind: forest\nx: 1\n---\n')
    await writeRaw(project, 'strx.md', '---\nid: strx\nkind: forest\nx: "5"\ny: 1\n---\n')
    await writeRaw(project, 'stry.md', '---\nid: stry\nkind: forest\nx: 1\ny: north\n---\n')
    await writeRaw(project, 'infx.md', '---\nid: infx\nkind: forest\nx: .inf\ny: 1\n---\n')
    await writeRaw(project, 'nany.md', '---\nid: nany\nkind: forest\nx: 1\ny: .nan\n---\n')
    await writeRaw(project, 'nolabel.md', '---\nid: nolabel\nkind: label\nx: 1\ny: 1\n---\n')
    await writeRaw(
      project,
      'emptylabel.md',
      '---\nid: emptylabel\nkind: label\nx: 1\ny: 1\nname: ""\n---\n'
    )
    await writeRaw(
      project,
      'numlabel.md',
      '---\nid: numlabel\nkind: label\nx: 1\ny: 1\nname: 7\n---\n'
    )
    await writeRaw(project, 'pin.md', '---\nid: pin\nentityId: e\nx: 1\ny: 2\n---\n')
    await writeRaw(project, 'broken.md', '---\nid: [unclosed\n---\n')
    await writeRaw(project, 'notes.txt', '---\nid: txt\nkind: forest\nx: 1\ny: 1\n---\n')
    const listed = await listMapMarks(project)
    expect(listed.map((m) => m.id)).toEqual([good.id])
  })

  it('keeps a stamp with a non-string name, dropping the name', async () => {
    const project = await makeProject()
    await writeRaw(project, 's.md', '---\nid: s\nkind: town\nx: 1\ny: 1\nname: 7\n---\n')
    const [mark] = await listMapMarks(project)
    expect(mark.id).toBe('s')
    expect('name' in mark).toBe(false)
  })

  it('keeps a label that has a name', async () => {
    const project = await makeProject()
    await writeRaw(project, 'l.md', '---\nid: l\nkind: label\nx: 1\ny: 1\nname: The Sea\n---\n')
    const [mark] = await listMapMarks(project)
    expect(mark.name).toBe('The Sea')
  })

  it.each(['../evil', 'a/b', 'a\\b', '..', ''])('refuses to write id %j', async (id) => {
    const project = await makeProject()
    await expect(writeMapMark(project, makeMark('forest', { id }))).rejects.toThrow()
    expect(await fsp.readdir(project)).not.toContain('evil.md')
  })

  it.each(['../evil', 'a/b', 'a\\b', '..', ''])('refuses to delete id %j', async (id) => {
    const project = await makeProject()
    await expect(deleteMapMark(project, id)).rejects.toThrow()
  })

  it('does not delete outside the marks folder for a traversing id', async () => {
    const project = await makeProject()
    await fsp.writeFile(join(project, 'keep.md'), 'x', 'utf8')
    await expect(deleteMapMark(project, '../keep')).rejects.toThrow()
    expect(await fsp.readFile(join(project, 'keep.md'), 'utf8')).toBe('x')
  })

  it('skips a file whose id is a traversal', async () => {
    const project = await makeProject()
    await writeRaw(project, 'x.md', '---\nid: ../x\nkind: forest\nx: 1\ny: 1\n---\n')
    expect(await listMapMarks(project)).toEqual([])
  })
})

describe('deleteMapMark', () => {
  it('removes the file, and a missing one is not an error', async () => {
    const project = await makeProject()
    const mark = makeMark('hills')
    await writeMapMark(project, mark)
    await deleteMapMark(project, mark.id)
    expect(await listMapMarks(project)).toEqual([])
    await expect(deleteMapMark(project, mark.id)).resolves.toBeUndefined()
  })
})
