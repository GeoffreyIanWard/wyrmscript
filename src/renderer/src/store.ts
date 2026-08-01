import { create } from 'zustand'
import type { Editor } from '@tiptap/core'
import type {
  AppearanceSettings,
  BackupOutcome,
  BackupSettings,
  BinderNode,
  CompileOptions,
  ConflictResolution,
  DeviceCodeInfo,
  SignInPoll,
  SyncConflict,
  SyncOutcome,
  SyncStatus,
  CompileResult,
  DayStat,
  DocFile,
  Entity,
  EntityType,
  Plotline,
  ProjectInfo,
  Relationship,
  StatsSettings
} from '../../shared/types'
import { PLOTLINE_COLOURS } from '../../shared/types'
import { api } from './lib/api'
import { compile, compileFileName } from './lib/compile'
import { docToMarkdown, markdownToDoc, countWords } from './lib/markdown'
import { buildEntityIndex, type EntityIndex } from './lib/entities'
import { refreshEntityLinks } from './lib/entityLinks'
import { findNode, firstDoc, moveNode, removeNode, type DropPosition } from './lib/tree'

export type SaveState = 'saved' | 'dirty' | 'saving'

/** What the main pane is showing: a manuscript document or a bible entry. */
export type MainView = { kind: 'doc' } | { kind: 'entity'; id: string }

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

interface WyrmState {
  project: ProjectInfo | null
  booted: boolean
  activeId: string | null
  activeDoc: DocFile | null
  editor: Editor | null
  saveState: SaveState
  wordCount: number
  lastCommitAt: number | null
  renamingId: string | null

  /** Story bible (brief §5). */
  entities: Entity[]
  entityIndex: EntityIndex
  /** Entity shown in the side panel beside the writing terminal. */
  panelEntityId: string | null
  mainView: MainView

  /** F-04. A scene belongs to one by carrying a tag equal to its name. */
  plotlines: Plotline[]
  /** F-11: character graph edges, typed and directional. */
  relationships: Relationship[]

  boot(): Promise<void>
  newProject(title: string): Promise<void>
  openProject(): Promise<void>
  selectDoc(id: string): Promise<void>
  setEditor(editor: Editor | null): void
  editorChanged(): void
  flushSave(): Promise<void>
  commitNow(message: string): Promise<void>
  /** Restore the active doc to a commit oid or variant branch, as a new commit. */
  restoreActiveDoc(ref: string, label: string): Promise<void>
  createVariant(name: string): Promise<void>
  /**
   * Tags/pins on the active document (F-10). Written immediately rather than
   * riding the prose debounce — metadata isn't keystroke-frequent, and a
   * writer toggling a pin shouldn't wait 800ms to see it land.
   */
  updateDocMeta(patch: { tags?: string[]; pins?: string[] }): Promise<void>
  /**
   * F-02: reposition or label a scene on the timeline. Takes a doc id rather
   * than acting on the active document — the timeline reorders whichever
   * card was dragged, which is rarely the document currently open for
   * writing.
   */
  setTimelineOrder(docId: string, order: number): Promise<void>
  setTimelineDate(docId: string, date: string): Promise<void>
  /** F-03: a scene's tension, set by dragging its node on the plot graph.
   *  Same doc-id-not-active-doc reasoning as setTimelineOrder. */
  setTension(docId: string, tension: number): Promise<void>
  /** Palette, accents and page geometry (F-05, F-06); null until loaded. */
  appearance: AppearanceSettings | null
  loadAppearance(): Promise<void>
  setAppearance(patch: Partial<AppearanceSettings>): Promise<void>

  statsSettings: StatsSettings | null
  dailyStats: DayStat[]
  loadStatsSettings(): Promise<void>
  setStatsSettings(patch: Partial<StatsSettings>): Promise<void>
  refreshStats(): Promise<void>

