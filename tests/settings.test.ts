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

/**
 * F-24: recentProjects backs the Welcome screen's list, kept deliberately
 * separate from lastProjectPath — closing a project clears the latter (no
 * more silent auto-reopen) but must never touch the former, or a closed
 * project would vanish from the very list meant to let you pick it back up.
 */
describe('recentProjects', () => {
  it('is empty with no settings file yet', async () => {
    const { readRecentProjects } = await import('../src/main/wyrm/settings')
    expect(await readRecentProjects()).toEqual([])
  })

  it('adds an entry, most-recent first', async () => {
    const { readRecentProjects, touchRecentProject } = await import('../src/main/wyrm/settings')
    await touchRecentProject('/a.wyrm', 'Novel A')
    await touchRecentProject('/b.wyrm', 'Novel B')

    const recents = await readRecentProjects()
    expect(recents.map((p) => p.path)).toEqual(['/b.wyrm', '/a.wyrm'])
  })

  it('re-opening an existing entry moves it to the front instead of duplicating it', async () => {
    const { readRecentProjects, touchRecentProject } = await import('../src/main/wyrm/settings')
    await touchRecentProject('/a.wyrm', 'Novel A')
    await touchRecentProject('/b.wyrm', 'Novel B')
    await touchRecentProject('/a.wyrm', 'Novel A')

    const recents = await readRecentProjects()
    expect(recents.map((p) => p.path)).toEqual(['/a.wyrm', '/b.wyrm'])
  })

  it('refreshes the title in case the project was renamed since', async () => {
    const { readRecentProjects, touchRecentProject } = await import('../src/main/wyrm/settings')
    await touchRecentProject('/a.wyrm', 'Draft Title')
    await touchRecentProject('/a.wyrm', 'The Real Title')

    const recents = await readRecentProjects()
    expect(recents).toEqual([expect.objectContaining({ path: '/a.wyrm', title: 'The Real Title' })])
  })

  it('caps the list rather than growing without bound', async () => {
    const { readRecentProjects, touchRecentProject } = await import('../src/main/wyrm/settings')
    for (let i = 0; i < 12; i++) await touchRecentProject(`/n${i}.wyrm`, `Novel ${i}`)

    const recents = await readRecentProjects()
    expect(recents.length).toBeLessThanOrEqual(8)
    // Newest survive, oldest are the ones dropped.
    expect(recents[0].path).toBe('/n11.wyrm')
  })

  it('removeRecentProject drops one entry and leaves the rest alone', async () => {
    const { readRecentProjects, removeRecentProject, touchRecentProject } =
      await import('../src/main/wyrm/settings')
    await touchRecentProject('/a.wyrm', 'Novel A')
    await touchRecentProject('/b.wyrm', 'Novel B')
    await removeRecentProject('/a.wyrm')

    const recents = await readRecentProjects()
    expect(recents.map((p) => p.path)).toEqual(['/b.wyrm'])
  })

  it('closing a project (clearing lastProjectPath) does not touch recentProjects', async () => {
    const { readRecentProjects, readSettings, touchRecentProject, writeSettings } =
      await import('../src/main/wyrm/settings')
    await touchRecentProject('/a.wyrm', 'Novel A')
    await writeSettings({ lastProjectPath: undefined })

    expect((await readSettings()).lastProjectPath).toBeUndefined()
    expect(await readRecentProjects()).toEqual([
      expect.objectContaining({ path: '/a.wyrm', title: 'Novel A' })
    ])
  })
})
