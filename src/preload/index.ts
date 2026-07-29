import { contextBridge, ipcRenderer } from 'electron'
import type { DocFile, ProjectData, WyrmApi } from '../shared/types'

const api: WyrmApi = {
  createProject: (title) => ipcRenderer.invoke('project:create', title),
  openProject: () => ipcRenderer.invoke('project:open'),
  openProjectPath: (path) => ipcRenderer.invoke('project:openPath', path),
  saveProject: (path, data: ProjectData) => ipcRenderer.invoke('project:save', path, data),
  readDoc: (path, id) => ipcRenderer.invoke('doc:read', path, id),
  writeDoc: (path, doc: DocFile) => ipcRenderer.invoke('doc:write', path, doc),
  commit: (path, message) => ipcRenderer.invoke('git:commit', path, message),
  getLastProjectPath: () => ipcRenderer.invoke('settings:lastProject')
}

contextBridge.exposeInMainWorld('wyrm', api)
