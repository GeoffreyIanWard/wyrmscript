// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'

/**
 * The backup layer's promise to the writer: an external drive that is missing,
 * full, or holding someone else's work can never interfere with saving. These
 * drive the real store against the in-memory api.
 */

async function openDemo(): Promise<string> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved', backupSettings: null })
  await useWyrm.getState().loadBackupSettings()
  return path
}

/** Make the project genuinely dirty so the mock actually creates a checkpoint. */
async function dirty(path: string): Promise<void> {
  const docs = await api.readAllDocs(path)
  await api.writeDoc(path, { ...docs[0], body: `${docs[0].body}\nAnother line ${Math.random()}.` })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  useWyrm.setState({ project: null, booted: false, backupSettings: null })
})

describe('backup settings', () => {
  it('starts unconfigured and never invents a location', async () => {
    await openDemo()
    expect(useWyrm.getState().backupSettings).toEqual({
      path: null,
      auto: false,
      lastBackupAt: null
    })
  })

  it('refuses to back up before a location is chosen', async () => {
    await openDemo()
    await expect(useWyrm.getState().backupNow()).rejects.toThrow(/No backup location/)
  })

  it('records the location and the time of a successful backup', async () => {
    await openDemo()
    await useWyrm.getState().chooseBackupLocation()
    expect(useWyrm.getState().backupSettings?.path).toBeTruthy()

    const outcome = await useWyrm.getState().backupNow()

    expect(outcome.status).toBe('backed-up')
    expect(useWyrm.getState().backupSettings?.lastBackupAt).toBeGreaterThan(0)
  })

  it('forgetting a location clears the schedule with it', async () => {
    await openDemo()
    await useWyrm.getState().chooseBackupLocation()
    await useWyrm.getState().setBackupAuto(true)

    await useWyrm.getState().clearBackupLocation()

    expect(useWyrm.getState().backupSettings).toEqual({
      path: null,
      auto: false,
      lastBackupAt: null
    })
  })
})

describe('automatic backup after a checkpoint', () => {
  it('does not run when it has not been switched on', async () => {
    const path = await openDemo()
    await useWyrm.getState().chooseBackupLocation()
    const backupNow = vi.spyOn(api, 'backupNow')

    await dirty(path)
    await useWyrm.getState().commitNow('A checkpoint')

    expect(backupNow).not.toHaveBeenCalled()
  })

  it('runs after a checkpoint once switched on', async () => {
    const path = await openDemo()
    await useWyrm.getState().chooseBackupLocation()
    await useWyrm.getState().setBackupAuto(true)
    const backupNow = vi.spyOn(api, 'backupNow')

    await dirty(path)
    await useWyrm.getState().commitNow('A checkpoint')

    await vi.waitFor(() => expect(backupNow).toHaveBeenCalledWith(path))
  })

  it('skips the backup when the checkpoint found nothing to commit', async () => {
    await openDemo()
    await useWyrm.getState().chooseBackupLocation()
    await useWyrm.getState().setBackupAuto(true)
    const backupNow = vi.spyOn(api, 'backupNow')

    // Nothing changed since the last commit, so there is no new state to mirror.
    await useWyrm.getState().commitNow('Nothing to say')

    expect(backupNow).not.toHaveBeenCalled()
  })

  it('a failing backup never breaks the checkpoint', async () => {
    const path = await openDemo()
    await useWyrm.getState().chooseBackupLocation()
    await useWyrm.getState().setBackupAuto(true)
    vi.spyOn(api, 'backupNow').mockRejectedValue(new Error('Backup drive not connected'))

    await dirty(path)
    await expect(useWyrm.getState().commitNow('Still saves')).resolves.toBeUndefined()

    expect(useWyrm.getState().lastCommitAt).toBeGreaterThan(0)
  })
})
