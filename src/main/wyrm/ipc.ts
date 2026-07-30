import { app, ipcMain, dialog, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
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
import { readSettings, writeSettings } from './settings'

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
}
