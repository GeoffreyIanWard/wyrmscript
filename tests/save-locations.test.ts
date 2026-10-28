import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import type { BackupSettings, SyncStatus } from '../src/shared/types'
import {
  brokenReason,
  describeLocation,
  driveName,
  isRemovable,
  moveLocation,
  removedBySingle,
  saveLocations,
  savesToMultiple,
  timeAgo
} from '../src/renderer/src/lib/saveLocations'

/**
 * F-50: the Save To drawer's cards. Three stores that already existed — the
 * project's folder, the backup targets, the GitHub link — read as one list in
 * the writer's order, the first the default.
 */

const PROJECT = '/novels/Winter.wyrm'

let userDataDir = ''
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))

const NO_SYNC: SyncStatus = {
  mode: 'local-only',
  remoteUrl: null,
  login: null,
  clientIdSet: true,
  lastSyncAt: null,
  pendingSync: false
}
const SYNCED: SyncStatus = {
  ...NO_SYNC,
  mode: 'github',
  remoteUrl: 'https://github.com/someone/winter.git',
  login: 'someone',
  lastSyncAt: 300
}

const backup = (order?: string[]): BackupSettings => ({
  targets: [
    { id: 't1', path: '/Volumes/CARD/Winter.wyrm.git', lastBackupAt: 100 },
    { id: 't2', path: 'E:\\Backups\\Winter.wyrm.git', lastBackupAt: null }
  ],
  auto: true,
  ...(order ? { order } : {})
})

const ids = (list: { id: string }[]): string[] => list.map((l) => l.id)

describe('the list of locations', () => {
  it('starts with the project folder, then the drives as added, then GitHub', () => {
    const list = saveLocations(PROJECT, 50, backup(), SYNCED)
    expect(ids(list)).toEqual(['folder', 't1', 't2', 'github'])
    expect(list[0]).toMatchObject({ kind: 'folder', path: PROJECT, lastSavedAt: 50 })
    expect(list[1]).toMatchObject({ kind: 'disk', lastSavedAt: 100 })
    expect(list[3]).toMatchObject({ kind: 'github', lastSavedAt: 300 })
  })

  it('always has the project folder, even with nothing else set up', () => {
    expect(ids(saveLocations(PROJECT, null, null, null))).toEqual(['folder'])
  })

  it('follows the stored order, so GitHub can be the default', () => {
    const list = saveLocations(PROJECT, null, backup(['github', 't2', 'folder', 't1']), SYNCED)
    expect(ids(list)).toEqual(['github', 't2', 'folder', 't1'])
  })

  it('puts a location the order does not name after the named ones', () => {
    // t2 was added after the writer last reordered.
    const list = saveLocations(PROJECT, null, backup(['t1', 'folder']), SYNCED)
    expect(ids(list)).toEqual(['t1', 'folder', 't2', 'github'])
  })

  it('skips an id that is no longer a location', () => {
    const list = saveLocations(PROJECT, null, backup(['gone', 't2', 'folder']), NO_SYNC)
    expect(ids(list)).toEqual(['t2', 'folder', 't1'])
  })

  it('keeps GitHub on the list when the link is broken, so the writer can see it', () => {
    const drifted: SyncStatus = { ...SYNCED, remoteUrl: null }
    expect(ids(saveLocations(PROJECT, null, null, drifted))).toEqual(['folder', 'github'])
    expect(ids(saveLocations(PROJECT, null, null, NO_SYNC))).toEqual(['folder'])
  })
})

