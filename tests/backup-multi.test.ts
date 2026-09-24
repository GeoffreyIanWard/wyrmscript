import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

/**
 * F-40: a project mirrors to several locations, and they fall out of date
 * independently.
 *
 * The migration tests matter most. Backup settings were a single `path` before
 * this, and a writer who already has an external drive configured must not
 * quietly lose it — that would leave a project with no second copy while the
 * app still said `◆ LOCAL + BACKUP`, which is precisely the class of lie F-01
 * went to some trouble to remove.
 */

const tmpDirs: string[] = []
let userDataDir = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

async function writeSettingsFile(contents: unknown): Promise<void> {
  await fsp.writeFile(join(userDataDir, 'settings.json'), JSON.stringify(contents), 'utf8')
}

beforeEach(async () => {
  userDataDir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-backup-'))
  tmpDirs.push(userDataDir)
  vi.resetModules()
})

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('migrating a pre-F-40 backup setting', () => {
  it('carries the configured location over as a target', async () => {
    await writeSettingsFile({
      backups: {
        '/novels/Winter.wyrm': {
          path: '/Volumes/Passport/Winter.wyrm.git',
          auto: true,
          lastBackupAt: 1_700_000_000_000
        }
      }
    })
    const { readBackupSettings } = await import('../src/main/wyrm/settings')

    const settings = await readBackupSettings('/novels/Winter.wyrm')

    expect(settings.auto).toBe(true)
    expect(settings.targets).toHaveLength(1)
    expect(settings.targets[0].path).toBe('/Volumes/Passport/Winter.wyrm.git')
    // The time survives too: resetting it would make a current backup look
    // like one that had never run.
    expect(settings.targets[0].lastBackupAt).toBe(1_700_000_000_000)
  })

  it('does not invent a target for a project that never had one', async () => {
    await writeSettingsFile({
      backups: { '/novels/Winter.wyrm': { path: null, auto: false, lastBackupAt: null } }
    })
    const { readBackupSettings } = await import('../src/main/wyrm/settings')

    expect((await readBackupSettings('/novels/Winter.wyrm')).targets).toEqual([])
  })

  it('survives a patch landing on a legacy record', async () => {
    // Toggling automatic backup must not drop the drive that was already set.
    await writeSettingsFile({
      backups: {
        '/novels/Winter.wyrm': { path: '/Volumes/Passport/W.git', auto: false, lastBackupAt: null }
      }
    })
    const { writeBackupSettings } = await import('../src/main/wyrm/settings')

    const after = await writeBackupSettings('/novels/Winter.wyrm', { auto: true })

    expect(after.targets.map((t) => t.path)).toEqual(['/Volumes/Passport/W.git'])
    expect(after.auto).toBe(true)
  })

  it('leaves an already-migrated record alone', async () => {
    await writeSettingsFile({
      backups: {
        '/novels/Winter.wyrm': {
          targets: [{ id: 'a', path: '/Volumes/One', lastBackupAt: 5 }],
          auto: false
        }
      }
    })
    const { readBackupSettings } = await import('../src/main/wyrm/settings')

    const settings = await readBackupSettings('/novels/Winter.wyrm')

    expect(settings.targets).toEqual([{ id: 'a', path: '/Volumes/One', lastBackupAt: 5 }])
  })
})

describe('managing targets', () => {
  it('adds several and removes them individually', async () => {
    const { addBackupTarget, removeBackupTarget, readBackupSettings } =
      await import('../src/main/wyrm/settings')
    await addBackupTarget('/p', '/Volumes/One')
    await addBackupTarget('/p', '/Volumes/Two')
    const [first, second] = (await readBackupSettings('/p')).targets

    await removeBackupTarget('/p', first.id)

    expect((await readBackupSettings('/p')).targets.map((t) => t.path)).toEqual(['/Volumes/Two'])
    expect(second.path).toBe('/Volumes/Two')
  })

  it('ignores a location that is already configured', async () => {
    // Adding the same drive twice would mirror to it twice per checkpoint and
    // list it twice in the panel.
    const { addBackupTarget, readBackupSettings } = await import('../src/main/wyrm/settings')
    await addBackupTarget('/p', '/Volumes/One')
    await addBackupTarget('/p', '/Volumes/One')

    expect((await readBackupSettings('/p')).targets).toHaveLength(1)
  })

  it('gives every target a distinct id', async () => {
    const { addBackupTarget, readBackupSettings } = await import('../src/main/wyrm/settings')
    await addBackupTarget('/p', '/Volumes/One')
    await addBackupTarget('/p', '/Volumes/Two')
    const ids = (await readBackupSettings('/p')).targets.map((t) => t.id)

    expect(new Set(ids).size).toBe(2)
  })

  it('updates one target without disturbing the other', async () => {
    const { addBackupTarget, updateBackupTarget, readBackupSettings } =
      await import('../src/main/wyrm/settings')
    await addBackupTarget('/p', '/Volumes/One')
    await addBackupTarget('/p', '/Volumes/Two')
    const [first, second] = (await readBackupSettings('/p')).targets

    await updateBackupTarget('/p', first.id, { lastBackupAt: 99 })
    const after = (await readBackupSettings('/p')).targets

    expect(after.find((t) => t.id === first.id)?.lastBackupAt).toBe(99)
    expect(after.find((t) => t.id === second.id)?.lastBackupAt).toBeNull()
  })
})

describe('reachability', () => {
  it('accepts a folder that exists', async () => {
    const { isReachable } = await import('../src/main/wyrm/backup')

    expect(await isReachable(userDataDir)).toBe(true)
  })

  it('accepts a folder that does not exist yet but whose parent does', async () => {
    // A first backup to a connected drive: the repository has not been created.
    const { isReachable } = await import('../src/main/wyrm/backup')

    expect(await isReachable(join(userDataDir, 'not-created-yet.git'))).toBe(true)
  })

  it('rejects a path on a volume that is not mounted', async () => {
    // An unplugged card: the mount point itself is gone, so neither the target
    // nor its parent exists.
    const { isReachable } = await import('../src/main/wyrm/backup')

    expect(await isReachable('/Volumes/DefinitelyNotMounted/novel.git')).toBe(false)
  })
})