  /** GitHub sync (Phase 5). */
  syncStatus: SyncStatus | null
  /** Conflicts awaiting the writer — non-null renders the resolution screen. */
  syncConflicts: SyncConflict[] | null
  /** A background sync found conflicts; surfaced quietly, never as a popup. */
  syncNeedsAttention: boolean
  loadSyncStatus(): Promise<void>
  setSyncClientId(clientId: string): Promise<void>
  signInStart(): Promise<DeviceCodeInfo>
  signInPoll(): Promise<SignInPoll>
  signOutGithub(): Promise<void>
  connectSync(options: { create: boolean; name?: string; url?: string }): Promise<void>
  disconnectSync(): Promise<void>
  setLocalOnly(): Promise<void>
  /** interactive: a person asked — conflicts may open the resolution screen. */
  syncNow(interactive?: boolean): Promise<SyncOutcome>
  resolveConflicts(
    choices: { path: string; resolution: ConflictResolution }[]
  ): Promise<SyncOutcome>
  dismissConflicts(): void

  /** Backup configuration for the open project; null until loaded (F-01). */
  backupSettings: BackupSettings | null
  loadBackupSettings(): Promise<void>
  chooseBackupLocation(): Promise<void>
  setBackupAuto(auto: boolean): Promise<void>
  clearBackupLocation(): Promise<void>
  backupNow(): Promise<BackupOutcome>
  /** Restore a backup into a new project and open it. True if one was opened. */
  restoreFromBackup(): Promise<boolean>

  /** Every document keyed by id — the compile dialog's source of truth. */
  loadAllDocs(): Promise<Map<string, DocFile>>
  /** Checkpoint, then compile the manuscript and write it wherever the writer picks. */
  compileManuscript(
    options: CompileOptions
  ): Promise<{ result: CompileResult; path: string | null }>

  addDoc(parentId: string | null): Promise<void>
  addFolder(parentId: string | null): Promise<void>
  startRename(id: string): void
  finishRename(id: string, title: string): Promise<void>
  moveToTrash(id: string): Promise<void>
  restoreFromTrash(id: string): Promise<void>
  moveBinderNode(dragId: string, targetId: string, position: DropPosition): Promise<void>

  loadEntities(): Promise<void>
  /** Create an entry, optionally pre-named from a terminal selection. */
  createEntity(type: EntityType, name: string): Promise<Entity | null>
  saveEntity(entity: Entity): Promise<void>
  deleteEntity(entity: Entity): Promise<void>
  openEntityPanel(id: string | null): void
  showEntity(id: string): void
  showDoc(): void

  loadPlotlines(): Promise<void>
  createPlotline(name: string): Promise<Plotline | null>
  savePlotline(plotline: Plotline): Promise<void>
  deletePlotline(plotline: Plotline): Promise<void>

