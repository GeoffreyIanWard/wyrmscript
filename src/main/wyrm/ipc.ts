import { app, ipcMain, dialog, BrowserWindow } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { join, basename } from 'node:path'
import type { DocFile, Entity, EntityType, ProjectData } from '../../shared/types'
import { commitAll, createVariant, deleteVariant, listVariants, logCommits } from './git'
import { deleteEntity, listEntities, readAllDocs, writeEntity } from './entities'
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
import { readBackupSettings, readSettings, writeBackupSettings, writeSettings } from './settings'
import { backupNameFor, backupProject, restoreBackup } from './backup'

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
      title: 'New Wyrmscript Project',
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
      title: 'Open Wyrmscript Project',
      properties: ['openDirectory'],
      buttonLabel: 'Open'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    if (!existsSync(join(path, 'project.json'))) {
      dialog.showErrorBox('Not a Wyrmscript project', 'The selected folder has no project.json.')
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
      dialog.showErrorBox('Not a Wyrmscript backup', 'That folder is not a backup repository.')
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
