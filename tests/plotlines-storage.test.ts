import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { deletePlotline, listPlotlines, writePlotline } from '../src/main/wyrm/plotlines'
import { createProject } from '../src/main/wyrm/project'
import type { Plotline } from '../src/shared/types'

const tmpDirs: string[] = []

async function makeProject(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-plotlines-test-'))
  tmpDirs.push(dir)
  await createProject(dir, 'Plotline Novel')
  return dir
}

function makePlotline(overrides: Partial<Plotline> = {}): Plotline {
  const now = new Date().toISOString()
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: 'The Siege of the Narrows',
    colour: '#8b2e2e',
    status: 'open',
    created: now,
    modified: now,
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('writePlotline / listPlotlines', () => {
  it('round-trips name, colour and status', async () => {
    const dir = await makeProject()
    const plotline = makePlotline()
    await writePlotline(dir, plotline)

    const [found] = await listPlotlines(dir)
    expect(found.id).toBe(plotline.id)
    expect(found.name).toBe(plotline.name)
    expect(found.colour).toBe(plotline.colour)
    expect(found.status).toBe('open')
  })

  it('round-trips a resolved status', async () => {
    const dir = await makeProject()
    const plotline = makePlotline({ status: 'resolved' })
    await writePlotline(dir, plotline)

    const [found] = await listPlotlines(dir)
    expect(found.status).toBe('resolved')
  })

  it('returns [] for a project with no plotlines directory yet, without throwing', async () => {
    const dir = await makeProject()
    await expect(listPlotlines(dir)).resolves.toEqual([])
  })

  it('stamps modified with the current timestamp on write, distinct from created', async () => {
    const dir = await makeProject()
    const created = new Date(Date.now() - 10_000).toISOString()
    const plotline = makePlotline({ created, modified: created })

    const before = Date.now()
    await writePlotline(dir, plotline)
    const [written] = await listPlotlines(dir)

    expect(written.created).toBe(created)
    expect(Date.parse(written.modified)).toBeGreaterThanOrEqual(before)
  })

  it('lists multiple plotlines', async () => {
    const dir = await makeProject()
    await writePlotline(dir, makePlotline({ name: 'A' }))
    await writePlotline(dir, makePlotline({ name: 'B' }))
    const all = await listPlotlines(dir)
    expect(all.map((p) => p.name).sort()).toEqual(['A', 'B'])
  })
})

describe('deletePlotline', () => {
  it('removes only the targeted plotline and is a no-op for a missing id', async () => {
    const dir = await makeProject()
    const a = makePlotline({ name: 'Alpha' })
    const b = makePlotline({ name: 'Beta' })
    await writePlotline(dir, a)
    await writePlotline(dir, b)

    await deletePlotline(dir, a.id)
    const remaining = await listPlotlines(dir)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(b.id)

    await expect(deletePlotline(dir, 'nonexistent-id')).resolves.not.toThrow()
    expect(await listPlotlines(dir)).toHaveLength(1)
  })
})
