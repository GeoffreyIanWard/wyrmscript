import { app, ipcMain, dialog, BrowserWindow, safeStorage } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { join, basename } from 'node:path'
import http from 'isomorphic-git/http/node'
import type {
  AppearanceSettings,
  ConflictResolution,
  DocFile,
  Entity,
  EntityType,
  MapPin,
  Plotline,
  ProjectData,
  Relationship,
  StatsSettings,
  SyncOutcome,
  SyncStatus
} from '../../shared/types'
import { commitAll, createVariant, deleteVariant, listVariants, logCommits } from './git'
import { deleteEntity, listEntities, readAllDocs, writeEntity } from './entities'
import { deletePlotline, listPlotlines, writePlotline } from './plotlines'
import { deleteRelationship, listRelationships, writeRelationship } from './relationships'
import { deleteMapPin, listMapPins, writeMapPin } from './worldMap'
import {
  createProject,
  docRepoPath,
  openProject,
  readDoc,
  readDocAtRef,
  restoreDocToRef,
  saveProject,
  writeDoc
} from './project'
import {
  readAppearance,
  readBackupSettings,
  readSettings,
  readStatsSettings,
  readSyncProject,
  writeAppearance,
  writeBackupSettings,
  writeSettings,
  writeStatsSettings,
  writeSyncProject
} from './settings'
import { backupNameFor, backupProject, restoreBackup } from './backup'
import { dailyStats } from './stats'
import {
  clearRemote,
  getRemoteUrl,
  realTransport,
  resolveSyncConflicts,
  setRemoteUrl,
  syncProject
} from './sync'
import {
  createPrivateRepo,
  fetchGithubLogin,
  pollDeviceFlow,
  startDeviceFlow,
  type DeviceFlowSession
} from './github-auth'

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

async function rememberProject(path: string): Promise<void> {
  await writeSettings({ lastProjectPath: path })
}

