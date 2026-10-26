import { app, ipcMain, dialog, BrowserWindow, safeStorage } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { join, basename } from 'node:path'
import http from 'isomorphic-git/http/node'
import type {
  GithubAccount,
  AppearanceSettings,
  WindowGeometry,
  BoardString,
  BoardSticker,
  ConflictResolution,
  DocFile,
  Entity,
  EntityType,
  MapPin,
  MapMark,
  MapShape,
  Plotline,
  ProjectData,
  Relationship,
  PrintSettings,
  StatsSettings,
  SyncOutcome,
  SyncStatus
} from '../../shared/types'
import { TITLE_BAR_OVERLAY_HEIGHT } from '../../shared/types'
import { commitAll, createVariant, deleteVariant, listVariants, logCommits } from './git'
import {
  copyPortrait,
  deleteEntity,
  listEntities,
  readAllDocs,
  readPortraitDataUrl,
  removePortrait,
  writeEntity
} from './entities'
import { deletePlotline, listPlotlines, writePlotline } from './plotlines'
import { deleteRelationship, listRelationships, writeRelationship } from './relationships'
import { deleteMapPin, listMapPins, writeMapPin } from './worldMap'
import { deleteMapMark, listMapMarks, writeMapMark } from './mapMarks'
import { deleteMapShape, listMapShapes, writeMapShape } from './mapShapes'
import { deleteBoardString, listBoardStrings, writeBoardString } from './boardStrings'
import { deleteBoardSticker, listBoardStickers, writeBoardSticker } from './boardStickers'
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
  addBackupTarget,
  readBackupSettings,
  clearWindowGeometry,
  readWindowGeometry,
  writeWindowGeometry,
  removeBackupTarget,
  updateBackupTarget,
  readRecentProjects,
  readSettings,
  readPrintSettings,
  readStatsSettings,
  readSyncProject,
  removeRecentProject,
  touchRecentProject,
  writeAppearance,
  writeBackupSettings,
  writeSettings,
  writePrintSettings,
  writeStatsSettings,
  writeSyncProject
} from './settings'
import { backupNameFor, backupToAll, restoreBackup } from './backup'
import { cloneProject } from './clone'
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
  clientIdOf,
  createPrivateRepo,
  fetchGithubLogin,
  listUserRepos,
  pollDeviceFlow,
  startDeviceFlow,
  type DeviceFlowSession
} from './github-auth'

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

