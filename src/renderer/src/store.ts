import { create } from 'zustand'
import type { Editor } from '@tiptap/core'
import type {
  AppearanceSettings,
  BackupRun,
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
  EntitySortMode,
  EntityType,
  MapPin,
  Plotline,
  ProjectInfo,
  RecentProject,
  Relationship,
  StatsSettings,
  PrintSettings,
  CompileBlock
} from '../../shared/types'
import { PLOTLINE_COLOURS } from '../../shared/types'
import { api } from './lib/api'
import { compile, compileFileName, renderHtml } from './lib/compile'
import { docToMarkdown, markdownToDoc, countWords } from './lib/markdown'
import { buildEntityIndex, type EntityIndex } from './lib/entities'
import { refreshEntityLinks } from './lib/entityLinks'
import { findNode, firstDoc, moveNode, removeNode, type DropPosition } from './lib/tree'

export type SaveState = 'saved' | 'dirty' | 'saving'

/** What the main pane is showing: a manuscript document, a bible entry, a
 *  folder's contents (F-08), the writing-stats page (F-26), or the tag
 *  browser (F-34). */
export type MainView =
  | { kind: 'doc' }
  | { kind: 'entity'; id: string }
  | { kind: 'folder'; id: string }
  | { kind: 'stats' }
  | { kind: 'tags' }

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * F-41: the fields that belong to one open project, as opposed to the app.
 *
 * This list is the single declaration — `ProjectSlice` is derived from it, so
 * the type and the code that copies a project in and out of focus can never
 * disagree. Everything *not* here is app-level and shared across projects:
 * appearance, stats settings, print settings, typewriter mode, the recents
 * list, `booted`.
 *
 * `editor` is in the slice but is always parked as `null` — the TipTap
 * instance belongs to the mounted component, not to the state, and restoring
 * a destroyed one would be worse than rebuilding it. Per-window editor
 * registration is step 3.
 */
const SLICE_KEYS = [
  'project',
  'activeId',
  'activeDoc',
  'editor',
  'saveState',
  'wordCount',
  'lastCommitAt',
  'renamingId',
  'entities',
  'entityIndex',
  'panelEntityId',
  'mainView',
  'viewHistory',
  'tagFilter',
  'plotlines',
  'relationships',
  'mapPins',
  'backupSettings',
  'dailyStats',
  'syncStatus',
  'syncConflicts',
  'syncNeedsAttention'
] as const

export type ProjectSlice = Pick<WyrmState, (typeof SLICE_KEYS)[number]>

interface WyrmState {
  project: ProjectInfo | null
  booted: boolean
  /**
   * F-41: projects that are open but not focused, by path.
   *
   * The focused project's state is the flat fields on this object — there is
   * exactly one home for each project's data and nothing is mirrored, so no
   * two copies can drift. Focusing swaps: the current flat fields are parked
   * under their path and the target's are lifted out. Every action therefore
   * continues to act on "the" project, which is the focused one, matching the
   * decision that dialogs are app-modal and act on the focused window.
   */
  parked: Record<string, ProjectSlice>
  /** Every open project in window order, the focused one included. */
  openPaths: string[]
  /** Bring an already-open project to the front, parking the current one. */
  focusProject(path: string): Promise<void>
  /** Open a project *alongside* the current one rather than replacing it. */
  openAdditionalProject(path: string): Promise<void>
  activeId: string | null
  activeDoc: DocFile | null
  editor: Editor | null
  saveState: SaveState
  wordCount: number
  lastCommitAt: number | null
  renamingId: string | null
  /** F-37: keeps the active line centered while writing at the document's
   *  true end. Lives here rather than local `App` state, unlike Focus Mode,
   *  because the editor itself (nested well below `App`) needs to read it —
   *  a toggle, not persisted, matching Focus Mode's own "fresh launch always
   *  starts in the normal view" precedent. */
  typewriterMode: boolean
  setTypewriterMode(enabled: boolean): void
  /** F-24: the Welcome/home screen's recents list; loaded whenever no project is open. */
  recentProjects: RecentProject[]
  loadRecentProjects(): Promise<void>
  /**
   * F-24: flush, forget the project, and turn off auto-reopen for next launch.
   * F-41: with a path, closes that project; without, the focused one. Closing
   * the focused project brings another open one forward if there is one.
   */
  closeProject(path?: string): Promise<void>

