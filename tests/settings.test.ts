import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

const tmpDirs: string[] = []
let userDataDir = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

beforeEach(async () => {
  userDataDir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-settings-'))
  tmpDirs.push(userDataDir)
  vi.resetModules()
})

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('readAppearance', () => {
  it('remaps a pre-I-09 settings file that persisted the old "nes" value to virtualwyrm', async () => {
    await fsp.writeFile(
      join(userDataDir, 'settings.json'),
      JSON.stringify({ appearance: { palette: 'nes', fontSize: 21 } }),
      'utf8'
    )
    const { readAppearance } = await import('../src/main/wyrm/settings')

    const appearance = await readAppearance()

    expect(appearance.palette).toBe('virtualwyrm')
    // The rest of the stored settings survive the remap untouched.
    expect(appearance.fontSize).toBe(21)
  })

  it('leaves the new famicom palette alone — it must not collide with the retired nes value', async () => {
    await fsp.writeFile(
      join(userDataDir, 'settings.json'),
      JSON.stringify({ appearance: { palette: 'famicom' } }),
      'utf8'
    )
    const { readAppearance } = await import('../src/main/wyrm/settings')

    const appearance = await readAppearance()

    expect(appearance.palette).toBe('famicom')
  })

  it('does not touch unrelated palettes', async () => {
    await fsp.writeFile(
      join(userDataDir, 'settings.json'),
      JSON.stringify({ appearance: { palette: 'dark' } }),
      'utf8'
    )
    const { readAppearance } = await import('../src/main/wyrm/settings')

    const appearance = await readAppearance()

    expect(appearance.palette).toBe('dark')
  })
})