async function rememberProject(path: string, title: string): Promise<void> {
  await writeSettings({ lastProjectPath: path })
  await touchRecentProject(path, title)
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
    await rememberProject(path, info.data.title)
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
    await rememberProject(path, info.data.title)
    return info
  })

  ipcMain.handle('project:openPath', async (_e, path: string) => {
    if (!existsSync(join(path, 'project.json'))) {
      // F-24: the boot-time auto-reopen and a recents-row click both funnel
      // through here — a moved or deleted project should quietly drop off
      // the recents list rather than sit there as a dead row forever.
      await removeRecentProject(path)
      return null
    }
    const info = await openProject(path)
    await rememberProject(path, info.data.title)
    return info
  })

  ipcMain.handle('project:save', (_e, path: string, data: ProjectData) => saveProject(path, data))
  ipcMain.handle('doc:read', (_e, path: string, id: string) => readDoc(path, id))
  ipcMain.handle('doc:write', (_e, path: string, doc: DocFile) => writeDoc(path, doc))
  ipcMain.handle('git:commit', (_e, path: string, message: string) => commitAll(path, message))
  ipcMain.handle('settings:lastProject', async () => (await readSettings()).lastProjectPath ?? null)
  ipcMain.handle('settings:recentProjects', () => readRecentProjects())
  // F-24: "close" means the renderer forgets the project and the next launch
  // lands on Welcome — the entry stays in recentProjects (that list is what
  // Welcome offers to reopen), only auto-reopen-on-boot turns off.
  ipcMain.handle('project:close', () => writeSettings({ lastProjectPath: undefined }))

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

  /* ---------- portraits (F-47) ---------- */

  // The renderer names the entry by id alone; its collection folder comes
  // from the entry's own record, so nothing sent over the bridge is ever
  // used as a path. An id not in the project is "no portrait", not an error:
  // a card can ask just after its entry was deleted on another device.
  const entityTypeOf = async (path: string, entityId: string): Promise<EntityType | null> =>
    (await listEntities(path)).find((e) => e.id === entityId)?.type ?? null

  ipcMain.handle('portrait:import', async (_e, path: string, entityId: string) => {
    const win = focusedWindow()
    if (!win) return null
    const type = await entityTypeOf(path, entityId)
    if (!type) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a Portrait',
      defaultPath: app.getPath('pictures'),
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      buttonLabel: 'Use This Image'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return copyPortrait(path, type, entityId, result.filePaths[0])
  })

  ipcMain.handle('portrait:read', async (_e, path: string, entityId: string) => {
    const type = await entityTypeOf(path, entityId)
    return type ? readPortraitDataUrl(path, type, entityId) : null
  })

  ipcMain.handle('portrait:remove', async (_e, path: string, entityId: string) => {
    const type = await entityTypeOf(path, entityId)
    if (type) await removePortrait(path, type, entityId)
  })

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
  ipcMain.handle('mapShape:list', (_e, path: string) => listMapShapes(path))
  ipcMain.handle('mapShape:write', (_e, path: string, shape: MapShape) =>
    writeMapShape(path, shape)
  )
  ipcMain.handle('mapShape:delete', (_e, path: string, id: string) => deleteMapShape(path, id))
  ipcMain.handle('mapMark:list', (_e, path: string) => listMapMarks(path))
  ipcMain.handle('mapMark:write', (_e, path: string, mark: MapMark) => writeMapMark(path, mark))
  ipcMain.handle('mapMark:delete', (_e, path: string, id: string) => deleteMapMark(path, id))

  ipcMain.handle('boardString:list', (_e, path: string) => listBoardStrings(path))
  ipcMain.handle('boardString:write', (_e, path: string, s: BoardString) =>
    writeBoardString(path, s)
  )
  ipcMain.handle('boardString:delete', (_e, path: string, id: string) =>
    deleteBoardString(path, id)
  )
  ipcMain.handle('boardSticker:list', (_e, path: string) => listBoardStickers(path))
  ipcMain.handle('boardSticker:write', (_e, path: string, s: BoardSticker) =>
    writeBoardSticker(path, s)
  )
  ipcMain.handle('boardSticker:delete', (_e, path: string, id: string) =>
    deleteBoardSticker(path, id)
  )

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

  /* ---------- project windows (F-41) ---------- */

  ipcMain.handle('window:geometry:get', (_e, path: string) => readWindowGeometry(path))
  ipcMain.handle('window:geometry:set', (_e, path: string, geometry: WindowGeometry) =>
    writeWindowGeometry(path, geometry)
  )
  ipcMain.handle('window:geometry:clear', (_e, path: string) => clearWindowGeometry(path))

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
    return addBackupTarget(path, result.filePath)
  })

  ipcMain.handle('backup:auto', (_e, path: string, auto: boolean) =>
    writeBackupSettings(path, { auto })
  )

  ipcMain.handle('backup:remove', (_e, path: string, targetId: string) =>
    removeBackupTarget(path, targetId)
  )

  ipcMain.handle('backup:now', async (_e, path: string) => {
    const settings = await readBackupSettings(path)
    if (settings.targets.length === 0)
      throw new Error('No backup location has been chosen for this project.')
    const run = await backupToAll(path, settings.targets)
    // Each target carries its own timestamp: the whole point of several is
    // that they fall out of date independently. Only a real mirror advances
    // one — "up to date" keeps the time of the backup that actually holds the
    // work, and unreachable leaves it alone entirely so the panel can show how
    // long a card has been out.
    for (const result of run.results) {
      if (result.status === 'ok' && result.outcome.status === 'backed-up') {
        await updateBackupTarget(path, result.targetId, { lastBackupAt: result.outcome.at })
      }
    }
    return run
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
    await rememberProject(path, data.title)
    return { path, data }
  })

  /**
   * F-43: make a local project from one that already exists on GitHub.
   *
   * The destination is picked here rather than in the renderer, for the same
   * reason restore does it: the native folder picker is the only one that can
   * offer the real filesystem, and it is the moment the writer decides where
   * their novel lives. The clone arrives **already connected** — `mode:
   * 'github'` with its remote set — so it syncs immediately instead of
   * dropping the writer into the sync picker to choose GitHub for a project
   * that plainly came from GitHub.
   */
  ipcMain.handle('project:clone', async (_e, url: string) => {
    const win = focusedWindow()
    if (!win) return null
    const address = (url ?? '').trim()
    if (!address) throw new Error('No address was given.')
    const suggested = basename(address.replace(/\.git$/, '')) || 'novel'
    const destination = await dialog.showSaveDialog(win, {
      title: 'Bring Down As New Project',
      defaultPath: join(app.getPath('documents'), suggested),
      buttonLabel: 'Bring It Down',
      properties: ['createDirectory']
    })
    if (destination.canceled || !destination.filePath) return null
    const path = destination.filePath.endsWith('.wyrm')
      ? destination.filePath
      : `${destination.filePath}.wyrm`

    const data = await cloneProject(path, address, transport)
    await writeSyncProject(path, { mode: 'github' })
    await rememberProject(path, data.title)
    return { path, data }
  })

  ipcMain.handle('github:repos', async () => {
    const token = await getToken()
    if (!token) throw new Error('Sign in with GitHub first.')
    return listUserRepos(token)
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
      clientIdSet: Boolean(clientIdOf(settings.syncClientId)),
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

  // App-level, for when no project is open: bringing one down on a new
  // computer is exactly when the writer needs to sign in first.
  const accountOf = async (): Promise<GithubAccount> => {
    const settings = await readSettings()
    return {
      clientIdSet: Boolean(clientIdOf(settings.syncClientId)),
      login: settings.githubLogin ?? null
    }
  }
  ipcMain.handle('github:account', () => accountOf())
  ipcMain.handle('github:clientId', async (_e, clientId: string) => {
    await writeSettings({ syncClientId: clientId.trim() })
    return accountOf()
  })

  ipcMain.handle('sync:clientId', async (_e, path: string, clientId: string) => {
    await writeSettings({ syncClientId: clientId.trim() })
    return syncStatusOf(path)
  })

  ipcMain.handle('sync:signInStart', async () => {
    const { syncClientId } = await readSettings()
    deviceSession = await startDeviceFlow(clientIdOf(syncClientId))
    return {
      userCode: deviceSession.userCode,
      verificationUri: deviceSession.verificationUri,
      expiresIn: Math.max(0, Math.round((deviceSession.expiresAt - Date.now()) / 1000))
    }
  })

  ipcMain.handle('sync:signInPoll', async () => {
    const { syncClientId } = await readSettings()
    if (!deviceSession) return { state: 'error', detail: 'No sign-in is running.' }
    const result = await pollDeviceFlow(clientIdOf(syncClientId), deviceSession)
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

  ipcMain.handle(
    'compile:export',
    async (
      _e,
      defaultName: string,
      data: string | Uint8Array,
      named?: { title?: unknown; buttonLabel?: unknown }
    ) => {
      const win = focusedWindow()
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        // The map's picture is written through here too; it says so.
        title: typeof named?.title === 'string' ? named.title : 'Compile Manuscript',
        defaultPath: join(app.getPath('documents'), defaultName),
        buttonLabel: typeof named?.buttonLabel === 'string' ? named.buttonLabel : 'Compile'
      })
      if (result.canceled || !result.filePath) return null
      // Compiled output leaves the project entirely — it is a deliverable, not
      // project data, so it is written wherever the writer asks and never
      // touched again.
      if (typeof data === 'string') await fsp.writeFile(result.filePath, data, 'utf8')
      else await fsp.writeFile(result.filePath, Buffer.from(data))
      return result.filePath
    }
  )

  /**
   * F-38: HTML in, PDF bytes out, paginated by Chromium's own print engine
   * against a real paper size — the only page model that matches what comes
   * out of a printer.
   *
   * Rendered in a throwaway offscreen window rather than the writer's own:
   * `printToPDF` paginates whatever that window is currently showing, so
   * reusing the main window would mean navigating the manuscript away from
   * under them. `show: false` keeps it off-screen, and the window is
   * destroyed in a `finally` so a load failure cannot leak a hidden window
   * per export attempt.
   */
  ipcMain.handle('compile:pdf', async (_e, html: string) => {
    const sheet = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, javascript: false }
    })
    try {
      // A data: URL rather than a temp file — nothing to clean up, and the
      // content never touches disk unencrypted on its way to the PDF.
      await sheet.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      // `printBackground` off: manuscript format is black on white, and
      // letting backgrounds through would ink the highlight marks solid.
      return await sheet.webContents.printToPDF({ printBackground: false })
    } finally {
      sheet.destroy()
    }
  })

  /**
   * F-38: the same offscreen-sheet trick as `compile:pdf`, but handed to the
   * OS print dialog instead of a file. `silent: false` is the whole point of
   * this v1 — the writer sees the dialog, picks a printer, and a failure
   * surfaces where they expect it rather than vanishing into a background
   * job. Resolves once the dialog is dismissed either way; `false` means the
   * writer cancelled, which is not an error.
   */
  ipcMain.handle(
    'compile:print',
    async (_e, html: string, options?: { silent?: boolean; deviceName?: string }) => {
      const sheet = new BrowserWindow({
        show: false,
        webPreferences: { offscreen: true, javascript: false }
      })
      try {
        await sheet.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        return await new Promise<boolean>((resolve) => {
          sheet.webContents.print(
            {
              // Silent is only ever used by auto-print (F-38 part 2), which
              // requires a printer chosen in advance — printing silently to
              // whatever the OS considers default is how paper appears from a
              // machine nobody is standing at.
              silent: options?.silent ?? false,
              deviceName: options?.deviceName || undefined,
              printBackground: false
            },
            (success) => resolve(success)
          )
        })
      } finally {
        sheet.destroy()
      }
    }
  )

  ipcMain.handle('print:printers', async () => {
    const printers = await (focusedWindow()?.webContents.getPrintersAsync() ?? [])
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: p.isDefault
    }))
  })

  ipcMain.handle('print:settings:get', () => readPrintSettings())
  ipcMain.handle('print:settings:set', (_e, patch: Partial<PrintSettings>) =>
    writePrintSettings(patch)
  )

  /* ---------- window (F-39) ---------- */

  // Real OS fullscreen, which is what actually covers the Windows taskbar —
  // maximize never does. Returns the resulting state rather than letting the
  // renderer track its own copy, which would drift the moment the window is
  // un-fullscreened by any other route (Esc on macOS, the caption buttons).
  ipcMain.handle('window:toggleFullScreen', () => {
    const win = focusedWindow()
    if (!win) return false
    const next = !win.isFullScreen()
    win.setFullScreen(next)
    return next
  })

  ipcMain.handle('window:titleBarOverlay', (_e, color: string, symbolColor: string) => {
    // Guarded twice over: `setTitleBarOverlay` throws outright on a window
    // that wasn't created with `titleBarOverlay`, which is every window off
    // Windows — an unguarded call would reject into the renderer on macOS
    // and Linux on every palette change.
    if (process.platform !== 'win32') return
    focusedWindow()?.setTitleBarOverlay({
      color,
      symbolColor,
      height: TITLE_BAR_OVERLAY_HEIGHT
    })
  })
}