  /** Story bible (brief §5). */
  entities: Entity[]
  entityIndex: EntityIndex
  /** Entity shown in the side panel beside the writing terminal. */
  panelEntityId: string | null
  mainView: MainView
  /**
   * F-14: where Esc goes back to. Previous `mainView`s, oldest first, pushed
   * on each `showEntity` hop and popped by `goBack`. Deliberately scoped to
   * doc↔entity detours only — `selectDoc` and `showDoc` clear it, so
   * switching scenes in the binder is a fresh start rather than history, and
   * Esc can never yank a writer into a different scene mid-draft.
   */
  viewHistory: MainView[]

  /** F-04. A scene belongs to one by carrying a tag equal to its name. */
  plotlines: Plotline[]
  /** F-11: character graph edges, typed and directional. */
  relationships: Relationship[]
  /** F-12: world map pin placements — a `world` entity with none isn't on the map yet. */
  mapPins: MapPin[]

  boot(): Promise<void>
  newProject(title: string): Promise<void>
  openProject(): Promise<void>
  /** F-24: open a project from the Welcome screen's recents list. */
  openRecentProject(path: string): Promise<void>
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
  /** F-38: auto-print and chosen printer; null until loaded. */
  printSettings: PrintSettings | null
  loadPrintSettings(): Promise<void>
  setPrintSettings(patch: Partial<PrintSettings>): Promise<void>
  /**
   * F-38 part 2: send one finished page to the chosen printer, silently.
   * Never throws into the editor — a printer being offline must not take the
   * writing surface down mid-sentence (house rule: a failure in one panel
   * never takes down the app).
   */
  printPage(blocks: CompileBlock[]): Promise<void>
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
  removeBackupTarget(targetId: string): Promise<void>
  backupNow(): Promise<BackupRun>
  /** Restore a backup into a new project and open it. True if one was opened. */
  restoreFromBackup(): Promise<boolean>

  /** Every document keyed by id — the compile dialog's source of truth. */
  loadAllDocs(): Promise<Map<string, DocFile>>
  /**
   * F-38: checkpoint, then send the manuscript to the OS print dialog.
   * Shares the compile pipeline so what prints is exactly what a PDF export
   * would produce. False means the writer cancelled the dialog.
   */
  printManuscript(options: CompileOptions): Promise<boolean>
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
  /** F-32/F-33: per-collection, persisted with the project. */
  setEntitySort(type: EntityType, mode: EntitySortMode): Promise<void>

  loadEntities(): Promise<void>
  /** Create an entry, optionally pre-named from a terminal selection. */
  createEntity(type: EntityType, name: string): Promise<Entity | null>
  saveEntity(entity: Entity): Promise<void>
  deleteEntity(entity: Entity): Promise<void>
  openEntityPanel(id: string | null): void
  showEntity(id: string): void
  showDoc(): void
  /** F-08: open a folder-view listing in place of the writing terminal. */
  showFolder(id: string): void
  /** F-26: open the writing-stats page in place of the writing terminal. */
  showStats(): void
  /** F-34: open the browse-by-tag page in place of the writing terminal. */
  showTags(): void
  /**
   * F-34: the tag currently being browsed. Lives here rather than inside
   * `TagBrowser` because opening a result unmounts the page — with local
   * state the filter was lost on every Esc back, which breaks the feature's
   * central loop (pick a tag, open something, come back to the same list).
   */
  tagFilter: string | null
  setTagFilter(tag: string | null): void
  /** F-14: pop one step of `viewHistory`. True if it actually went anywhere. */
  goBack(): boolean

