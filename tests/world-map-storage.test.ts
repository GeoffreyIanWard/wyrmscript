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
