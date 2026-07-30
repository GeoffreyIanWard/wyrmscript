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
  readAllDocs: (path) => ipcRenderer.invoke('doc:readAll', path)
}

contextBridge.exposeInMainWorld('wyrm', api)