  loadRelationships(): Promise<void>
  createRelationship(fromId: string, toId: string, label: string): Promise<Relationship | null>
  saveRelationship(relationship: Relationship): Promise<void>
  deleteRelationship(relationship: Relationship): Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let commitTimer: ReturnType<typeof setInterval> | null = null
let commitDirty = false

export const useWyrm = create<WyrmState>((set, get) => {
  async function persistProject(): Promise<void> {
    const { project } = get()
    if (!project) return
    await api.saveProject(project.path, project.data)
    commitDirty = true
  }

  function setProject(project: ProjectInfo | null): void {
    set({ project })
  }

  /** Rebuild the match index and re-scan the open document in one step, so a
   *  newly added entry highlights immediately without a reload (brief §5). */
  function setEntities(entities: Entity[]): void {
    set({ entities, entityIndex: buildEntityIndex(entities) })
    refreshEntityLinks(get().editor)
  }

  /**
   * A sync brought other-device work onto disk underneath the UI: re-read the
   * binder, entities, and the open document, and load the new text into the
   * editor in place (undoable, same as restore).
   */
  async function reloadAfterRemoteChange(): Promise<void> {
    const { project, activeId, editor } = get()
    if (!project) return
    const info = await api.openProjectPath(project.path)
    if (info) setProject(info)
    await get().loadEntities()
    if (!activeId) return
    const doc = await api.readDoc(project.path, activeId).catch(() => null)
    if (doc) {
      set({ activeDoc: doc, wordCount: countWords(doc.body), saveState: 'saved' })
      editor?.commands.setContent(markdownToDoc(doc.body), { emitUpdate: false })
    } else {
      const first = firstDoc((info ?? project).data.binder)
      if (first) await get().selectDoc(first.id)
      else set({ activeId: null, activeDoc: null, wordCount: 0 })
    }
  }

  async function loadProject(info: ProjectInfo): Promise<void> {
    setProject(info)
    set({
      booted: true,
      activeId: null,
      activeDoc: null,
      saveState: 'saved',
      syncStatus: null,
      syncConflicts: null,
      syncNeedsAttention: false
    })
    if (commitTimer) clearInterval(commitTimer)
    commitTimer = setInterval(
      () => {
        if (commitDirty) void get().commitNow('Autosave')
      },
      5 * 60 * 1000
    )
    const first = firstDoc(info.data.binder)
    if (first) await get().selectDoc(first.id)
    await get().loadEntities()
    await get().loadBackupSettings()
    await get().loadSyncStatus()
    void get().refreshStats()
    const log = await api.log(info.path)
    if (log.length > 0) set({ lastCommitAt: log[0].timestamp })
  }

  return {
    project: null,
    booted: false,
    activeId: null,
    activeDoc: null,
    editor: null,
    saveState: 'saved',
    wordCount: 0,
    lastCommitAt: null,
    renamingId: null,
    entities: [],
    entityIndex: buildEntityIndex([]),
    panelEntityId: null,
    mainView: { kind: 'doc' },
    plotlines: [],
    relationships: [],
    backupSettings: null,
    appearance: null,
    statsSettings: null,
    dailyStats: [],
    syncStatus: null,
    syncConflicts: null,
    syncNeedsAttention: false,

    async boot() {
      // Appearance first and independently of any project: the writer's
      // chosen palette should be on screen before anything else renders,
      // and it must survive a boot that finds no project at all.
      await get().loadAppearance()
      await get().loadStatsSettings()
      const last = await api.getLastProjectPath()
      if (last) {
        const info = await api.openProjectPath(last)
        if (info) {
          await loadProject(info)
          return
        }
      }
      set({ booted: true })
    },

    async newProject(title) {
      const info = await api.createProject(title)
      if (info) await loadProject(info)
    },

    async openProject() {
      const info = await api.openProject()
      if (info) await loadProject(info)
    },

    async selectDoc(id) {
      const { project, activeId } = get()
      if (!project) return
      // Picking a document in the binder always brings the manuscript back to
      // the main pane — and this has to happen *before* the same-document
      // guard below, because the commonest way to hit it is clicking back to
      // the document you were already on from a story-bible entry (I-05).
      set({ mainView: { kind: 'doc' } })
      if (id === activeId) return
      await get().flushSave()
      const doc = await api.readDoc(project.path, id)
      // The Editor component recreates its TipTap instance when activeId
      // changes (fresh per-document undo history) and loads the body itself.
      set({ activeId: id, activeDoc: doc, saveState: 'saved', wordCount: countWords(doc.body) })
    },

    setEditor(editor) {
      set({ editor })
    },

    editorChanged() {
      const { editor } = get()
      if (!editor) return
      set({ saveState: 'dirty', wordCount: countWords(editor.getText()) })
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void get().flushSave(), 800)
    },

    async flushSave() {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      const { project, activeDoc, editor, saveState } = get()
      if (!project || !activeDoc || !editor || saveState === 'saved') return
      set({ saveState: 'saving' })
      const body = docToMarkdown(editor.getJSON())
      const doc: DocFile = { ...activeDoc, body }
      await api.writeDoc(project.path, doc)
      commitDirty = true
      set({ saveState: 'saved', activeDoc: doc })
    },

    async commitNow(message) {
      const { project } = get()
      if (!project) return
      await get().flushSave()
      const committed = await api.commit(project.path, message)
      commitDirty = false
      if (committed) {
        set({ lastCommitAt: Date.now() })
        // The checkpoint just became history, which is where the stats live.
        void get().refreshStats()
      }
      // Auto-backup runs after the checkpoint and never blocks it: a missing
      // external drive must not be able to stop the writer saving their work.
      if (committed && get().backupSettings?.auto) {
        void get()
          .backupNow()
          .catch(() => {})
      }
      // Auto-sync likewise: background, quiet, and conflicts never pop UI
      // from here (brief §7 — commits are local-first, the push is best-effort).
      if (committed && get().syncStatus?.mode === 'github') {
        void get()
          .syncNow(false)
          .catch(() => {})
      }
    },

    async restoreActiveDoc(ref, label) {
      const { project, activeId, editor } = get()
      if (!project || !activeId) return
      await get().flushSave()
      const doc = await api.restoreDocToRef(project.path, activeId, ref, label)
      set({
        activeDoc: doc,
        saveState: 'saved',
        wordCount: countWords(doc.body),
        lastCommitAt: Date.now()
      })
      // Same doc id, so the editor isn't recreated — load the restored text
      // in place. It lands on the undo stack, so even the restore is ⌘Z-able.
      editor?.commands.setContent(markdownToDoc(doc.body), { emitUpdate: false })
    },

    async updateDocMeta(patch) {
      const { project, activeDoc } = get()
      if (!project || !activeDoc) return
      const meta = { ...activeDoc.meta }
      // Omit the key entirely rather than writing `tags: undefined` —
      // gray-matter's YAML dumper throws on an explicit undefined value.
      if (patch.tags !== undefined) {
        if (patch.tags.length) meta.tags = patch.tags
        else delete meta.tags
      }
      if (patch.pins !== undefined) {
        if (patch.pins.length) meta.pins = patch.pins
        else delete meta.pins
      }
      const doc: DocFile = { ...activeDoc, meta }
      await api.writeDoc(project.path, doc)
      set({ activeDoc: doc })
      commitDirty = true
    },

    async setTimelineOrder(docId, order) {
      const { project, activeId, activeDoc } = get()
      if (!project) return
      const doc =
        docId === activeId && activeDoc ? activeDoc : await api.readDoc(project.path, docId)
      const updated: DocFile = { ...doc, meta: { ...doc.meta, timelineOrder: order } }
      await api.writeDoc(project.path, updated)
      if (docId === activeId) set({ activeDoc: updated })
      commitDirty = true
    },

    async setTimelineDate(docId, date) {
      const { project, activeId, activeDoc } = get()
      if (!project) return
      const doc =
        docId === activeId && activeDoc ? activeDoc : await api.readDoc(project.path, docId)
      const meta = { ...doc.meta }
      // Same undefined-vs-omitted care as updateDocMeta: clearing the date
      // must delete the key, never set it to an explicit undefined.
      if (date.trim()) meta.timelineDate = date.trim()
      else delete meta.timelineDate
      const updated: DocFile = { ...doc, meta }
      await api.writeDoc(project.path, updated)
      if (docId === activeId) set({ activeDoc: updated })
      commitDirty = true
    },

    async setTension(docId, tension) {
      const { project, activeId, activeDoc } = get()
      if (!project) return
      const doc =
        docId === activeId && activeDoc ? activeDoc : await api.readDoc(project.path, docId)
      const updated: DocFile = { ...doc, meta: { ...doc.meta, tension } }
      await api.writeDoc(project.path, updated)
      if (docId === activeId) set({ activeDoc: updated })
      commitDirty = true
    },

    async createVariant(name) {
      const { project, activeId } = get()
      if (!project || !activeId) return
      await get().flushSave()
      await api.createVariant(project.path, activeId, name)
      commitDirty = false
      set({ lastCommitAt: Date.now() })
    },

    /* ---------- appearance (F-05, F-06) ---------- */

    async loadAppearance() {
      set({ appearance: await api.getAppearance() })
    },

    async setAppearance(patch) {
      // Optimistic: dragging a stepper must feel immediate, and a failed
      // write is a cosmetic setback rather than lost work.
      const current = get().appearance
      if (current) set({ appearance: { ...current, ...patch } })
      set({ appearance: await api.setAppearance(patch) })
    },

    /* ---------- writing stats (4c) ---------- */

    async loadStatsSettings() {
      set({ statsSettings: await api.getStatsSettings() })
    },

    async setStatsSettings(patch) {
      const current = get().statsSettings
      if (current) set({ statsSettings: { ...current, ...patch } })
      set({ statsSettings: await api.setStatsSettings(patch) })
    },

    /** Recomputed from git history rather than accumulated in memory, so it is
     *  correct after a restore, a sync, or anything else that rewrites what
     *  the manuscript contains. Cheap enough to call on every checkpoint. */
    async refreshStats() {
      const { project } = get()
      if (!project) return
      set({ dailyStats: await api.getDailyStats(project.path).catch(() => []) })
    },

    /* ---------- GitHub sync (Phase 5) ---------- */

    async loadSyncStatus() {
      const { project } = get()
      if (!project) return
      set({ syncStatus: await api.getSyncStatus(project.path) })
    },

    async setSyncClientId(clientId) {
      const { project } = get()
      if (!project) return
      set({ syncStatus: await api.setSyncClientId(project.path, clientId) })
    },

    async signInStart() {
      return api.signInStart()
    },

    async signInPoll() {
      const result = await api.signInPoll()
      if (result.state === 'ok') await get().loadSyncStatus()
      return result
    },

    async signOutGithub() {
      const { project } = get()
      if (!project) return
      set({ syncStatus: await api.signOut(project.path) })
    },

    async connectSync(options) {
      const { project } = get()
      if (!project) return
      set({ syncStatus: await api.connectSync(project.path, options) })
    },

    async disconnectSync() {
      const { project } = get()
      if (!project) return
      set({ syncStatus: await api.disconnectSync(project.path), syncNeedsAttention: false })
    },

    async setLocalOnly() {
      const { project } = get()
      if (!project) return
      set({ syncStatus: await api.setLocalOnly(project.path) })
    },

    async syncNow(interactive = true) {
      const { project } = get()
      if (!project) throw new Error('No project is open')
      await get().flushSave()
      const outcome = await api.syncNow(project.path)
      if (outcome.status === 'conflicts') {
        // The page is sacred: only a sync the writer asked for may put a
        // dialog on screen. A background one leaves a quiet flag instead.
        if (interactive) set({ syncConflicts: outcome.conflicts, syncNeedsAttention: false })
        else set({ syncNeedsAttention: true })
      } else {
        set({ syncNeedsAttention: false })
        if (outcome.status === 'pulled' || outcome.status === 'merged') {
          // The manuscript on disk changed underneath the UI — reload.
          await reloadAfterRemoteChange()
        }
      }
      await get().loadSyncStatus()
      return outcome
    },

    async resolveConflicts(choices) {
      const { project } = get()
      if (!project) throw new Error('No project is open')
      const outcome = await api.resolveSyncConflicts(project.path, choices)
      if (outcome.status === 'merged') {
        set({ syncConflicts: null, syncNeedsAttention: false })
        await reloadAfterRemoteChange()
      }
      await get().loadSyncStatus()
      return outcome
    },

    dismissConflicts() {
      // Declining to decide is allowed — nothing has been changed, and the
      // quiet flag keeps the door open for later.
      set({ syncConflicts: null, syncNeedsAttention: true })
    },

    async loadBackupSettings() {
      const { project } = get()
      if (!project) return
      set({ backupSettings: await api.getBackupSettings(project.path) })
    },

    async chooseBackupLocation() {
      const { project } = get()
      if (!project) return
      const settings = await api.chooseBackupLocation(project.path)
      if (settings) set({ backupSettings: settings })
    },

    async setBackupAuto(auto) {
      const { project } = get()
      if (!project) return
      set({ backupSettings: await api.setBackupAuto(project.path, auto) })
    },

    async clearBackupLocation() {
      const { project } = get()
      if (!project) return
      set({ backupSettings: await api.clearBackupLocation(project.path) })
    },

    async backupNow() {
      const { project } = get()
      if (!project) throw new Error('No project is open')
      await get().flushSave()
      const outcome = await api.backupNow(project.path)
      await get().loadBackupSettings()
      return outcome
    },

    async restoreFromBackup() {
      const info = await api.restoreFromBackup()
      if (!info) return false
      await loadProject(info)
      return true
    },

    async loadAllDocs() {
      const { project } = get()
      if (!project) return new Map()
      await get().flushSave()
      const docs = await api.readAllDocs(project.path)
      return new Map(docs.map((doc) => [doc.meta.id, doc]))
    },

    async compileManuscript(options) {
      const { project } = get()
      if (!project) throw new Error('No project is open')
      // Checkpoint first (brief §6): the compiled manuscript must correspond to
      // a state that is recoverable, and re-reading afterwards guarantees the
      // output is exactly what was committed rather than a stale editor buffer.
      await get().flushSave()
      const committed = await api.commit(project.path, 'Auto: before compile')
      commitDirty = false
      if (committed) set({ lastCommitAt: Date.now() })

      const docs = await get().loadAllDocs()
      const result = compile(project.data, docs, options, true)
      const name = compileFileName(project.data.title, result.extension)
      const path = await api.exportFile(name, result.bytes ?? result.text)
      return { result, path }
    },

    async addDoc(parentId) {
      const { project } = get()
      if (!project) return
      const now = new Date().toISOString()
      const meta = {
        id: newId(),
        title: 'Untitled',
        status: 'draft' as const,
        created: now,
        modified: now
      }
      await api.writeDoc(project.path, { meta, body: '' })
      const node: BinderNode = { id: meta.id, type: 'doc', title: meta.title }
      const parent = parentId ? findNode(project.data.binder, parentId) : null
      if (parent && parent.type === 'folder') {
        parent.children = parent.children ?? []
        parent.children.push(node)
      } else {
        project.data.binder.push(node)
      }
      setProject({ ...project })
      await persistProject()
      // Rename mode is set before the doc switch so the recreated editor
      // sees it and leaves focus on the rename field.
      get().startRename(meta.id)
      await get().selectDoc(meta.id)
    },

    async addFolder(parentId) {
      const { project } = get()
      if (!project) return
      const node: BinderNode = { id: newId(), type: 'folder', title: 'New Folder', children: [] }
      const parent = parentId ? findNode(project.data.binder, parentId) : null
      if (parent && parent.type === 'folder') {
        parent.children = parent.children ?? []
        parent.children.push(node)
      } else {
        project.data.binder.push(node)
      }
      setProject({ ...project })
      await persistProject()
      get().startRename(node.id)
    },

    startRename(id) {
      set({ renamingId: id })
    },

    async finishRename(id, title) {
      const { project, activeDoc } = get()
      set({ renamingId: null })
      if (!project) return
      const trimmed = title.trim()
      if (!trimmed) return
      const node = findNode(project.data.binder, id) ?? findNode(project.data.trash, id)
      if (!node || node.title === trimmed) return
      node.title = trimmed
      setProject({ ...project })
      await persistProject()
      if (node.type === 'doc') {
        const doc = id === activeDoc?.meta.id ? activeDoc : await api.readDoc(project.path, id)
        const renamed: DocFile = { ...doc, meta: { ...doc.meta, title: trimmed } }
        await api.writeDoc(project.path, renamed)
        if (id === activeDoc?.meta.id) set({ activeDoc: renamed })
      }
    },

    async moveToTrash(id) {
      const { project, activeId } = get()
      if (!project) return
      const node = removeNode(project.data.binder, id)
      if (!node) return
      project.data.trash.push(node)
      setProject({ ...project })
      await persistProject()
      if (activeId && (activeId === id || Boolean(findNode([node], activeId)))) {
        const next = firstDoc(project.data.binder)
        if (next) await get().selectDoc(next.id)
        else set({ activeId: null, activeDoc: null, wordCount: 0 })
      }
    },

    async restoreFromTrash(id) {
      const { project } = get()
      if (!project) return
      const node = removeNode(project.data.trash, id)
      if (!node) return
      project.data.binder.push(node)
      setProject({ ...project })
      await persistProject()
    },

    async moveBinderNode(dragId, targetId, position) {
      const { project } = get()
      if (!project) return
      if (moveNode(project.data.binder, dragId, targetId, position)) {
        setProject({ ...project })
        await persistProject()
      }
    },

    /* ---------- story bible ---------- */

    async loadEntities() {
      const { project } = get()
      if (!project) return
      const entities = await api.listEntities(project.path)
      setEntities(entities)
    },

    async createEntity(type, name) {
      const { project } = get()
      if (!project) return null
      const now = new Date().toISOString()
      const entity: Entity = {
        id: newId(),
        type,
        name: name.trim() || 'Untitled',
        aliases: [],
        body: '',
        created: now,
        modified: now
      }
      await api.writeEntity(project.path, entity)
      setEntities([...get().entities, entity])
      commitDirty = true
      return entity
    },

    async saveEntity(entity) {
      const { project } = get()
      if (!project) return
      const updated: Entity = { ...entity, modified: new Date().toISOString() }
      await api.writeEntity(project.path, updated)
      setEntities(get().entities.map((e) => (e.id === updated.id ? updated : e)))
      commitDirty = true
    },

    async deleteEntity(entity) {
      const { project, panelEntityId, mainView } = get()
      if (!project) return
      await api.deleteEntity(project.path, entity.type, entity.id)
      setEntities(get().entities.filter((e) => e.id !== entity.id))
      commitDirty = true
      if (panelEntityId === entity.id) set({ panelEntityId: null })
      if (mainView.kind === 'entity' && mainView.id === entity.id)
        set({ mainView: { kind: 'doc' } })
    },

    openEntityPanel(id) {
      set({ panelEntityId: id })
    },

    showEntity(id) {
      // Opening the full entry makes the reference panel redundant — showing the
      // same entry twice side by side just eats the writing pane.
      const { panelEntityId } = get()
      set({
        mainView: { kind: 'entity', id },
        panelEntityId: panelEntityId === id ? null : panelEntityId
      })
    },

    showDoc() {
      set({ mainView: { kind: 'doc' } })
    },

    /* ---------- plotlines (F-04) ---------- */

    async loadPlotlines() {
      const { project } = get()
      if (!project) return
      set({ plotlines: await api.listPlotlines(project.path) })
    },

    async createPlotline(name) {
      const { project } = get()
      if (!project) return null
      const now = new Date().toISOString()
      const plotline: Plotline = {
        id: newId(),
        name: name.trim() || 'Untitled',
        colour: PLOTLINE_COLOURS[get().plotlines.length % PLOTLINE_COLOURS.length],
        status: 'open',
        created: now,
        modified: now
      }
      await api.writePlotline(project.path, plotline)
      set({ plotlines: [...get().plotlines, plotline] })
      commitDirty = true
      return plotline
    },

    async savePlotline(plotline) {
      const { project } = get()
      if (!project) return
      const updated: Plotline = { ...plotline, modified: new Date().toISOString() }
      await api.writePlotline(project.path, updated)
      set({ plotlines: get().plotlines.map((p) => (p.id === updated.id ? updated : p)) })
      commitDirty = true
    },

    async deletePlotline(plotline) {
      const { project } = get()
      if (!project) return
      await api.deletePlotline(project.path, plotline.id)
      set({ plotlines: get().plotlines.filter((p) => p.id !== plotline.id) })
      commitDirty = true
    },

    /* ---------- character graph (F-11) ---------- */

    async loadRelationships() {
      const { project } = get()
      if (!project) return
      set({ relationships: await api.listRelationships(project.path) })
    },

    async createRelationship(fromId, toId, label) {
      const { project } = get()
      if (!project || !label.trim()) return null
      const now = new Date().toISOString()
      const relationship: Relationship = {
        id: newId(),
        fromId,
        toId,
        label: label.trim(),
        created: now,
        modified: now
      }
      await api.writeRelationship(project.path, relationship)
      set({ relationships: [...get().relationships, relationship] })
      commitDirty = true
      return relationship
    },

    async saveRelationship(relationship) {
      const { project } = get()
      if (!project) return
      const updated: Relationship = { ...relationship, modified: new Date().toISOString() }
      await api.writeRelationship(project.path, updated)
      set({
        relationships: get().relationships.map((r) => (r.id === updated.id ? updated : r))
      })
      commitDirty = true
    },

    async deleteRelationship(relationship) {
      const { project } = get()
      if (!project) return
      await api.deleteRelationship(project.path, relationship.id)
      set({ relationships: get().relationships.filter((r) => r.id !== relationship.id) })
      commitDirty = true
    }
  }
})

// Best-effort safety net when the window is closed mid-edit.
window.addEventListener('beforeunload', () => {
  void useWyrm.getState().flushSave()
  void useWyrm.getState().commitNow('Autosave on close')
})

// Offline queueing (brief §7): commits are always local-first; when the
// network returns, anything still waiting goes up quietly.
window.addEventListener('online', () => {
  const state = useWyrm.getState()
  if (state.syncStatus?.mode === 'github' && state.syncStatus.pendingSync) {
    void state.syncNow(false).catch(() => {})
  }
})
