import { contextBridge, ipcRenderer } from 'electron'
import type { DocFile, Entity, EntityType, ProjectData, WyrmApi } from '../shared/types'

const api: WyrmApi = {
  createProject: (title) => ipcRenderer.invoke('project:create', title),
  openProject: () => ipcRenderer.invoke('project:open'),
  openProjectPath: (path) => ipcRenderer.invoke('project:openPath', path),
  saveProject: (path, data: ProjectData) => ipcRenderer.invoke('project:save', path, data),
  readDoc: (path, id) => ipcRenderer.invoke('doc:read', path, id),
  writeDoc: (path, doc: DocFile) => ipcRenderer.invoke('doc:write', path, doc),
  commit: (path, message) => ipcRenderer.invoke('git:commit', path, message),
  getLastProjectPath: () => ipcRenderer.invoke('settings:lastProject'),
  log: (path, docId) => ipcRenderer.invoke('git:log', path, docId),
  readDocAtRef: (path, id, ref) => ipcRenderer.invoke('doc:atRef', path, id, ref),
  restoreDocToRef: (path, id, ref, label) =>
    ipcRenderer.invoke('doc:restore', path, id, ref, label),
  createVariant: (path, docId, name) => ipcRenderer.invoke('variant:create', path, docId, name),
  listVariants: (path, docId) => ipcRenderer.invoke('variant:list', path, docId),
  deleteVariant: (path, branch) => ipcRenderer.invoke('variant:delete', path, branch),

  listEntities: (path) => ipcRenderer.invoke('entity:list', path),
  writeEntity: (path, entity: Entity) => ipcRenderer.invoke('entity:write', path, entity),
  deleteEntity: (path, type: EntityType, id) => ipcRenderer.invoke('entity:delete', path, type, id),
  readAllDocs: (path) => ipcRenderer.invoke('doc:readAll', path),

  exportFile: (defaultName, data) => ipcRenderer.invoke('compile:export', defaultName, data),

  getBackupSettings: (path) => ipcRenderer.invoke('backup:get', path),
  chooseBackupLocation: (path) => ipcRenderer.invoke('backup:choose', path),
  setBackupAuto: (path, auto) => ipcRenderer.invoke('backup:auto', path, auto),
  clearBackupLocation: (path) => ipcRenderer.invoke('backup:clear', path),
  backupNow: (path) => ipcRenderer.invoke('backup:now', path),
  restoreFromBackup: () => ipcRenderer.invoke('backup:restore'),

  getSyncStatus: (path) => ipcRenderer.invoke('sync:status', path),
  setSyncClientId: (path, clientId) => ipcRenderer.invoke('sync:clientId', path, clientId),
  signInStart: () => ipcRenderer.invoke('sync:signInStart'),
  signInPoll: () => ipcRenderer.invoke('sync:signInPoll'),
  signOut: (path) => ipcRenderer.invoke('sync:signOut', path),
  connectSync: (path, options) => ipcRenderer.invoke('sync:connect', path, options),
  disconnectSync: (path) => ipcRenderer.invoke('sync:disconnect', path),
  setLocalOnly: (path) => ipcRenderer.invoke('sync:localOnly', path),
  syncNow: (path) => ipcRenderer.invoke('sync:now', path),
  resolveSyncConflicts: (path, choices) => ipcRenderer.invoke('sync:resolve', path, choices)
}

contextBridge.exposeInMainWorld('wyrm', api)