export function registerIpc(): void {
  ipcMain.handle('project:create', async (_e, title: string) => {
    const win = focusedWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      title: 'New WyrmStar Project',
      // Absolute default: a relative path would resolve against the app's
      // working directory (the repo, in dev) instead of somewhere sensible.
      defaultPath: join(app.getPath('documents'), `${title || 'My Novel'}.wyrm`),
      buttonLabel: 'Create',
      properties: ['createDirectory']
    })
    if (result.canceled || !result.filePath) return null
    const path = result.filePath.endsWith('.wyrm') ? result.filePath : `${result.filePath}.wyrm`
    const info = await createProject(path, title || basename(path, '.wyrm'))
    await rememberProject(path)
    return info
  })

  ipcMain.handle('project:open', async () => {
    const win = focusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Open WyrmStar Project',
      properties: ['openDirectory'],
      buttonLabel: 'Open'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    if (!existsSync(join(path, 'project.json'))) {
      dialog.showErrorBox('Not a WyrmStar project', 'The selected folder has no project.json.')
      return null
    }
    const info = await openProject(path)
    await rememberProject(path)
    return info
  })

  ipcMain.handle('project:openPath', async (_e, path: string) => {
    if (!existsSync(join(path, 'project.json'))) return null
    const info = await openProject(path)
    await rememberProject(path)
    return info
  })

  ipcMain.handle('project:save', (_e, path: string, data: ProjectData) => saveProject(path, data))
  ipcMain.handle('doc:read', (_e, path: string, id: string) => readDoc(path, id))
  ipcMain.handle('doc:write', (_e, path: string, doc: DocFile) => writeDoc(path, doc))
  ipcMain.handle('git:commit', (_e, path: string, message: string) => commitAll(path, message))
  ipcMain.handle('settings:lastProject', async () => (await readSettings()).lastProjectPath ?? null)

  ipcMain.handle('git:log', (_e, path: string, docId?: string) =>
    logCommits(path, docId ? docRepoPath(docId) : undefined)
  )
  ipcMain.handle('doc:atRef', (_e, path: string, id: string, ref: string) =>
    readDocAtRef(path, id, ref)
  )
  ipcMain.handle('doc:restore', (_e, path: string, id: string, ref: string, label: string) =>
    restoreDocToRef(path, id, ref, label)
  )
  ipcMain.handle('variant:create', (_e, path: string, docId: string, name: string) =>
    createVariant(path, docId, name)
  )
  ipcMain.handle('variant:list', (_e, path: string, docId: string) => listVariants(path, docId))
  ipcMain.handle('variant:delete', (_e, path: string, branch: string) =>
    deleteVariant(path, branch)
  )

  ipcMain.handle('entity:list', (_e, path: string) => listEntities(path))
  ipcMain.handle('entity:write', (_e, path: string, entity: Entity) => writeEntity(path, entity))
  ipcMain.handle('entity:delete', (_e, path: string, type: EntityType, id: string) =>
    deleteEntity(path, type, id)
  )
  ipcMain.handle('doc:readAll', (_e, path: string) => readAllDocs(path))

  ipcMain.handle('plotline:list', (_e, path: string) => listPlotlines(path))
  ipcMain.handle('plotline:write', (_e, path: string, plotline: Plotline) =>
    writePlotline(path, plotline)
  )
  ipcMain.handle('plotline:delete', (_e, path: string, id: string) => deletePlotline(path, id))

  ipcMain.handle('relationship:list', (_e, path: string) => listRelationships(path))
  ipcMain.handle('relationship:write', (_e, path: string, relationship: Relationship) =>
    writeRelationship(path, relationship)
  )
  ipcMain.handle('relationship:delete', (_e, path: string, id: string) =>
    deleteRelationship(path, id)
  )

  ipcMain.handle('mapPin:list', (_e, path: string) => listMapPins(path))
  ipcMain.handle('mapPin:write', (_e, path: string, pin: MapPin) => writeMapPin(path, pin))
  ipcMain.handle('mapPin:delete', (_e, path: string, id: string) => deleteMapPin(path, id))

  /* ---------- appearance & page geometry (F-05, F-06) ---------- */

  ipcMain.handle('appearance:get', () => readAppearance())
  ipcMain.handle('appearance:set', (_e, patch: Partial<AppearanceSettings>) =>
    writeAppearance(patch)
  )

  /* ---------- writing stats (4c) ---------- */

  ipcMain.handle('stats:settings:get', () => readStatsSettings())
  ipcMain.handle('stats:settings:set', (_e, patch: Partial<StatsSettings>) =>
    writeStatsSettings(patch)
  )

  // Checkpoint before reading, the same way compile does: the history is the
  // only source of these numbers, so uncommitted work would otherwise be
  // invisible and a writer who just wrote 300 words would be told they wrote
  // none. Committing first makes the answer exact rather than up-to-five-
  // minutes stale.
  ipcMain.handle('stats:daily', async (_e, path: string) => {
    await commitAll(path, 'Autosave').catch(() => false)
    return dailyStats(path)
  })

  /* ---------- local backup (F-01) ---------- */

  ipcMain.handle('backup:get', (_e, path: string) => readBackupSettings(path))

  ipcMain.handle('backup:choose', async (_e, path: string) => {
    const win = focusedWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      title: 'Choose Backup Location',
      // An external drive is the point of the feature, so start somewhere the
      // writer will recognise rather than inside the project itself.
      defaultPath: join(app.getPath('documents'), backupNameFor(path)),
      buttonLabel: 'Use This Location',
      properties: ['createDirectory']
    })
    if (result.canceled || !result.filePath) return null
    return writeBackupSettings(path, { path: result.filePath })
  })

  ipcMain.handle('backup:auto', (_e, path: string, auto: boolean) =>
    writeBackupSettings(path, { auto })
  )

  ipcMain.handle('backup:clear', (_e, path: string) =>
    writeBackupSettings(path, { path: null, auto: false, lastBackupAt: null })
  )

  ipcMain.handle('backup:now', async (_e, path: string) => {
    const settings = await readBackupSettings(path)
    if (!settings.path) throw new Error('No backup location has been chosen for this project.')
    const outcome = await backupProject(path, settings.path)
    // Only a real mirror advances the timestamp — "up to date" keeps the time
    // of the backup that actually holds the work.
    if (outcome.status === 'backed-up')
      await writeBackupSettings(path, { lastBackupAt: outcome.at })
    return outcome
  })

  ipcMain.handle('backup:restore', async () => {
    const win = focusedWindow()
    if (!win) return null
    const picked = await dialog.showOpenDialog(win, {
      title: 'Restore from Backup',
      properties: ['openDirectory'],
      buttonLabel: 'Restore From This'
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    const source = picked.filePaths[0]
    if (!existsSync(join(source, 'objects'))) {
      dialog.showErrorBox('Not a WyrmStar backup', 'That folder is not a backup repository.')
      return null
    }
    const destination = await dialog.showSaveDialog(win, {
      title: 'Restore As New Project',
      defaultPath: join(app.getPath('documents'), basename(source).replace(/\.git$/, '')),
      buttonLabel: 'Restore',
      properties: ['createDirectory']
    })
    if (destination.canceled || !destination.filePath) return null
    const path = destination.filePath.endsWith('.wyrm')
      ? destination.filePath
      : `${destination.filePath}.wyrm`
    const data = await restoreBackup(source, path)
    await rememberProject(path)
    return { path, data }
  })

  /* ---------- GitHub sync (Phase 5) ---------- */

  // Token at rest: encrypted through the OS keychain when available. The
  // prefix records which way it was written so a keychain appearing later
  // cannot silently make old entries unreadable.
  const encodeToken = (token: string): string =>
    safeStorage.isEncryptionAvailable()
      ? `enc:${safeStorage.encryptString(token).toString('base64')}`
      : `plain:${token}`

  const decodeToken = (stored: string | undefined): string | null => {
    if (!stored) return null
    if (stored.startsWith('enc:')) {
      try {
        return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
      } catch {
        return null
      }
    }
    return stored.startsWith('plain:') ? stored.slice(6) : null
  }

  const getToken = async (): Promise<string | null> =>
    decodeToken((await readSettings()).githubToken)
  const transport = realTransport(http, getToken)

  const syncStatusOf = async (path: string): Promise<SyncStatus> => {
    const settings = await readSettings()
    const project = await readSyncProject(path)
    return {
      mode: project.mode,
      remoteUrl: await getRemoteUrl(path),
      login: settings.githubLogin ?? null,
      clientIdSet: Boolean(settings.syncClientId),
      lastSyncAt: project.lastSyncAt,
      pendingSync: project.pendingSync
    }
  }

  /** Fold an outcome into the per-project bookkeeping. */
  const recordOutcome = async (path: string, outcome: SyncOutcome): Promise<SyncOutcome> => {
    const at = Date.now()
    if (outcome.status === 'pushed' || outcome.status === 'up-to-date') {
      await writeSyncProject(path, { lastSyncAt: at, pendingSync: false })
    } else if (outcome.status === 'pulled' || outcome.status === 'merged') {
      await writeSyncProject(path, { lastSyncAt: at, pendingSync: !outcome.pushed })
    } else if (outcome.status === 'offline') {
      await writeSyncProject(path, { pendingSync: true })
    }
    return outcome
  }

  let deviceSession: DeviceFlowSession | null = null

  ipcMain.handle('sync:status', (_e, path: string) => syncStatusOf(path))

  ipcMain.handle('sync:clientId', async (_e, path: string, clientId: string) => {
    await writeSettings({ syncClientId: clientId.trim() })
    return syncStatusOf(path)
  })

  ipcMain.handle('sync:signInStart', async () => {
    const { syncClientId } = await readSettings()
    if (!syncClientId) throw new Error('Set the GitHub client id first.')
    deviceSession = await startDeviceFlow(syncClientId)
    return {
      userCode: deviceSession.userCode,
      verificationUri: deviceSession.verificationUri,
      expiresIn: Math.max(0, Math.round((deviceSession.expiresAt - Date.now()) / 1000))
    }
  })

  ipcMain.handle('sync:signInPoll', async () => {
    const { syncClientId } = await readSettings()
    if (!deviceSession || !syncClientId) return { state: 'error', detail: 'No sign-in is running.' }
    const result = await pollDeviceFlow(syncClientId, deviceSession)
    if (result.state !== 'ok') {
      if (result.state === 'error') deviceSession = null
      return result
    }
    deviceSession = null
    const login = await fetchGithubLogin(result.token)
    await writeSettings({ githubToken: encodeToken(result.token), githubLogin: login })
    return { state: 'ok', login }
  })

  ipcMain.handle('sync:signOut', async (_e, path: string) => {
    await writeSettings({ githubToken: undefined, githubLogin: undefined })
    return syncStatusOf(path)
  })

  ipcMain.handle(
    'sync:connect',
    async (_e, path: string, options: { create: boolean; name?: string; url?: string }) => {
      let url = options.url?.trim() ?? ''
      if (options.create) {
        const token = await getToken()
        if (!token) throw new Error('Sign in with GitHub first.')
        url = await createPrivateRepo(token, options.name?.trim() || 'novel')
      }
      if (!url) throw new Error('No address was given.')
      await setRemoteUrl(path, url)
      await writeSyncProject(path, { mode: 'github' })
      return syncStatusOf(path)
    }
  )

  ipcMain.handle('sync:disconnect', async (_e, path: string) => {
    await clearRemote(path)
    await writeSyncProject(path, { mode: 'unset', pendingSync: false })
    return syncStatusOf(path)
  })

  ipcMain.handle('sync:localOnly', async (_e, path: string) => {
    await writeSyncProject(path, { mode: 'local-only', pendingSync: false })
    return syncStatusOf(path)
  })

  ipcMain.handle('sync:now', async (_e, path: string) =>
    recordOutcome(path, await syncProject(path, transport))
  )

  ipcMain.handle(
    'sync:resolve',
    async (_e, path: string, choices: { path: string; resolution: ConflictResolution }[]) =>
      recordOutcome(path, await resolveSyncConflicts(path, choices, transport))
  )

  ipcMain.handle('compile:export', async (_e, defaultName: string, data: string | Uint8Array) => {
    const win = focusedWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      title: 'Compile Manuscript',
      defaultPath: join(app.getPath('documents'), defaultName),
      buttonLabel: 'Compile'
    })
    if (result.canceled || !result.filePath) return null
    // Compiled output leaves the project entirely — it is a deliverable, not
    // project data, so it is written wherever the writer asks and never
    // touched again.
    if (typeof data === 'string') await fsp.writeFile(result.filePath, data, 'utf8')
    else await fsp.writeFile(result.filePath, Buffer.from(data))
    return result.filePath
  })
}