describe('removing and reordering', () => {
  it('never offers to remove the project folder', () => {
    const list = saveLocations(PROJECT, null, backup(), SYNCED)
    expect(list.map(isRemovable)).toEqual([false, true, true, true])
  })

  it('moves a card, clamping at either end', () => {
    const list = saveLocations(PROJECT, null, backup(), SYNCED)
    expect(moveLocation(list, 'github', 0)).toEqual(['github', 'folder', 't1', 't2'])
    expect(moveLocation(list, 'folder', 99)).toEqual(['t1', 't2', 'github', 'folder'])
    expect(moveLocation(list, 't1', -5)).toEqual(['t1', 'folder', 't2', 'github'])
    expect(moveLocation(list, 'nope', 0)).toEqual(['folder', 't1', 't2', 'github'])
  })

  it('saving to one place removes all but the default', () => {
    const list = saveLocations(PROJECT, null, backup(), SYNCED)
    expect(ids(removedBySingle(list))).toEqual(['t1', 't2', 'github'])
  })

  it('keeps the project folder beside a GitHub default', () => {
    const list = saveLocations(PROJECT, null, backup(['github']), SYNCED)
    expect(ids(removedBySingle(list))).toEqual(['t1', 't2'])
    // Once the drives are gone, GitHub and the folder are left: still two
    // places, so the switch reads on, though turning it off removes nothing.
    const after = saveLocations(
      PROJECT,
      null,
      { targets: [], auto: true, order: ['github'] },
      SYNCED
    )
    expect(ids(after)).toEqual(['github', 'folder'])
    expect(savesToMultiple(after)).toBe(true)
    expect(removedBySingle(after)).toEqual([])
  })

  it('reads the multiple switch on whenever there is more than one card', () => {
    expect(savesToMultiple(saveLocations(PROJECT, null, null, NO_SYNC))).toBe(false)
    expect(savesToMultiple(saveLocations(PROJECT, null, backup(), NO_SYNC))).toBe(true)
  })
})

describe('a location that cannot be reached', () => {
  const list = saveLocations(PROJECT, null, backup(), SYNCED)
  const [folder, card, , github] = list

  it('names a drive that is not connected', () => {
    expect(brokenReason(card, SYNCED, ['t1'], false)).toBe('Drive not connected')
    expect(brokenReason(card, SYNCED, ['t2'], false)).toBeNull()
  })

  it('says why GitHub cannot be reached', () => {
    expect(brokenReason(github, SYNCED, [], false)).toBeNull()
    expect(brokenReason(github, SYNCED, [], true)).toBe('GitHub unreachable')
    expect(brokenReason(github, { ...SYNCED, login: null }, [], false)).toBe('Signed out of GitHub')
    expect(brokenReason(github, { ...SYNCED, remoteUrl: null }, [], false)).toBe(
      'This project lost its link to GitHub'
    )
  })

  it('never calls the project folder broken', () => {
    expect(brokenReason(folder, SYNCED, ['folder'], true)).toBeNull()
  })
})

describe('the words on a card', () => {
  it('names drives the way the writer sees them', () => {
    expect(driveName('/Volumes/CARD/Winter.wyrm.git')).toBe('CARD')
    expect(driveName('e:\\Backups\\Winter.wyrm.git')).toBe('Drive E:')
    expect(driveName('/home/me/backups/Winter.wyrm.git')).toBe('Disk')
  })

  it('never says repository or .git', () => {
    const [folder, , , github] = saveLocations(PROJECT, null, backup(), SYNCED)
    expect(describeLocation(folder)).toEqual({ name: 'This computer', detail: PROJECT })
    expect(describeLocation(github)).toEqual({
      name: 'GitHub',
      detail: 'github.com/someone/winter'
    })
  })

  it('says how long ago', () => {
    const now = 10 * 24 * 3_600_000
    expect(timeAgo(now - 10_000, now)).toBe('just now')
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(timeAgo(now - 30 * 3_600_000, now)).toBe('yesterday')
    expect(timeAgo(now - 4 * 24 * 3_600_000, now)).toBe('4 days ago')
  })
})

describe('the stored order', () => {
  beforeEach(async () => {
    userDataDir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-save-order-'))
    vi.resetModules()
  })
  afterEach(async () => {
    await fsp.rm(userDataDir, { recursive: true, force: true })
  })

  it('survives a later change to the backup settings', async () => {
    const { readBackupSettings, writeBackupSettings, addBackupTarget } =
      await import('../src/main/wyrm/settings')
    await writeBackupSettings(PROJECT, { order: ['github', 'folder'] })
    await addBackupTarget(PROJECT, '/Volumes/CARD/Winter.wyrm.git')
    await writeBackupSettings(PROJECT, { auto: true })
    expect((await readBackupSettings(PROJECT)).order).toEqual(['github', 'folder'])
  })

  it('is absent until the writer reorders', async () => {
    const { readBackupSettings, addBackupTarget } = await import('../src/main/wyrm/settings')
    await addBackupTarget(PROJECT, '/Volumes/CARD/Winter.wyrm.git')
    expect((await readBackupSettings(PROJECT)).order).toBeUndefined()
  })
})