  loadPlotlines(): Promise<void>
  createPlotline(name: string): Promise<Plotline | null>
  savePlotline(plotline: Plotline): Promise<void>
  deletePlotline(plotline: Plotline): Promise<void>

  loadRelationships(): Promise<void>
  createRelationship(fromId: string, toId: string, label: string): Promise<Relationship | null>
  saveRelationship(relationship: Relationship): Promise<void>
  deleteRelationship(relationship: Relationship): Promise<void>

  loadMapPins(): Promise<void>
  /** Places a location if it has no pin yet, or moves its existing one — the
   *  same drag/drop operation either way. */
  setMapPin(entityId: string, x: number, y: number): Promise<void>
  removeMapPin(pin: MapPin): Promise<void>
}

/** F-14: how many doc↔entity hops Esc can unwind. */
const VIEW_HISTORY_LIMIT = 20

/**
 * Background work belonging to one open project (F-41).
 *
 * These three were module-level singletons, which was correct only for as long
 * as exactly one project could be open. With a second one they become silent
 * data loss: B's keystroke would clear A's pending 800ms save, so A's flush
 * never fires and its draft sits unwritten; opening B would `clearInterval`
 * A's auto-commit, so A quietly stops checkpointing; and one shared dirty flag
 * means a commit in A marks B's unsaved work as already checkpointed. That
 * last one is the same class of bug `git.ts`'s blob-hash comparison exists to
 * prevent — work that looks saved and is not.
 *
 * Keyed by project path, which is the identity the main process already uses
 * for everything (every IPC handler takes it as its first argument).
 */
interface ProjectRuntime {
  /** Debounced write of the open document. */
  saveTimer: ReturnType<typeof setTimeout> | null
  /** The five-minute Autosave checkpoint. */
  commitTimer: ReturnType<typeof setInterval> | null
  /** Written to disk since the last checkpoint. */
  commitDirty: boolean
}

const runtimes = new Map<string, ProjectRuntime>()

function runtimeFor(path: string): ProjectRuntime {
  let runtime = runtimes.get(path)
  if (!runtime) {
    runtime = { saveTimer: null, commitTimer: null, commitDirty: false }
    runtimes.set(path, runtime)
  }
  return runtime
}

/**
 * Stops a project's background work and forgets it. Every exit path has to
 * call this — a surviving interval would keep committing a project nobody has
 * open, and a surviving entry would leak one object per project ever opened.
 */
function disposeRuntime(path: string): void {
  const runtime = runtimes.get(path)
  if (!runtime) return
  if (runtime.saveTimer) clearTimeout(runtime.saveTimer)
  if (runtime.commitTimer) clearInterval(runtime.commitTimer)
  runtimes.delete(path)
}

/* Test seams. Multiple projects cannot be opened through the UI yet, so the
 * only way to prove that one project's background work is independent of
 * another's is to stand a second runtime up directly. */

export function __runtimeCount(): number {
  return runtimes.size
}

export function __runtimeFor(path: string): ProjectRuntime | undefined {
  return runtimes.get(path)
}

export function __ensureRuntime(path: string): ProjectRuntime {
  return runtimeFor(path)
}

export function __disposeAll(): void {
  for (const path of [...runtimes.keys()]) disposeRuntime(path)
}

/** The per-project fields of a freshly-closed app: no project, nothing open. */
function emptySlice(): ProjectSlice {
  return {
    project: null,
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
    viewHistory: [],
    tagFilter: null,
    plotlines: [],
    relationships: [],
    mapPins: [],
    backupSettings: null,
    dailyStats: [],
    syncStatus: null,
    syncConflicts: null,
    syncNeedsAttention: false
  }
}

/** Lifts one project's fields out of the flat state, to be parked. */
function takeSlice(state: WyrmState): ProjectSlice {
  const slice = {} as Record<string, unknown>
  for (const key of SLICE_KEYS) slice[key] = state[key]
  // Never park a live editor: the instance belongs to the component that
  // mounted it, and by the time this project is focused again that component
  // has unmounted and destroyed it. Restoring the corpse would be worse than
  // rebuilding from `activeDoc`.
  slice.editor = null
  return slice as ProjectSlice
}

