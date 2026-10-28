import { contextBridge, ipcRenderer } from 'electron'
import type {
  BoardString,
  BoardSticker,
  DocFile,
  Entity,
  EntityType,
  MapPin,
  MapMark,
  MapShape,
  Plotline,
  ProjectData,
  Relationship,
  WyrmApi
} from '../shared/types'

// Main's quit request is answered at once, before the listener does any
// work: the answer tells main the window is alive and dealing with it, so
// main waits as long as the save and any question to the writer take. With
// no listener there is no answer, and main quits after its grace period.
let quitListener: (() => void) | null = null
ipcRenderer.on('app:quit-requested', () => {
  if (!quitListener) return
  ipcRenderer.send('app:quit-ack')
  quitListener()
})

const api: WyrmApi = {
  createProject: (title) => ipcRenderer.invoke('project:create', title),
  openProject: () => ipcRenderer.invoke('project:open'),
  openProjectPath: (path) => ipcRenderer.invoke('project:openPath', path),
  saveProject: (path, data: ProjectData) => ipcRenderer.invoke('project:save', path, data),
  readDoc: (path, id) => ipcRenderer.invoke('doc:read', path, id),
  writeDoc: (path, doc: DocFile) => ipcRenderer.invoke('doc:write', path, doc),
  commit: (path, message) => ipcRenderer.invoke('git:commit', path, message),
  getLastProjectPath: () => ipcRenderer.invoke('settings:lastProject'),
  getRecentProjects: () => ipcRenderer.invoke('settings:recentProjects'),
  closeProject: () => ipcRenderer.invoke('project:close'),
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
  importPortrait: (path, entityId) => ipcRenderer.invoke('portrait:import', path, entityId),
  readPortrait: (path, entityId) => ipcRenderer.invoke('portrait:read', path, entityId),
  removePortrait: (path, entityId) => ipcRenderer.invoke('portrait:remove', path, entityId),

  listPlotlines: (path) => ipcRenderer.invoke('plotline:list', path),
  writePlotline: (path, plotline: Plotline) => ipcRenderer.invoke('plotline:write', path, plotline),
  deletePlotline: (path, id) => ipcRenderer.invoke('plotline:delete', path, id),

  listRelationships: (path) => ipcRenderer.invoke('relationship:list', path),
  writeRelationship: (path, relationship: Relationship) =>
    ipcRenderer.invoke('relationship:write', path, relationship),
  deleteRelationship: (path, id) => ipcRenderer.invoke('relationship:delete', path, id),

  listMapPins: (path) => ipcRenderer.invoke('mapPin:list', path),
  writeMapPin: (path, pin: MapPin) => ipcRenderer.invoke('mapPin:write', path, pin),
  deleteMapPin: (path, id) => ipcRenderer.invoke('mapPin:delete', path, id),
  listMapShapes: (path) => ipcRenderer.invoke('mapShape:list', path),
  writeMapShape: (path, shape: MapShape) => ipcRenderer.invoke('mapShape:write', path, shape),
  deleteMapShape: (path, id) => ipcRenderer.invoke('mapShape:delete', path, id),
  listMapMarks: (path) => ipcRenderer.invoke('mapMark:list', path),
  writeMapMark: (path, mark: MapMark) => ipcRenderer.invoke('mapMark:write', path, mark),
  deleteMapMark: (path, id) => ipcRenderer.invoke('mapMark:delete', path, id),

  listBoardStrings: (path) => ipcRenderer.invoke('boardString:list', path),
  writeBoardString: (path, s: BoardString) => ipcRenderer.invoke('boardString:write', path, s),
  deleteBoardString: (path, id) => ipcRenderer.invoke('boardString:delete', path, id),
  listBoardStickers: (path) => ipcRenderer.invoke('boardSticker:list', path),
  writeBoardSticker: (path, s: BoardSticker) => ipcRenderer.invoke('boardSticker:write', path, s),
  deleteBoardSticker: (path, id) => ipcRenderer.invoke('boardSticker:delete', path, id),

  exportFile: (defaultName, data, dialog) =>
    ipcRenderer.invoke('compile:export', defaultName, data, dialog),
  renderPdf: (html) => ipcRenderer.invoke('compile:pdf', html),
  printHtml: (html, options) => ipcRenderer.invoke('compile:print', html, options),
  listPrinters: () => ipcRenderer.invoke('print:printers'),
  getPrintSettings: () => ipcRenderer.invoke('print:settings:get'),
  setPrintSettings: (patch) => ipcRenderer.invoke('print:settings:set', patch),

  getAppearance: () => ipcRenderer.invoke('appearance:get'),
  setAppearance: (patch) => ipcRenderer.invoke('appearance:set', patch),

  getStatsSettings: () => ipcRenderer.invoke('stats:settings:get'),
  setStatsSettings: (patch) => ipcRenderer.invoke('stats:settings:set', patch),
  getDailyStats: (path) => ipcRenderer.invoke('stats:daily', path),

  getWindowGeometry: (path) => ipcRenderer.invoke('window:geometry:get', path),
  setWindowGeometry: (path, geometry) => ipcRenderer.invoke('window:geometry:set', path, geometry),
  clearWindowGeometry: (path) => ipcRenderer.invoke('window:geometry:clear', path),
  getBackupSettings: (path) => ipcRenderer.invoke('backup:get', path),
  chooseBackupLocation: (path) => ipcRenderer.invoke('backup:choose', path),
  setBackupAuto: (path, auto) => ipcRenderer.invoke('backup:auto', path, auto),
  removeBackupTarget: (path, targetId) => ipcRenderer.invoke('backup:remove', path, targetId),
  backupNow: (path) => ipcRenderer.invoke('backup:now', path),
  restoreFromBackup: () => ipcRenderer.invoke('backup:restore'),
  listGithubRepos: () => ipcRenderer.invoke('github:repos'),
  getGithubAccount: () => ipcRenderer.invoke('github:account'),
  setGithubClientId: (clientId) => ipcRenderer.invoke('github:clientId', clientId),
  cloneProject: (url: string) => ipcRenderer.invoke('project:clone', url),

  getSyncStatus: (path) => ipcRenderer.invoke('sync:status', path),
  setSyncClientId: (path, clientId) => ipcRenderer.invoke('sync:clientId', path, clientId),
  signInStart: () => ipcRenderer.invoke('sync:signInStart'),
  signInPoll: () => ipcRenderer.invoke('sync:signInPoll'),
  signOut: (path) => ipcRenderer.invoke('sync:signOut', path),
  connectSync: (path, options) => ipcRenderer.invoke('sync:connect', path, options),
  disconnectSync: (path) => ipcRenderer.invoke('sync:disconnect', path),
  setLocalOnly: (path) => ipcRenderer.invoke('sync:localOnly', path),
  syncNow: (path) => ipcRenderer.invoke('sync:now', path),
  resolveSyncConflicts: (path, choices) => ipcRenderer.invoke('sync:resolve', path, choices),

  toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
  setTitleBarOverlay: (color, symbolColor) =>
    ipcRenderer.invoke('window:titleBarOverlay', color, symbolColor),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onQuitRequested: (listener) => {
    quitListener = listener
    return () => {
      if (quitListener === listener) quitListener = null
    }
  },
  onFullScreenChanged: (listener) => {
    const relay = (_e: Electron.IpcRendererEvent, fullScreen: boolean): void => listener(fullScreen)
    ipcRenderer.on('window:fullscreen', relay)
    return () => {
      ipcRenderer.off('window:fullscreen', relay)
    }
  }
}

contextBridge.exposeInMainWorld('wyrm', api)
