import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { deleteMapPin, listMapPins, writeMapPin } from '../src/main/wyrm/worldMap'
import { createProject } from '../src/main/wyrm/project'
import type { MapPin } from '../src/shared/types'

const tmpDirs: string[] = []

async function makeProject(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-worldmap-test-'))
  tmpDirs.push(dir)
  await createProject(dir, 'Map Novel')
  return dir
}

function makePin(overrides: Partial<MapPin> = {}): MapPin {
  const now = new Date().toISOString()
  return {
    id: Math.random().toString(36).slice(2, 10),
    entityId: 'harrowgate',
    x: 100,
    y: 50,
    created: now,
    modified: now,
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('writeMapPin / listMapPins', () => {
  it('round-trips entityId, x and y', async () => {
    const dir = await makeProject()
    const pin = makePin({ x: 123, y: 456 })
    await writeMapPin(dir, pin)

    const [found] = await listMapPins(dir)
    expect(found.id).toBe(pin.id)
    expect(found.entityId).toBe('harrowgate')
    expect(found.x).toBe(123)
    expect(found.y).toBe(456)
  })

  it('returns [] for a project with no map directory yet, without throwing', async () => {
    const dir = await makeProject()
    await expect(listMapPins(dir)).resolves.toEqual([])
  })

  it('stamps modified with the current timestamp on write, distinct from created', async () => {
    const dir = await makeProject()
    const created = new Date(Date.now() - 10_000).toISOString()
    const pin = makePin({ created, modified: created })

    const before = Date.now()
    await writeMapPin(dir, pin)
    const [written] = await listMapPins(dir)

    expect(written.created).toBe(created)
    expect(Date.parse(written.modified)).toBeGreaterThanOrEqual(before)
  })

  it('overwrites in place when a pin with the same id is written again (a drag)', async () => {
    const dir = await makeProject()
    const pin = makePin({ x: 10, y: 10 })
    await writeMapPin(dir, pin)
    await writeMapPin(dir, { ...pin, x: 200, y: 200 })

    const all = await listMapPins(dir)
    expect(all).toHaveLength(1)
    expect(all[0].x).toBe(200)
    expect(all[0].y).toBe(200)
  })

  it('lists multiple pins', async () => {
    const dir = await makeProject()
    await writeMapPin(dir, makePin({ entityId: 'a' }))
    await writeMapPin(dir, makePin({ entityId: 'b' }))
    const all = await listMapPins(dir)
    expect(all.map((p) => p.entityId).sort()).toEqual(['a', 'b'])
  })
})

describe('a pin drawn as a stamp', () => {
  it('round-trips a stamp and a size', async () => {
    const dir = await makeProject()
    const pin = makePin({ stamp: 'castle', size: 1.5 })
    await writeMapPin(dir, pin)
    const [found] = await listMapPins(dir)
    expect(found).toMatchObject({ stamp: 'castle', size: 1.5 })
  })

  it('keeps a stamp at the usual size without a size key', async () => {
    const dir = await makeProject()
    await writeMapPin(dir, makePin({ stamp: 'town' }))
    const [found] = await listMapPins(dir)
    expect(found.stamp).toBe('town')
    expect('size' in found).toBe(false)
  })

  it('drops an unknown stamp but keeps the pin', async () => {
    const dir = await makeProject()
    const pin = makePin()
    await fsp.mkdir(join(dir, 'map'), { recursive: true })
    await fsp.writeFile(
      join(dir, 'map', `${pin.id}.md`),
      `---\nid: ${pin.id}\nentityId: e1\nx: 1\ny: 2\nstamp: spaceship\nsize: 2.2\n---\n`,
      'utf8'
    )
    const [found] = await listMapPins(dir)
    expect(found).toMatchObject({ id: pin.id, entityId: 'e1', x: 1, y: 2 })
    expect('stamp' in found).toBe(false)
    expect('size' in found).toBe(false)
  })

  it('does not keep a size on a pin with no stamp', async () => {
    const dir = await makeProject()
    const pin = makePin({ size: 2.2 })
    await writeMapPin(dir, pin)
    expect(await fsp.readFile(join(dir, 'map', `${pin.id}.md`), 'utf8')).not.toContain('size')
    const [found] = await listMapPins(dir)
    expect('size' in found).toBe(false)
  })

  it.each([[1], [3], [0], [-1], ['big']])('never writes or reads size %s', async (size) => {
    const dir = await makeProject()
    const pin = makePin({ stamp: 'castle', size: size as number })
    await writeMapPin(dir, pin)
    const file = join(dir, 'map', `${pin.id}.md`)
    expect(await fsp.readFile(file, 'utf8')).not.toContain('size')
    // And a hand-edited file carrying it is read without it.
    await fsp.writeFile(
      file,
      `---\nid: ${pin.id}\nentityId: e1\nx: 1\ny: 2\nstamp: castle\nsize: ${JSON.stringify(size)}\n---\n`,
      'utf8'
    )
    const [found] = await listMapPins(dir)
    expect(found.stamp).toBe('castle')
    expect('size' in found).toBe(false)
  })

  it('leaves an old-style pin exactly as it was', async () => {
    const dir = await makeProject()
    const pin = makePin()
    await writeMapPin(dir, pin)
    const text = await fsp.readFile(join(dir, 'map', `${pin.id}.md`), 'utf8')
    expect(text).not.toContain('stamp')
    expect(text).not.toContain('size')
    const [found] = await listMapPins(dir)
    expect(Object.keys(found).sort()).toEqual(
      ['created', 'entityId', 'id', 'modified', 'x', 'y'].sort()
    )
  })
})

describe('deleteMapPin', () => {
  it('removes only the targeted pin and is a no-op for a missing id', async () => {
    const dir = await makeProject()
    const a = makePin({ entityId: 'a' })
    const b = makePin({ entityId: 'b' })
    await writeMapPin(dir, a)
    await writeMapPin(dir, b)

    await deleteMapPin(dir, a.id)
    const remaining = await listMapPins(dir)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(b.id)

    await expect(deleteMapPin(dir, 'nonexistent-id')).resolves.not.toThrow()
    expect(await listMapPins(dir)).toHaveLength(1)
  })
})

describe('a stray file among the pins', () => {
  it('is skipped rather than made into a pin with no place and no position', async () => {
    const dir = await makeProject()
    const pin = makePin()
    await writeMapPin(dir, pin)
    await fsp.writeFile(
      join(dir, 'map', 'stray.md'),
      '---\nid: s1\nkind: land\npoints:\n  - {x: 1, y: 2}\n---\n',
      'utf8'
    )
    expect((await listMapPins(dir)).map((p) => p.id)).toEqual([pin.id])
  })

  // Each near-pin breaks exactly one guard of an otherwise valid pin.
  it.each([
    ['no id', '---\nentityId: e1\nx: 1\ny: 2\n---\n'],
    ['no entityId', '---\nid: s1\nx: 1\ny: 2\n---\n'],
    ['a non-numeric x', '---\nid: s1\nentityId: e1\nx: abc\ny: 2\n---\n'],
    ['no y', '---\nid: s1\nentityId: e1\nx: 1\n---\n']
  ])('skips a near-pin with %s', async (_label, body) => {
    const dir = await makeProject()
    const pin = makePin()
    await writeMapPin(dir, pin)
    await fsp.writeFile(join(dir, 'map', 'near.md'), body, 'utf8')
    expect((await listMapPins(dir)).map((p) => p.id)).toEqual([pin.id])
  })

  it('lists a pin at the origin, where x and y are 0', async () => {
    const dir = await makeProject()
    await writeMapPin(dir, makePin({ id: 'origin', x: 0, y: 0 }))
    const [found] = await listMapPins(dir)
    expect(found.id).toBe('origin')
    expect(found.x).toBe(0)
    expect(found.y).toBe(0)
  })
})