export const useWyrm = create<WyrmState>((set, get) => {
  /** Marks the open project as having work not yet checkpointed. Resolves the
   *  project itself so the ~20 call sites stay one-liners. */
  function markDirty(): void {
    const path = get().project?.path
    if (path) runtimeFor(path).commitDirty = true
  }

  function clearDirty(): void {
    const path = get().project?.path
    if (path) runtimeFor(path).commitDirty = false
  }

  async function persistProject(): Promise<void> {
    const { project } = get()
    if (!project) return
    await api.saveProject(project.path, project.data)
    markDirty()
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

  /**
   * Parks the focused project so another can take the flat fields. Returns
   * the parked map to fold into the same `set` as the incoming project, so
   * there is never a render where one project has left and the next has not
   * arrived.
   */
  function parkFocused(): Record<string, ProjectSlice> {
    const state = get()
    const path = state.project?.path
    if (!path) return state.parked
    return { ...state.parked, [path]: takeSlice(state) }
  }

  /**
   * Checkpoints a project that is open but not focused.
   *
   * Nothing to flush: a project's pending save is flushed as it loses focus,
   * and with no window of its own yet it has no editor to have dirtied since.
   * The commit itself is already path-addressed in the main process, so only
   * the bookkeeping needs care — it belongs to the parked slice, not to the
   * flat fields, which hold a different project entirely.
   */
  async function commitParked(path: string): Promise<void> {
    const committed = await api.commit(path, 'Autosave').catch(() => false)
    runtimeFor(path).commitDirty = false
    if (!committed) return
    const parked = get().parked
    const slice = parked[path]
    // It may have been focused or closed while the commit was in flight.
    if (!slice) return
    set({ parked: { ...parked, [path]: { ...slice, lastCommitAt: Date.now() } } })
  }

  async function loadProject(info: ProjectInfo, keepOthersOpen = false): Promise<void> {
    // Saving before the state is swapped away, or the pending edit is lost
    // with the fields it lived in.
    if (keepOthersOpen) await get().flushSave()
    if (!keepOthersOpen) {
      // Replacing rather than adding: everything else really closes, so its
      // background work must stop rather than be silently orphaned.
      for (const path of get().openPaths) {
        if (path !== info.path) disposeRuntime(path)
      }
    }
    const parked = keepOthersOpen ? parkFocused() : {}
    const openPaths = keepOthersOpen
      ? [...get().openPaths.filter((p) => p !== info.path), info.path]
      : [info.path]
    setProject(info)
    set({
      parked,
      openPaths,
      booted: true,
      activeId: null,
      activeDoc: null,
      saveState: 'saved',
      // A different project is a different history — Esc must never walk back
      // into an entry belonging to the project just closed (F-14).
      mainView: { kind: 'doc' },
      viewHistory: [],
      syncStatus: null,
      syncConflicts: null,
      syncNeedsAttention: false
    })
    const runtime = runtimeFor(info.path)
    if (runtime.commitTimer) clearInterval(runtime.commitTimer)
    runtime.commitTimer = setInterval(
      () => {
        if (!runtime.commitDirty) return
        // A project that is open but not focused still has to checkpoint. Its
        // state is parked rather than in the flat fields, so `commitNow` —
        // which acts on the focused project — cannot do it, and skipping it
        // would mean a background project silently never writing history.
        if (get().project?.path === info.path) void get().commitNow('Autosave')
        else void commitParked(info.path)
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
    parked: {},
    openPaths: [],
    activeId: null,
    activeDoc: null,
    editor: null,
    saveState: 'saved',
    wordCount: 0,
    lastCommitAt: null,
    renamingId: null,
    typewriterMode: false,
    recentProjects: [],
    entities: [],
    entityIndex: buildEntityIndex([]),
    panelEntityId: null,
    mainView: { kind: 'doc' },
    viewHistory: [],
    tagFilter: null,
    plotlines: [],
    relationships: [],
    mapPins: [],
    backupSettings: null,
    appearance: null,
    statsSettings: null,
    printSettings: null,
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
      await get().loadPrintSettings()
      const last = await api.getLastProjectPath()
      if (last) {
        const info = await api.openProjectPath(last)
        if (info) {
          await loadProject(info)
          return
        }
      }
      set({ booted: true })
      await get().loadRecentProjects()
    },

    async loadRecentProjects() {
      set({ recentProjects: await api.getRecentProjects() })
    },

    async closeProject(path) {
      const state = get()
      const focused = state.project?.path
      const closing = path ?? focused
      if (!closing) return

      // A project that is merely parked has no unsaved editor state — its
      // pending save was flushed when it lost focus — so only the focused one
      // needs flushing, and only when it is the one going away.
      if (closing === focused) await get().flushSave()

      // Only this project's work stops. A surviving interval would keep
      // checkpointing a project nobody has open.
      disposeRuntime(closing)

      const parked = { ...get().parked }
      delete parked[closing]
      const openPaths = get().openPaths.filter((p) => p !== closing)

      if (closing !== focused) {
        // Closing a background project leaves the focused one untouched.
        set({ parked, openPaths })
        return
      }

      // The focused project is going. Bring the most recently opened of the
      // rest forward rather than dropping the writer to the home screen while
      // they still have projects open.
      const next = openPaths[openPaths.length - 1]
      const incoming = next != null ? parked[next] : undefined
      if (incoming) {
        delete parked[next]
        set({ ...incoming, parked, openPaths })
        await get().loadRecentProjects()
        return
      }

      // Nothing left: this is the last project, so the app really has no
      // project open and next launch should not auto-reopen one.
      await api.closeProject()
      set({ ...emptySlice(), parked, openPaths })
      await get().loadRecentProjects()
    },

    async focusProject(path) {
      const state = get()
      if (state.project?.path === path) return
      const target = state.parked[path]
      if (!target) return
      // Flush first: the pending edit belongs to the project about to be
      // parked, and `takeSlice` would otherwise carry a stale `activeDoc`.
      await get().flushSave()
      const parked = parkFocused()
      delete parked[path]
      set({ ...target, parked })
    },

    async openAdditionalProject(path) {
      // Opening a project that is already open raises it instead of opening a
      // second copy. Two editors on one documents/<id>.md would race autosave
      // and git against the same repository, and nothing serializes that.
      if (get().project?.path === path) return
      if (get().parked[path]) {
        await get().focusProject(path)
        return
      }
      const info = await api.openProjectPath(path)
      if (info) await loadProject(info, true)
    },

    async newProject(title) {
      const info = await api.createProject(title)
      if (info) await loadProject(info)
    },

    async openProject() {
      const info = await api.openProject()
      if (info) await loadProject(info)
    },

    async openRecentProject(path) {
      const info = await api.openProjectPath(path)
      if (info) {
        await loadProject(info)
      } else {
        // Moved or deleted since it was last opened — the main process has
        // already dropped it from recentProjects; catch the renderer up.
        await get().loadRecentProjects()
      }
    },

    async selectDoc(id) {
      const { project, activeId } = get()
      if (!project) return
      // Picking a document in the binder always brings the manuscript back to
      // the main pane — and this has to happen *before* the same-document
      // guard below, because the commonest way to hit it is clicking back to
      // the document you were already on from a story-bible entry (I-05).
      // Choosing a scene also resets Esc's history (F-14): binder navigation
      // is deliberately not part of the back-stack.
      set({ mainView: { kind: 'doc' }, viewHistory: [] })
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

    setTypewriterMode(enabled) {
      set({ typewriterMode: enabled })
    },

    editorChanged() {
      const { editor } = get()
      if (!editor) return
      set({ saveState: 'dirty', wordCount: countWords(editor.getText()) })
      const path = get().project?.path
      if (!path) return
      const runtime = runtimeFor(path)
      if (runtime.saveTimer) clearTimeout(runtime.saveTimer)
      runtime.saveTimer = setTimeout(() => void get().flushSave(), 800)
    },

    async flushSave() {
      const { project, activeDoc, editor, saveState } = get()
      // Clearing the pending save belongs to *this* project's runtime; a
      // shared timer meant a flush in one project cancelled another's.
      if (project) {
        const runtime = runtimeFor(project.path)
        if (runtime.saveTimer) {
          clearTimeout(runtime.saveTimer)
          runtime.saveTimer = null
        }
      }
      if (!project || !activeDoc || !editor || saveState === 'saved') return
      set({ saveState: 'saving' })
      const body = docToMarkdown(editor.getJSON())
      const doc: DocFile = { ...activeDoc, body }
      await api.writeDoc(project.path, doc)
      markDirty()
      set({ saveState: 'saved', activeDoc: doc })
    },

    async commitNow(message) {
      const { project } = get()
      if (!project) return
      await get().flushSave()
      const committed = await api.commit(project.path, message)
      clearDirty()
      if (committed) {
        set({ lastCommitAt: Date.now() })
        // The checkpoint just became history, which is where the stats live.
        void get().refreshStats()
      }
      // Auto-backup runs after the checkpoint and never blocks it: a missing
      // external drive must not be able to stop the writer saving their work.
      // An unreachable target is a skip, not a failure (F-40), so a run where
      // every card is unplugged is still a success as far as this is concerned.
      if (committed && get().backupSettings?.auto && get().backupSettings?.targets.length) {
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
      markDirty()
    },

    async setTimelineOrder(docId, order) {
      const { project, activeId, activeDoc } = get()
      if (!project) return
      const doc =
        docId === activeId && activeDoc ? activeDoc : await api.readDoc(project.path, docId)
      const updated: DocFile = { ...doc, meta: { ...doc.meta, timelineOrder: order } }
      await api.writeDoc(project.path, updated)
      if (docId === activeId) set({ activeDoc: updated })
      markDirty()
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
      markDirty()
    },

    async setTension(docId, tension) {
      const { project, activeId, activeDoc } = get()
      if (!project) return
      const doc =
        docId === activeId && activeDoc ? activeDoc : await api.readDoc(project.path, docId)
      const updated: DocFile = { ...doc, meta: { ...doc.meta, tension } }
      await api.writeDoc(project.path, updated)
      if (docId === activeId) set({ activeDoc: updated })
      markDirty()
    },

    async createVariant(name) {
      const { project, activeId } = get()
      if (!project || !activeId) return
      await get().flushSave()
      await api.createVariant(project.path, activeId, name)
      clearDirty()
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
    async loadPrintSettings() {
      set({ printSettings: await api.getPrintSettings() })
    },

    async setPrintSettings(patch) {
      set({ printSettings: await api.setPrintSettings(patch) })
    },

    async printPage(blocks) {
      const { printSettings } = get()
      if (!printSettings?.autoPrint || !printSettings.printerName) return
      try {
        await api.printHtml(renderHtml(blocks), {
          silent: true,
          deviceName: printSettings.printerName
        })
      } catch {
        // Swallowed on purpose. This fires while the writer is mid-paragraph
        // and there is no safe place to interrupt them; an offline printer is
        // a printer problem, not a reason to break the page.
      }
    },

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
      let outcome: SyncOutcome
      try {
        outcome = await api.syncNow(project.path)
      } catch (err) {
        // A sync that failed must never look like one that worked. Callers
        // fire this with `void` (the menu item, the post-checkpoint auto-sync,
        // the back-online retry), so without this the failure was either an
        // unhandled rejection or swallowed by a bare `.catch`, and the writer
        // was left believing their work had reached GitHub. Raising the quiet
        // flag puts `◆ SYNC — NEEDS YOUR EYE` in the status bar — the existing
        // non-nagging channel — and we still rethrow so an interactive caller
        // can surface the actual error (F-01).
        set({ syncNeedsAttention: true })
        throw err
      }
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

    async removeBackupTarget(targetId) {
      const { project } = get()
      if (!project) return
      set({ backupSettings: await api.removeBackupTarget(project.path, targetId) })
    },

    async backupNow() {
      const { project } = get()
      if (!project) throw new Error('No project is open')
      await get().flushSave()
      const run = await api.backupNow(project.path)
      await get().loadBackupSettings()
      return run
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
      clearDirty()
      if (committed) set({ lastCommitAt: Date.now() })

      const docs = await get().loadAllDocs()
      const result = compile(project.data, docs, options, true)
      const name = compileFileName(project.data.title, result.extension)
      // PDF bytes cannot be built here: pagination is Chromium's job (F-38),
      // which lives in the main process and is async — unlike .docx, whose
      // container `compile` can assemble synchronously.
      let data: string | Uint8Array = result.bytes ?? result.text
      if (options.format === 'pdf') {
        const pdf = await api.renderPdf(renderHtml(result.blocks))
        if (!pdf) throw new Error('PDF export needs the desktop app.')
        data = pdf
      }
      const path = await api.exportFile(name, data)
      return { result, path }
    },

    async printManuscript(options) {
      const { project } = get()
      if (!project) throw new Error('No project is open')
      // Same checkpoint-first discipline as compile (brief §6): what comes
      // off the printer must correspond to a state that can be returned to.
      await get().flushSave()
      const committed = await api.commit(project.path, 'Auto: before print')
      clearDirty()
      if (committed) set({ lastCommitAt: Date.now() })

      const docs = await get().loadAllDocs()
      const result = compile(project.data, docs, options)
      return api.printHtml(renderHtml(result.blocks))
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
      const { project, activeId, mainView } = get()
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
      // F-08: a folder view open on the trashed folder itself (or one of its
      // ancestors, since trashing takes the whole subtree with it) would
      // otherwise keep listing a folder that no longer exists in the binder.
      if (
        mainView.kind === 'folder' &&
        (mainView.id === id || Boolean(findNode([node], mainView.id)))
      ) {
        set({ mainView: { kind: 'doc' } })
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

    async setEntitySort(type, mode) {
      const { project } = get()
      if (!project) return
      project.data.entitySort = { ...project.data.entitySort, [type]: mode }
      setProject({ ...project })
      await persistProject()
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
      markDirty()
      return entity
    },

    async saveEntity(entity) {
      const { project } = get()
      if (!project) return
      const updated: Entity = { ...entity, modified: new Date().toISOString() }
      await api.writeEntity(project.path, updated)
      setEntities(get().entities.map((e) => (e.id === updated.id ? updated : e)))
      markDirty()
    },

    async deleteEntity(entity) {
      const { project, panelEntityId, mainView } = get()
      if (!project) return
      await api.deleteEntity(project.path, entity.type, entity.id)
      setEntities(get().entities.filter((e) => e.id !== entity.id))
      markDirty()
      if (panelEntityId === entity.id) set({ panelEntityId: null })
      if (mainView.kind === 'entity' && mainView.id === entity.id)
        set({ mainView: { kind: 'doc' } })
      // Prune the deleted entry out of Esc's history too (F-14) — otherwise
      // going back lands on an entry that no longer exists, and the editor
      // renders its "this entry no longer exists" state for something the
      // writer never asked to see again.
      set({
        viewHistory: get().viewHistory.filter((v) => v.kind !== 'entity' || v.id !== entity.id)
      })
    },

    openEntityPanel(id) {
      set({ panelEntityId: id })
    },

    showEntity(id) {
      // Opening the full entry makes the reference panel redundant — showing the
      // same entry twice side by side just eats the writing pane.
      const { panelEntityId, mainView, viewHistory } = get()
      // Re-opening the entry already on screen is not a hop, so it must not
      // stack a duplicate that Esc would then have to step through twice.
      if (mainView.kind === 'entity' && mainView.id === id) return
      set({
        mainView: { kind: 'entity', id },
        // Capped: a writer clicking around the bible for an hour should not
        // grow this without bound. Losing the oldest steps is fine — nobody
        // presses Esc thirty times expecting an exact trail.
        viewHistory: [...viewHistory, mainView].slice(-VIEW_HISTORY_LIMIT),
        panelEntityId: panelEntityId === id ? null : panelEntityId
      })
    },

    showDoc() {
      // "Back to Manuscript" is itself an arrival, not a hop: clearing here is
      // what stops Esc from bouncing straight back into the entry the writer
      // just deliberately left.
      set({ mainView: { kind: 'doc' }, viewHistory: [] })
    },

    showFolder(id) {
      // Binder navigation, same as selectDoc/showDoc — an arrival, not a hop
      // Esc should unwind (F-14's scope is doc<->entity detours only).
      set({ mainView: { kind: 'folder', id }, viewHistory: [] })
    },

    showStats() {
      // A detour like showEntity, not an arrival like showDoc/showFolder —
      // opened mid-draft via a hotkey, so Esc should return to exactly what
      // was on screen rather than dumping the writer back at the manuscript.
      const { mainView, viewHistory } = get()
      if (mainView.kind === 'stats') return
      set({
        mainView: { kind: 'stats' },
        viewHistory: [...viewHistory, mainView].slice(-VIEW_HISTORY_LIMIT)
      })
    },

    setTagFilter(tag) {
      set({ tagFilter: tag })
    },

    showTags() {
      // Same detour semantics as showStats: browsing tags is a look-something-
      // up trip away from the page, and Esc should put the writer back exactly
      // where they were — including on a bible entry they came from.
      const { mainView, viewHistory } = get()
      if (mainView.kind === 'tags') return
      set({
        mainView: { kind: 'tags' },
        viewHistory: [...viewHistory, mainView].slice(-VIEW_HISTORY_LIMIT)
      })
    },

    goBack() {
      const { viewHistory } = get()
      if (viewHistory.length === 0) return false
      const previous = viewHistory[viewHistory.length - 1]
      set({ mainView: previous, viewHistory: viewHistory.slice(0, -1) })
      return true
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
      markDirty()
      return plotline
    },

    async savePlotline(plotline) {
      const { project } = get()
      if (!project) return
      const updated: Plotline = { ...plotline, modified: new Date().toISOString() }
      await api.writePlotline(project.path, updated)
      set({ plotlines: get().plotlines.map((p) => (p.id === updated.id ? updated : p)) })
      markDirty()
    },

    async deletePlotline(plotline) {
      const { project } = get()
      if (!project) return
      await api.deletePlotline(project.path, plotline.id)
      set({ plotlines: get().plotlines.filter((p) => p.id !== plotline.id) })
      markDirty()
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
      markDirty()
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
      markDirty()
    },

    async deleteRelationship(relationship) {
      const { project } = get()
      if (!project) return
      await api.deleteRelationship(project.path, relationship.id)
      set({ relationships: get().relationships.filter((r) => r.id !== relationship.id) })
      markDirty()
    },

    /* ---------- world map (F-12) ---------- */

    async loadMapPins() {
      const { project } = get()
      if (!project) return
      set({ mapPins: await api.listMapPins(project.path) })
    },

    async setMapPin(entityId, x, y) {
      const { project } = get()
      if (!project) return
      const existing = get().mapPins.find((p) => p.entityId === entityId)
      const now = new Date().toISOString()
      const pin: MapPin = existing
        ? { ...existing, x, y }
        : { id: newId(), entityId, x, y, created: now, modified: now }
      await api.writeMapPin(project.path, pin)
      set({
        mapPins: existing
          ? get().mapPins.map((p) => (p.id === pin.id ? pin : p))
          : [...get().mapPins, pin]
      })
      markDirty()
    },

    async removeMapPin(pin) {
      const { project } = get()
      if (!project) return
      await api.deleteMapPin(project.path, pin.id)
      set({ mapPins: get().mapPins.filter((p) => p.id !== pin.id) })
      markDirty()
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
