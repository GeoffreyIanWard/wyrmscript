import { create } from 'zustand'
import type { Editor } from '@tiptap/core'
import type {
  ProjectData,
  BoardSticker,
  StickerKind,
  StringColour,
  MapScale,
  MapBounds,
  DocMeta,
  AppearanceSettings,
  BackupRun,
  BackupSettings,
  BinderNode,
  BoardString,
  StringEnd,
  CompileMap,
  CompileOptions,
  ConflictResolution,
  SyncConflict,
  SyncOutcome,
  WindowGeometry,
  SyncStatus,
  CompileResult,
  DayStat,
  DocFile,
  Entity,
  EntitySortMode,
  EntityType,
  MapPin,
  MapMark,
  MapMarkKind,
  MapStampKind,
  MapShape,
  MapShapeKind,
  Plotline,
  ProjectInfo,
  RecentProject,
  Relationship,
  StatsSettings,
  PrintSettings,
  CompileBlock
} from '../../shared/types'
import {
  MAP_STAMP_KINDS,
  MARK_SIZES,
  markSizeOf,
  minShapePoints,
  PLOTLINE_COLOURS,
  SCENE_TAG,
  colourOf,
  storedColour,
  storedMapId,
  WORLD_MAP
} from '../../shared/types'
import { api, apiSettled } from './lib/api'
import { isConnected } from './lib/syncState'
import { errorMessage } from './lib/errors'
import { compile, compileFileName, PAGED_FORMATS, renderHtml } from './lib/compile'
import { validScale } from './lib/mapScale'
import {
  hasSheet,
  mapNameProblem,
  recordsOn,
  sheetOf,
  sheetsOf,
  withNewSheet,
  withoutSheet,
  withSheet
} from './lib/mapSheets'
import {
  mapHasDrawing,
  mapPicturePng,
  mapPictureSvg,
  pngSize,
  type MapPicture,
  type MapPictureOptions
} from './lib/mapPicture'
import { docToMarkdown, markdownToDoc, countWords } from './lib/markdown'
import { buildEntityIndex, type EntityIndex } from './lib/entities'
import { refreshEntityLinks } from './lib/entityLinks'
import { findNode, firstDoc, moveNode, removeNode, type DropPosition } from './lib/tree'
import { withPatch, type BackPatch } from './lib/cardBack'

/** F-50: why a sync could not reach GitHub, or null when it did. */
export function syncProblemOf(outcome: SyncOutcome): string | null {
  if (outcome.status === 'offline') return 'GitHub unreachable'
  if (outcome.status === 'error') return outcome.detail
  return null
}

/** F-50: what Save Now did at each kind of location. Null where there was none. */
export interface SaveEverywhere {
  backup: BackupRun | { error: string } | null
  sync: SyncOutcome | null
}

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
  | {
      /** F-12: the world map, full-window. Scroll and zoom are carried only
       *  on the copy remembered in `viewHistory`, so coming back from a place
       *  opened on the map lands where the map was. */
      kind: 'map'
      /** The map it was looking at, so coming back is to that map. */
      mapId?: string
      zoom?: number
      scrollLeft?: number
      scrollTop?: number
      focusPin?: string
    }
  | {
      kind: 'corkboard'
      /**
       * Where to pick up when coming back: the card a scene or entry was
       * opened from, and how far down the board was scrolled. Set only on
       * the board view remembered in `viewHistory`, so Esc from the scene
       * lands on the same card rather than the top of a fresh board.
       */
      cardId?: string
      scrollTop?: number
      /** Whether the board was stacked, and which cards had been pulled out
       *  of their piles — the layout `scrollTop` was measured in. */
      stacked?: boolean
      pulled?: string[]
    }

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function roundPoints(points: { x: number; y: number }[]): { x: number; y: number }[] {
  return points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
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
 *
 * Exported for one test only: nothing typechecks a per-project field left
 * out of this list, and one that is left out leaks between open projects.
 */
/**
 * What Apply Order changed and what it was before: one entry per folder it
 * reordered, with that folder's scenes in their pre-apply order. Only the
 * folders that changed, so Undo restores exactly those and nothing else.
 */
export type BoardUndo = { parentId: string; ids: string[] }[]
/** A card and where it sits, for `applyBoardOrder` to write. */
export type CardPin = { id: string; x: number; y: number }

export const SLICE_KEYS = [
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
  'mapShapes',
  'mapMarks',
  'mapId',
  'boardStrings',
  'boardStickers',
  'boardUndo',
  'backupSettings',
  'dailyStats',
  'syncStatus',
  'syncConflicts',
  'syncNeedsAttention',
  'syncProblem',
  'stale'
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
  /**
   * Every open project in **stacking** order, the focused one last and so in
   * front. Position is explicit now (see `windowGeometry`), so reordering
   * this no longer moves any window — which is what lets focusing raise a
   * window without shuffling the others around the desktop.
   */
  openPaths: string[]
  /**
   * F-41 step 6: projects collapsed to an icon on the desktop, by path.
   *
   * Still open — their state is parked and their background work still runs —
   * just not drawn as a window. Deliberately **not persisted**, unlike window
   * positions: minimising is a "get this out of my way for now" gesture, and
   * reopening the app to find a novel reduced to an icon would be a surprise
   * rather than a convenience.
   */
  minimized: string[]
  /** Collapse a project to a desktop icon. */
  minimizeProject(path: string): Promise<void>
  /** Bring a minimised project back as the focused window. */
  restoreProject(path: string): Promise<void>
  /**
   * F-41 step 4: where each window sits, by project path.
   *
   * Outside the parked slice on purpose. Every open window is rendered at
   * once, so its position has to be readable whether or not it is focused —
   * and a slice is only readable after it has been swapped in.
   */
  windowGeometry: Record<string, WindowGeometry>
  /** Live update while dragging or resizing; does not touch disk. */
  moveWindow(path: string, geometry: WindowGeometry): void
  /**
   * Forgets every window position, so App lays them out fresh.
   *
   * The guaranteed way back from a window the writer cannot reach. Clamping
   * should prevent that, but "should" is not good enough when the failure
   * mode is a novel you can see and cannot click — this needs no diagnosis of
   * how the window got there.
   */
  cleanUpWindows(): Promise<void>
  /** Called once when a drag or resize ends, to remember the position. */
  persistWindow(path: string): Promise<void>
  /** Bring an already-open project to the front, parking the current one. */
  focusProject(path: string): Promise<void>
  /** Open a project *alongside* the current one rather than replacing it. */
  openAdditionalProject(path: string): Promise<void>
  /** Ask for a project with the native picker and open it in its own window. */
  openAnotherProject(): Promise<void>
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
  /**
   * Quit WyrmStar: the page saved, every open project with work since its
   * last checkpoint checkpointed, then the app goes. The projects stay open
   * as far as the next launch is concerned, as they always have. A page
   * that cannot be saved asks first, and the writer may stay.
   */
  quit(): Promise<void>

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
  /** F-12: land, areas and borders drawn on the world map. */
  mapShapes: MapShape[]
  mapMarks: MapMark[]
  /** F-46: red strings between corkboard cards. */
  boardStrings: BoardString[]
  /** The corkboard's stickers (F-45), on the cork or on cards. */
  boardStickers: BoardSticker[]

  boot(): Promise<void>
  newProject(title: string): Promise<void>
  openProject(): Promise<void>
  /** F-24: open a project from the Welcome screen's recents list. */
  openRecentProject(path: string): Promise<void>
  /**
   * Open a document in the manuscript view. An arrival: Esc's history is
   * cleared — unless `returnTo` is given, in which case it becomes the one
   * step Esc goes back to. The corkboard passes itself, so a scene opened
   * from a card is a detour from the board rather than a departure.
   */
  selectDoc(id: string, returnTo?: MainView): Promise<void>
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
  /** Where a scene's card sits on the corkboard (free placement). */
  setCardPosition(docId: string, x: number, y: number): Promise<void>
  /**
   * Clear every stored card position — scenes and bible entries alike —
   * returning the board to binder order. Entries keep their place *on* the
   * board: Tidy is about where cards sit, not which cards there are.
   */
  tidyBoard(): Promise<void>
  /**
   * F-45: characters and locations on the board, by explicit membership —
   * an entry has a card iff `onBoard` is true. Deliberate, like the World
   * Map's "Place on Map", rather than automatic like scenes, so a big story
   * bible does not flood the board.
   */
  addEntityToBoard(entityId: string): Promise<void>
  /** Take the card off the board; the entry itself stays in the bible. */
  removeEntityFromBoard(entityId: string): Promise<void>
  /** Where an entry's card sits — the entity-side twin of `setCardPosition`. */
  setEntityPosition(entityId: string, x: number, y: number): Promise<void>
  setTimelineOrder(docId: string, order: number): Promise<void>
  setTimelineDate(docId: string, date: string): Promise<void>
  /** F-03: a scene's tension, set by dragging its node on the plot graph.
   *  Same doc-id-not-active-doc reasoning as setTimelineOrder. */
  setTension(docId: string, tension: number): Promise<void>
  /**
   * F-42: write the fields of a scene card's back that the writer changed,
   * over the document as it is now — so a field another device synced in
   * meanwhile survives an edit to a different one. Addressed by project
   * path, never "the project in front": the card back saves as it is torn
   * down, and by then another novel (perhaps a clone sharing these ids)
   * may be in front. Resolves the document as written.
   */
  setCardBack(path: string, docId: string, patch: BackPatch): Promise<DocFile>
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
  /**
   * F-50: why the last sync could not reach GitHub, in the writer's words, or
   * null after one that did. Separate from `syncNeedsAttention`, which also
   * means conflicts: "GitHub unreachable" must not be said about passages
   * waiting to be resolved, and an offline sync returns an outcome rather
   * than throwing, so the flag alone never saw it.
   */
  syncProblem: string | null
  /**
   * F-41: this project's files changed on disk under a background sync, so
   * the state held for it no longer matches them.
   *
   * Only ever true for a parked project. A background sync can *pull*, and a
   * parked slice still holds the binder and open document from before that —
   * so focusing it and typing would write stale text over work that had just
   * arrived from another device. Cleared by re-reading from disk when the
   * project comes forward, which is the one moment it matters.
   */
  stale: boolean
  loadSyncStatus(): Promise<void>
  setSyncClientId(clientId: string): Promise<void>
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
  /**
   * F-50: the drawer's Save Now — a save point, then a copy to every disk
   * location and GitHub. Each part runs even if another fails, and reports
   * separately, because the locations fall out of date independently.
   */
  saveEverywhere(): Promise<SaveEverywhere>
  /** F-50: store the drawer's card order (location ids, default first). */
  setSaveOrder(order: string[]): Promise<void>
  /** Restore a backup into a new project and open it. True if one was opened. */
  restoreFromBackup(): Promise<boolean>
  /** F-43: make a local project from one on GitHub and open it. */
  cloneFromGithub(url: string): Promise<boolean>

  /** Every document keyed by id — the compile dialog's source of truth. */
  loadAllDocs(): Promise<Map<string, DocFile>>
  /**
   * F-38: checkpoint, then send the manuscript to the OS print dialog.
   * Shares the compile pipeline so what prints is exactly what a PDF export
   * would produce. False means the writer cancelled the dialog.
   */
  printManuscript(options: CompileOptions): Promise<boolean>
  /**
   * F-12: the focused project's map as a picture for the book, read from
   * disk rather than from the map's loaded layers (Compile can run without
   * the map ever having been opened). Places whose entry has gone from the
   * World Book are left out: the book has no "(deleted)". Null when nothing
   * is drawn, or no project is open.
   */
  mapPicture(options: MapPictureOptions, mapId?: string): Promise<MapPicture | null>
  /**
   * Write the map's picture wherever the writer picks, as PNG (drawn at
   * print size) or SVG. Resolves to the path written, or null if they
   * cancelled — or if there was nothing to draw.
   */
  exportMapImage(
    format: 'png' | 'svg',
    options: MapPictureOptions,
    mapId?: string
  ): Promise<string | null>
  /** Checkpoint, then compile the manuscript and write it wherever the writer picks. */
  compileManuscript(
    options: CompileOptions
  ): Promise<{ result: CompileResult; path: string | null }>

  addDoc(parentId: string | null): Promise<void>
  /**
   * F-45: a new scene made from the corkboard. `addDoc` without the doc
   * switch and the rename mode — the board stays up, since switching to the
   * manuscript would yank the writer off the view they were working from,
   * and the rename field lives in the binder, which is hidden while the
   * board is up. Born tagged as a scene (which is what puts it on the board)
   * at the end of the Manuscript folder. Resolves to the new id, or null
   * with no project open.
   */
  addSceneDoc(title: string): Promise<string | null>
  addFolder(parentId: string | null): Promise<void>
  startRename(id: string): void
  finishRename(id: string, title: string): Promise<void>
  moveToTrash(id: string): Promise<void>
  restoreFromTrash(id: string): Promise<void>
  moveBinderNode(dragId: string, targetId: string, position: DropPosition): Promise<void>
  /**
   * F-45: write the board's arrangement back into the binder. Dragging a card
   * places it and nothing else, so this is the one deliberate step by which
   * the board becomes the book's order. `orderedIds` is the scenes' reading
   * order as the board computes it (`boardOrder`). Within each folder, the
   * docs named are re-dealt into the slots they already occupy, in that
   * order; everything else — sub-folders, notes, docs the board does not
   * show — keeps its exact index. A doc never changes parent: the board does
   * not show chapter structure, and silently carrying a scene into another
   * chapter is not something arranging cards asked for. Ids no binder node
   * carries are ignored (a card can outlive its node within one session; the
   * trash is not searched). Resolves null, having written nothing, when the
   * binder is already in that order — the button disables on that, and a
   * no-op save would still mark the project dirty for the next checkpoint.
   *
   * `pins` are written after the binder, to the same project: Apply pins
   * every unmoved scene where it sat, so the board keeps reading in the
   * order just applied. One call for the whole operation rather than one
   * per card, because the save is an await a writer can click another
   * window across, and anything that read `project` afresh after it would
   * follow that click into the wrong novel — which, for a clone or a
   * restored backup sharing this project's ids, means writing the other
   * novel's open document into this one's file.
   */
  applyBoardOrder(orderedIds: string[], pins?: CardPin[]): Promise<BoardUndo | null>
  /**
   * The way back from Apply Order: the scenes' order as it was before the
   * last Apply, or null when there is nothing to undo. **An order, not a
   * snapshot of the binder.** Undo re-applies it through `applyBoardOrder`,
   * which only reorders the listed scenes within whatever folder each is in
   * now — so a scene added, renamed or trashed in between, or a chapter
   * another device synced in, is left exactly as it is. A snapshot put back
   * wholesale dropped every one of those, and a document in neither binder
   * nor trash is a document lost. Per project (`SLICE_KEYS`), so it survives
   * leaving the board to look at what Apply did, which is the first thing a
   * writer does.
   */
  boardUndo: BoardUndo | null
  setBoardUndo(undo: BoardUndo | null): void
  /**
   * Put back the order of every folder the last Apply changed — only those
   * folders, and within each only the scenes still in it. A folder the
   * writer reordered by hand since, or another device synced in, was not
   * part of the Apply and is not part of its undo; a scene moved to another
   * folder since stays where it was put. Then forget it.
   */
  undoBoardOrder(): Promise<void>
  /** F-32/F-33: per-collection, persisted with the project. */
  setEntitySort(type: EntityType, mode: EntitySortMode): Promise<void>

  loadEntities(): Promise<void>
  /**
   * Create an entry, optionally pre-named from a terminal selection. `extra`
   * is folded in before the write, so an entry made from the board is born
   * with `onBoard` in one write rather than a create and then a save.
   */
  createEntity(type: EntityType, name: string, extra?: Partial<Entity>): Promise<Entity | null>
  saveEntity(entity: Entity): Promise<void>
  deleteEntity(entity: Entity): Promise<void>
  /**
   * F-47: pick an image for an entry and record it on the entry. False means
   * the writer closed the picker — nothing was copied and nothing written,
   * so an entry does not end up pointing at an image that is not there.
   */
  setPortrait(entityId: string): Promise<boolean>
  /** F-47: delete the image and the entry's record of it. */
  clearPortrait(entityId: string): Promise<void>
  openEntityPanel(id: string | null): void
  /** Open an entry. A detour: Esc comes back to `from`, or to what was on
   *  screen — `from` lets the board remember which card it came from. */
  showEntity(id: string, from?: MainView): void
  showDoc(): void
  /** F-08: open a folder-view listing in place of the writing terminal. */
  showFolder(id: string): void
  /** F-26: open the writing-stats page in place of the writing terminal. */
  showStats(): void
  /** The corkboard: every scene as an index card, in binder order. */
  showCorkboard(): void
  /** F-12: the world map, full-window. A detour: Esc goes back. */
  showMap(): void
  /** The map has used the place it was told to come back to; drop it. */
  settleMapReturn(): void
  /** F-12: the extent of the map in view (`mapId`), saved with the project. */
  setMapBounds(bounds: MapBounds): Promise<void>
  /** F-12: the scale of the map in view, or null to take it off. */
  setMapScale(scale: MapScale | null): Promise<void>
  /**
   * F-12: the map in view — the tab chosen along the top of the map view.
   * Per project (in `SLICE_KEYS`), so each novel keeps its own tab. What is
   * drawn, placed or measured goes on this map. World until another is
   * chosen, and World again for an id no map has.
   */
  mapId: string
  chooseMap(id: string): void
  /** Show a map: choose its tab and open the map view — from a minimap card,
   *  a detour like any card's: Esc comes back to `from`. */
  showMapSheet(id: string, from?: MainView): void
  /** A new map at the end of the tabs, chosen. Resolves to its id, or null
   *  (nothing made) with no project open or a name that will not do. */
  addMap(name: string): Promise<string | null>
  /** Rename a map. Resolves to what is wrong with the name (and changes
   *  nothing), or null once renamed. */
  renameMap(id: string, name: string): Promise<string | null>
  /**
   * Take everything off one map — its pins, shapes and marks — after a
   * checkpoint, so it can be got back. The map itself stays, with its
   * extent and scale, and the places stay in the World Book. Addressed by
   * path, like every map write: the removals land in the project the map
   * was in, whichever is in front by the time they do.
   */
  clearMap(path: string, id: string): Promise<void>
  /** Delete a map and everything on it, after a checkpoint. World cannot be
   *  deleted (it is cleared instead); the view goes back to World. */
  deleteMap(path: string, id: string): Promise<void>
  /** Put a map on the corkboard as a minimap card, or take it off. */
  setMapOnBoard(id: string, on: boolean): Promise<void>
  /** Where a minimap card was put on the board; null clears it (Tidy). */
  placeMapCard(id: string, at: { x: number; y: number } | null): Promise<void>
  /**
   * Add Card is open for this project — kept in the store, not the board,
   * so the menu, the command palette and ⌥⌘N can open it from anywhere. The
   * board shows it only while this is the project in front, so a change of
   * focus dismisses it rather than letting it add to another novel.
   */
  addCardFor: string | null
  /** Show the board, with Add Card open on it. */
  openAddCard(): void
  closeAddCard(): void
  /** Switch between the corkboard and the manuscript (⌥⌘B). */
  toggleCorkboard(): void
  /**
   * Guided help: hovering a marked control explains it (F-44).
   *
   * App state rather than a persisted setting — it is a thing you turn on to
   * ask a question, not a preference. It does not belong to a project
   * either, so it stays out of `SLICE_KEYS`: the explanations are the same
   * whichever novel is in front.
   */
  helpMode: boolean
  setHelpMode(on: boolean): void
  /**
   * Quitting: the window shows only that it is saving, so every part of the
   * UI closes — and saves as it does when it closes — before the app goes
   * (F-49). App state, not a project's.
   */
  quittingUi: boolean
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
  /**
   * The board has used the card and scroll it was told to come back to:
   * drop them from the view, so they are a one-off. Left in place, every
   * later remount of the board — after Writing Stats, after another
   * project's window was in front — snapped back to that old card.
   */
  settleBoardReturn(): void
  /** F-14: pop one step of `viewHistory`. True if it actually went anywhere. */
  goBack(): boolean

  loadPlotlines(): Promise<void>
  createPlotline(name: string): Promise<Plotline | null>
  savePlotline(plotline: Plotline): Promise<void>
  deletePlotline(plotline: Plotline): Promise<void>

  loadRelationships(): Promise<void>
  createRelationship(
    fromId: string,
    toId: string,
    label: string,
    colour?: StringColour
  ): Promise<Relationship | null>
  saveRelationship(relationship: Relationship): Promise<void>
  deleteRelationship(relationship: Relationship): Promise<void>

  loadMapPins(): Promise<void>
  /** Places a location if it has no pin yet, or moves its existing one — the
   *  same drag/drop operation either way. */
  setMapPin(entityId: string, x: number, y: number): Promise<void>
  /**
   * Move a pin that is already on the map, in the project at `path` whether
   * or not it is still in front. A nudge is written after the keys stop, and
   * that can be after a focus change: resolved against "the project in
   * front" it wrote a new pin into another novel (or, in a clone sharing
   * ids, moved that novel's pin). A pin removed in the meantime is not
   * brought back — a move never creates one.
   */
  moveMapPinAt(path: string, pinId: string, x: number, y: number): Promise<void>
  /**
   * Restyle a pin already on the map, addressed by path like `moveMapPinAt`
   * and serialized with it per pin. `stamp: null` turns it back into a pin
   * (stamp and size both cleared); a valid stamp draws the place as that
   * stamp; a size in `MARK_SIZES` sets it (1 clears it), and is ignored on a
   * pin with no stamp. Anything invalid is ignored; nothing changed, nothing
   * written.
   */
  styleMapPinAt(
    path: string,
    pinId: string,
    style: { stamp?: MapStampKind | null; size?: number }
  ): Promise<void>
  removeMapPin(pin: MapPin): Promise<void>

  loadMapShapes(): Promise<void>
  /**
   * Null, and nothing written, with no project open or too few points for
   * the kind (land and areas need three, a border two). Points are rounded
   * to whole map pixels.
   */
  createMapShape(kind: MapShapeKind, points: { x: number; y: number }[]): Promise<MapShape | null>
  /**
   * Replace a shape's points, in the project at `path` whether or not it is
   * still in front — the same reason as `moveMapPinAt`: an edit can be
   * written after a focus change, and resolved against "the project in
   * front" it would land in another novel (or, in a clone sharing ids,
   * reshape that novel's shape). A shape removed in the meantime is not
   * brought back, and too few points for the kind writes nothing.
   */
  updateMapShapeAt(path: string, id: string, points: { x: number; y: number }[]): Promise<void>
  deleteMapShape(shape: MapShape): Promise<void>
  /**
   * Name (or clear) a drawn shape, in the project at `path` — path-addressed
   * like `updateMapShapeAt`, for the same reason. The name is trimmed; empty
   * removes it. A shape removed in the meantime is not brought back, and a
   * name that changes nothing writes nothing.
   */
  renameMapShapeAt(path: string, id: string, name: string): Promise<void>

  loadMapMarks(): Promise<void>
  /**
   * Stamp or label the map at (x, y), rounded to whole map pixels. The name
   * is trimmed: a label needs one (empty gives null and writes nothing), a
   * stamp's is optional and omitted when empty. Null with no project open.
   */
  createMapMark(
    kind: MapMarkKind,
    x: number,
    y: number,
    name?: string,
    size?: number
  ): Promise<MapMark | null>
  /**
   * `createMapMark` addressed by path: the mark is written to `path` and,
   * once the write lands, added to whichever slice holds that project now
   * (the flat fields or its parked slice), never the one that happens to be in
   * front. Null when `path` is not open at call time.
   */
  createMapMarkAt(
    path: string,
    kind: MapMarkKind,
    x: number,
    y: number,
    name?: string,
    size?: number
  ): Promise<MapMark | null>
  /**
   * Move, rename and/or resize a mark, in the project at `path` whether or not it is
   * still in front (the same reason as `updateMapShapeAt`). A mark removed
   * in the meantime is not brought back. x/y are rounded; the name is
   * trimmed, and an empty one removes a stamp's name but is refused for a
   * label (which would be left with no text). A size in `MARK_SIZES` is set,
   * 1 removes the key, anything else is ignored. Nothing is written when
   * nothing changed.
   */
  updateMapMarkAt(
    path: string,
    id: string,
    patch: { x?: number; y?: number; name?: string; size?: number }
  ): Promise<void>
  deleteMapMark(mark: MapMark): Promise<void>

  loadBoardStrings(): Promise<void>
  /**
   * Null, and nothing written, when both ends are on the same card: a string
   * from a card to itself is meaningless and would draw as a dot. A string
   * whose card is later deleted is tolerated and hidden by the view, not
   * cascaded here.
   */
  createBoardString(
    from: StringEnd,
    to: StringEnd,
    label?: string,
    colour?: StringColour
  ): Promise<BoardString | null>
  /** A string's colour changed; nothing written when it is already that colour. */
  recolourBoardString(id: string, colour: StringColour): Promise<void>
  loadBoardStickers(): Promise<void>
  /**
   * Stick a sticker down: on a card (`cardId`, with `x`/`y` its offset from
   * the card's corner) or on the cork (board coordinates). It lands with a
   * small tilt and a pixel or two of drift, as a sticker put down by hand
   * does, chosen here once and kept.
   */
  createBoardSticker(
    kind: StickerKind,
    colour: StringColour,
    place: { cardId?: string; x: number; y: number }
  ): Promise<BoardSticker | null>
  /** A sticker moved: to another place on the cork, or onto (or off) a card.
   *  Its tilt stays as it was stuck. */
  moveBoardSticker(id: string, place: { cardId?: string; x: number; y: number }): Promise<void>
  deleteBoardSticker(id: string): Promise<void>
  /** Give a string a label, or take it away with an empty one. */
  labelBoardString(id: string, label: string): Promise<void>
  deleteBoardString(id: string): Promise<void>
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
  /**
   * Per-record write chains for read-copy-write updates (map marks and shapes).
   * Two updates to one record started before the first write lands would both
   * copy the same old record and the later write would erase the earlier
   * one's field; each waits for the one before it and re-reads the record.
   */
  chains: Map<string, Promise<void>>
}

const runtimes = new Map<string, ProjectRuntime>()

function runtimeFor(path: string): ProjectRuntime {
  let runtime = runtimes.get(path)
  if (!runtime) {
    runtime = { saveTimer: null, commitTimer: null, commitDirty: false, chains: new Map() }
    runtimes.set(path, runtime)
  }
  return runtime
}

/**
 * Runs `run` after every earlier call for the same record has settled (its
 * failure is swallowed here so one bad write never blocks the next; the caller
 * still sees its own). Records are independent of each other.
 */
function serializeRecord(path: string, key: string, run: () => Promise<void>): Promise<void> {
  const chains = runtimeFor(path).chains
  const next = (chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(run)
  chains.set(key, next)
  const clear = (): void => {
    if (chains.get(key) === next) chains.delete(key)
  }
  next.then(clear, clear)
  return next
}

/** Writes a pin to the project at `path`, then puts it in whichever slice
 *  holds that path now (flat fields or parked), and dirties that path. */
async function writePinAt(path: string, pinId: string, pin: MapPin): Promise<void> {
  await api.writeMapPin(path, pin)
  const after = useWyrm.getState()
  if (after.project?.path === path) {
    useWyrm.setState({ mapPins: after.mapPins.map((p) => (p.id === pinId ? pin : p)) })
  } else if (after.parked[path]) {
    const slice = after.parked[path]
    useWyrm.setState({
      parked: {
        ...after.parked,
        [path]: { ...slice, mapPins: slice.mapPins.map((p) => (p.id === pinId ? pin : p)) }
      }
    })
  }
  runtimeFor(path).commitDirty = true
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
    mapShapes: [],
    mapMarks: [],
    mapId: WORLD_MAP,
    boardStrings: [],
    boardStickers: [],
    boardUndo: null,
    backupSettings: null,
    dailyStats: [],
    syncStatus: null,
    syncConflicts: null,
    syncNeedsAttention: false,
    syncProblem: null,
    stale: false
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

/** A quit already under way: a second ⌘Q while saving does not start another. */
let quitting = false
/** How long quitting waits on the checkpoints before it goes anyway. */
export const QUIT_CHECKPOINT_MS = 8000
/** How long quitting waits on the saves before it asks. */
export const QUIT_SAVE_MS = 10000
const UNSAVED_PAGE =
  'The page could not be saved, so the latest changes would be lost. Quit anyway?'
const UNSAVED_WORK =
  'Some changes are still being saved, and would be lost. Quit anyway, or stay and try again?'

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

  /**
   * Change a project's data, in the project at `path` whether or not it is
   * still in front: computed from that project's data as it is now, put
   * back in whichever slice holds it, and saved there. A map's writes all
   * come through here, so none can land in another novel.
   */
  async function updateProjectDataAt(
    path: string,
    change: (data: ProjectData) => ProjectData
  ): Promise<void> {
    const now = get()
    const info = now.project?.path === path ? now.project : now.parked[path]?.project
    if (!info) return
    const data = change(info.data)
    if (data === info.data) return
    const next = { ...info, data }
    if (now.project?.path === path) set({ project: next })
    else set({ parked: { ...now.parked, [path]: { ...now.parked[path], project: next } } })
    await api.saveProject(path, data)
    runtimeFor(path).commitDirty = true
  }

  /** A checkpoint of the project at `path`, before something is taken away. */
  async function checkpointAt(path: string, message: string): Promise<void> {
    if (get().project?.path === path) await get().flushSave()
    const committed = await api.commit(path, message)
    runtimeFor(path).commitDirty = false
    if (committed && get().project?.path === path) set({ lastCommitAt: Date.now() })
  }

  /**
   * Put a change into whichever slice holds `path` now — the flat fields if
   * it is in front, its parked slice if not — or nowhere, if it has closed.
   */
  function patchSliceAt(path: string, patch: (slice: ProjectSlice) => Partial<ProjectSlice>): void {
    const now = get()
    if (now.project?.path === path) set(patch(now as ProjectSlice))
    else if (now.parked[path])
      set({
        parked: { ...now.parked, [path]: { ...now.parked[path], ...patch(now.parked[path]) } }
      })
  }

  /**
   * Delete every pin, shape and mark on one map, read from disk (the map may
   * never have been opened) — on World, those whose map is gone too, which
   * World shows. Dropped from the slice first, so a move or a rename queued
   * for one finds nothing to write; each delete then waits its turn behind
   * whatever is already queued for that record, so none is written back.
   */
  async function removeRecordsOn(path: string, id: string): Promise<void> {
    const info = get().project?.path === path ? get().project : get().parked[path]?.project
    if (!info) return
    const [pins, shapes, marks] = await Promise.all([
      api.listMapPins(path),
      api.listMapShapes(path),
      api.listMapMarks(path)
    ])
    const gone = {
      pins: new Set(recordsOn(pins, id, info.data).map((r) => r.id)),
      shapes: new Set(recordsOn(shapes, id, info.data).map((r) => r.id)),
      marks: new Set(recordsOn(marks, id, info.data).map((r) => r.id))
    }
    patchSliceAt(path, (slice) => ({
      mapPins: slice.mapPins.filter((r) => !gone.pins.has(r.id)),
      mapShapes: slice.mapShapes.filter((r) => !gone.shapes.has(r.id)),
      mapMarks: slice.mapMarks.filter((r) => !gone.marks.has(r.id))
    }))
    const deletes: Promise<void>[] = []
    for (const pin of gone.pins)
      deletes.push(serializeRecord(path, `pin\0${pin}`, () => api.deleteMapPin(path, pin)))
    for (const shape of gone.shapes)
      deletes.push(serializeRecord(path, `shape\0${shape}`, () => api.deleteMapShape(path, shape)))
    for (const mark of gone.marks)
      deletes.push(serializeRecord(path, `mark\0${mark}`, () => api.deleteMapMark(path, mark)))
    await Promise.all(deletes)
    runtimeFor(path).commitDirty = true
  }

  /** The map for the front of a paged compile, if it was asked for and there
   *  is anything drawn: SVG for PDF, a PNG as well for .docx. */
  async function frontispiece(options: CompileOptions): Promise<CompileMap | undefined> {
    if (!options.frontispiece || !PAGED_FORMATS.includes(options.format)) return undefined
    const picture = await get().mapPicture(
      { grid: false, trim: true, scaleBar: true },
      options.frontispieceMap ?? WORLD_MAP
    )
    if (!picture) return undefined
    const png = options.format === 'docx' ? await mapPicturePng(picture) : undefined
    return { svg: picture.svg, png, ...pngSize(picture) }
  }

  async function persistProject(): Promise<void> {
    const { project } = get()
    if (!project) return
    await api.saveProject(project.path, project.data)
    // The project that was saved, not whichever is in front once the save
    // resolves: a focus change across that await is exactly when the two
    // differ, and the checkpoint dirt belongs with the write.
    runtimeFor(project.path).commitDirty = true
  }

  /**
   * Writes card positions to `path`, whether or not that project is still
   * focused. The open document is the one exception to reading from disk —
   * its in-memory copy is the fresh one — and it lives in the flat fields
   * while the project is focused but in its parked slice once it is not, so
   * a focus change mid-loop moves it from one to the other. Each entry looks
   * it up where it is *now*: the flat `activeDoc` after a switch belongs to
   * a different project, and with shared ids would be written into this one.
   */
  async function writePositions(path: string, pins: CardPin[]): Promise<void> {
    for (const { id, x, y } of pins)
      await updateDocAt(path, id, (meta) => ({ ...meta, boardX: x, boardY: y }))
  }

  /**
   * Rewrites one document's metadata in the project at `path`, whether or not
   * that project is still in front. The open document is the one exception
   * to reading from disk — its in-memory copy is the fresh one, and the next
   * autosave writes that copy, so it must carry the change too — and it lives
   * in the flat fields while its project is focused but in the parked slice
   * once it is not. It is looked up where it is *now*: after a focus change
   * the flat `activeDoc` belongs to a different project, and a clone shares
   * this one's ids, so taking it would write the other novel's text here.
   */
  async function updateDocAt(
    path: string,
    id: string,
    change: (meta: DocMeta) => DocMeta
  ): Promise<DocFile> {
    const openDoc = (): DocFile | null => {
      const now = get()
      return (now.project?.path === path ? now : now.parked[path])?.activeDoc ?? null
    }
    const open = openDoc()
    const doc = open?.meta.id === id ? open : await api.readDoc(path, id)
    const updated: DocFile = { ...doc, meta: change(doc.meta) }
    await api.writeDoc(path, updated)
    if (openDoc()?.meta.id === id) {
      const now = get()
      if (now.project?.path === path) set({ activeDoc: { ...now.activeDoc!, meta: updated.meta } })
      else if (now.parked[path])
        set({
          parked: {
            ...now.parked,
            [path]: {
              ...now.parked[path],
              activeDoc: { ...now.parked[path].activeDoc!, meta: updated.meta }
            }
          }
        })
    }
    runtimeFor(path).commitDirty = true
    return updated
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
    if (info) {
      setProject(info)
      // The map in view may have been deleted on the other device.
      if (!hasSheet(info.data, get().mapId)) set({ mapId: WORLD_MAP })
    }
    await get().loadEntities()
    // The map layers are files too, so a sync can change them under the UI.
    // Each is read for `project.path` and applied only if that project is still
    // in front; a failed read leaves that layer as it was. (Every caller runs
    // this with the synced project focused, but a focus change mid-await must
    // not drop one project's marks into another.)
    const path = project.path
    const layers = await Promise.allSettled([
      api.listMapPins(path),
      api.listMapShapes(path),
      api.listMapMarks(path)
    ])
    if (get().project?.path === path) {
      const [pins, shapes, marks] = layers
      if (pins.status === 'fulfilled') set({ mapPins: pins.value })
      if (shapes.status === 'fulfilled') set({ mapShapes: shapes.value })
      if (marks.status === 'fulfilled') set({ mapMarks: marks.value })
    }
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

    // A project open in a background window has to reach its drives and its
    // remote too. Without this it checkpoints locally and nothing else — two
    // novels open all day and only the focused one leaving the machine.
    // Both are fire-and-forget, exactly as they are for the focused project:
    // a missing drive or a dead network must never block a checkpoint.
    if (slice.backupSettings?.auto && slice.backupSettings.targets.length) {
      void api.backupNow(path).catch(() => {})
    }
    if (isConnected(slice.syncStatus)) {
      void syncParked(path)
    }
  }

  /**
   * Syncs a project that is open but not focused.
   *
   * The store's `syncNow` acts on the focused project, so this cannot use it.
   * What it must not do is let a *pull* go unnoticed: syncing is
   * bidirectional, so the files on disk can change while this project's slice
   * still holds the binder and open document from before. Focusing it then
   * and typing would write stale text over work that had just arrived from
   * another device — so the slice is marked stale and re-read when the
   * project comes forward.
   */
  async function syncParked(path: string): Promise<void> {
    const outcome = await api.syncNow(path).catch(() => null)
    if (!outcome) return
    const parked = get().parked
    const slice = parked[path]
    // Focused or closed while the sync was in flight; whoever owns it now has
    // its own, better-informed handling.
    if (!slice) return
    const problem = syncProblemOf(outcome)
    const base: Partial<ProjectSlice> =
      outcome.status === 'conflicts'
        ? // The page is sacred: a background sync never puts a dialog on
          // screen. The quiet flag shows in the status bar once focused.
          { syncNeedsAttention: true }
        : outcome.status === 'pulled' || outcome.status === 'merged'
          ? { stale: true }
          : {}
    const patch: Partial<ProjectSlice> =
      problem === (slice.syncProblem ?? null) ? base : { ...base, syncProblem: problem }
    if (Object.keys(patch).length === 0) return
    set({ parked: { ...parked, [path]: { ...slice, ...patch } } })
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
      syncNeedsAttention: false,
      syncProblem: null,
      // A different project is a different undo, as it is a different view
      // history. Left out, the last project's record came along and lit the
      // button in a novel nothing had been applied to — and in a restored
      // backup or a clone, which share the original's ids, pressing it would
      // have rewritten that copy's binder to an order it never had.
      boardUndo: null,
      addCardFor: null,
      // A different project's maps: the last project's map id names nothing
      // here, and drawing stamped with it would vanish onto a map that is not.
      mapId: WORLD_MAP
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
    // A remembered position, if this project has one. Windows with none are
    // given a default by App, which is the only place that knows how big the
    // desktop currently is.
    const saved = await api.getWindowGeometry(info.path).catch(() => null)
    if (saved) set({ windowGeometry: { ...get().windowGeometry, [info.path]: saved } })
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
    minimized: [],
    windowGeometry: {},
    stale: false,
    activeId: null,
    activeDoc: null,
    editor: null,
    saveState: 'saved',
    wordCount: 0,
    lastCommitAt: null,
    renamingId: null,
    typewriterMode: false,
    helpMode: false,
    quittingUi: false,
    addCardFor: null,
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
    mapShapes: [],
    mapMarks: [],
    mapId: WORLD_MAP,
    boardStrings: [],
    boardStickers: [],
    boardUndo: null,
    backupSettings: null,
    appearance: null,
    statsSettings: null,
    printSettings: null,
    dailyStats: [],
    syncStatus: null,
    syncConflicts: null,
    syncNeedsAttention: false,
    syncProblem: null,

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

    async quit() {
      if (quitting) return
      quitting = true
      try {
        // The page first, while it is still on screen: the one save that can
        // fail in a way the writer must hear about before anything closes.
        try {
          await get().flushSave()
        } catch {
          if (!window.confirm(UNSAVED_PAGE)) return
        }
        // Then everything closes, and every part saves as it does when it
        // closes: a card's back, a name being typed on the map, a nudge
        // waiting to settle. Nothing more can be typed while quitting.
        set({ quittingUi: true })
        await new Promise((done) => setTimeout(done, 0))
        // Those saves are calls to the bridge; wait for them all. A disk that
        // never answers asks, rather than holding the app open for ever.
        if (!(await apiSettled(QUIT_SAVE_MS)) && !window.confirm(UNSAVED_WORK)) {
          set({ quittingUi: false })
          return
        }
        // Every open project, parked ones too; each only if it has work since
        // its last checkpoint. A checkpoint that fails loses nothing — the
        // files are saved — so quitting does not wait on one for ever.
        const dirty = get().openPaths.filter((p) => runtimeFor(p).commitDirty)
        await Promise.race([
          Promise.all(
            dirty.map((p) =>
              api
                .commit(p, 'Autosave on quit')
                .then(() => {
                  runtimeFor(p).commitDirty = false
                })
                .catch(() => {})
            )
          ),
          new Promise((done) => setTimeout(done, QUIT_CHECKPOINT_MS))
        ])
        await api.quitApp()
      } finally {
        quitting = false
      }
    },

    async cleanUpWindows() {
      set({ windowGeometry: {} })
      // Clear the remembered positions too, or reopening would restore the
      // very arrangement the writer just asked to be rid of.
      for (const path of get().openPaths) {
        await api.clearWindowGeometry(path).catch(() => {})
      }
    },

    async minimizeProject(path) {
      const state = get()
      if (state.minimized.includes(path)) return
      if (!state.openPaths.includes(path)) return
      const minimized = [...state.minimized, path]

      if (state.project?.path !== path) {
        // A background window was already parked, so only its drawing changes.
        set({ minimized })
        return
      }

      // The focused project is going to an icon, so something else has to take
      // the front — or nothing, if everything else is an icon too.
      await get().flushSave()
      const parked = parkFocused()
      const next = [...get().openPaths].reverse().find((p) => p !== path && !minimized.includes(p))
      const incoming = next != null ? parked[next] : undefined
      if (next != null && incoming) {
        delete parked[next]
        set({ ...incoming, parked, minimized })
        return
      }
      // Every window is an icon now. The flat fields are emptied so nothing
      // stale renders, but the project stays open and parked — this is not a
      // close, so `api.closeProject` is deliberately not called and next
      // launch still reopens it.
      set({ ...emptySlice(), parked, minimized })
    },

    async restoreProject(path) {
      if (!get().minimized.includes(path)) return
      set({ minimized: get().minimized.filter((p) => p !== path) })
      // focusProject unparks and raises it, including the stale re-read if a
      // background sync pulled while it sat as an icon.
      await get().focusProject(path)
    },

    moveWindow(path, geometry) {
      set({ windowGeometry: { ...get().windowGeometry, [path]: geometry } })
    },

    async persistWindow(path) {
      const geometry = get().windowGeometry[path]
      if (geometry) await api.setWindowGeometry(path, geometry)
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
      // Raising is a stacking change, not a move: the focused window goes to
      // the end of openPaths and therefore renders in front, while every
      // window stays exactly where the writer put it.
      const openPaths = [...get().openPaths.filter((p) => p !== path), path]
      // A dialog belongs to the window that was in front when it opened.
      set({ ...target, parked, openPaths, addCardFor: null })
      if (target.stale) {
        // Its files changed under a background sync while it sat parked, so
        // the state just swapped in describes the project as it was before
        // that. Re-read before the writer can touch it — `reloadAfterRemoteChange`
        // is exactly this job, and keeps the open document rather than
        // dropping them back to the first scene.
        set({ stale: false })
        await reloadAfterRemoteChange()
      }
    },

    async openAnotherProject() {
      // Uses the info the picker already returned rather than re-opening by
      // path, which would read the project off disk a second time.
      const info = await api.openProject()
      if (!info) return
      if (get().project?.path === info.path) return
      if (get().parked[info.path]) {
        await get().focusProject(info.path)
        return
      }
      await loadProject(info, true)
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

    async selectDoc(id, returnTo) {
      const { project, activeId } = get()
      if (!project) return
      // Picking a document in the binder always brings the manuscript back to
      // the main pane — and this has to happen *before* the same-document
      // guard below, because the commonest way to hit it is clicking back to
      // the document you were already on from a story-bible entry (I-05).
      // Choosing a scene also resets Esc's history (F-14): binder navigation
      // is deliberately not part of the back-stack. The one exception is a
      // caller that names where the writer came from — the corkboard, whose
      // board→scene→board loop is how an outline is worked through, or the
      // map, itself a detour: that place is added to the trail, as an entry
      // opened from the map adds it, so Esc walks back map, then board.
      const { viewHistory } = get()
      set({
        mainView: { kind: 'doc' },
        viewHistory: returnTo ? [...viewHistory, returnTo].slice(-VIEW_HISTORY_LIMIT) : []
      })
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

    async setCardPosition(docId, x, y) {
      const { project, activeId, activeDoc } = get()
      if (!project) return
      const doc =
        docId === activeId && activeDoc ? activeDoc : await api.readDoc(project.path, docId)
      const updated: DocFile = { ...doc, meta: { ...doc.meta, boardX: x, boardY: y } }
      await api.writeDoc(project.path, updated)
      if (docId === activeId) set({ activeDoc: updated })
      markDirty()
    },

    async tidyBoard() {
      const { project, activeId } = get()
      if (!project) return
      const docs = await api.readAllDocs(project.path)
      for (const doc of docs) {
        if (doc.meta.boardX == null && doc.meta.boardY == null) continue
        // Deleted rather than set to undefined, the same care the rest of the
        // metadata writers take: an explicit undefined serializes as a key.
        const meta = { ...doc.meta }
        delete meta.boardX
        delete meta.boardY
        const updated: DocFile = { ...doc, meta }
        await api.writeDoc(project.path, updated)
        if (doc.meta.id === activeId) set({ activeDoc: updated })
      }
      // F-45: the bible entries' cards too. Membership stays — Tidy puts
      // cards back in their slots, it does not take them off — so only the
      // position keys go, deleted for the reason above. Through saveEntity,
      // so setEntities stays the only writer of the entity index.
      for (const entity of get().entities) {
        if (entity.boardX == null && entity.boardY == null) continue
        const tidied = { ...entity }
        delete tidied.boardX
        delete tidied.boardY
        await get().saveEntity(tidied)
      }
      // And the minimap cards': back to their slots, still on the board.
      await updateProjectDataAt(project.path, (data) =>
        sheetsOf(data)
          .filter((m) => m.boardX != null || m.boardY != null)
          .reduce((d, m) => withSheet(d, m.id, { boardX: undefined, boardY: undefined }), data)
      )
      markDirty()
    },

    async addEntityToBoard(entityId) {
      const { project, entities } = get()
      if (!project) return
      const entity = entities.find((e) => e.id === entityId)
      // Already on the board is not an error, but it is not a write either:
      // re-saving would bump `modified` on an entry nothing happened to.
      if (!entity || entity.onBoard) return
      await get().saveEntity({ ...entity, onBoard: true })
    },

    async removeEntityFromBoard(entityId) {
      const { project, entities } = get()
      if (!project) return
      const entity = entities.find((e) => e.id === entityId)
      if (!entity) return
      // Off the board, not out of the bible: only the card goes. The keys
      // are deleted rather than set to undefined — gray-matter throws on an
      // explicit undefined frontmatter value, and main's writeEntity only
      // emits them when set anyway. The position goes with the membership,
      // so a card put back later takes a grid slot rather than its old spot.
      const off = { ...entity }
      delete off.onBoard
      delete off.boardX
      delete off.boardY
      await get().saveEntity(off)
    },

    async setEntityPosition(entityId, x, y) {
      const { project, entities } = get()
      if (!project) return
      const entity = entities.find((e) => e.id === entityId)
      if (!entity) return
      await get().saveEntity({ ...entity, boardX: x, boardY: y })
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

    async setCardBack(path, docId, patch) {
      return updateDocAt(path, docId, (meta) => withPatch(meta, patch))
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
      set({
        syncStatus: await api.disconnectSync(project.path),
        syncNeedsAttention: false,
        syncProblem: null
      })
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
        set({ syncNeedsAttention: true, syncProblem: errorMessage(err) })
        throw err
      }
      set({ syncProblem: syncProblemOf(outcome) })
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

    async saveEverywhere() {
      const { project } = get()
      if (!project) throw new Error('No project is open')
      const path = project.path
      await get().flushSave()
      const committed = await api.commit(path, 'Save point')
      // The writer may have brought another project to the front during that
      // await; everything after acts on the focused project, so stop rather
      // than copy the wrong novel (the drawer closes on a focus change anyway).
      if (get().project?.path !== path) return { backup: null, sync: null }
      clearDirty()
      if (committed) {
        set({ lastCommitAt: Date.now() })
        void get().refreshStats()
      }
      const result: SaveEverywhere = { backup: null, sync: null }
      if (get().backupSettings?.targets.length) {
        result.backup = await get()
          .backupNow()
          .catch((e: unknown) => ({ error: errorMessage(e) }))
      }
      if (get().project?.path !== path) return result
      if (isConnected(get().syncStatus)) {
        result.sync = await get()
          .syncNow(true)
          .catch((e: unknown) => ({ status: 'error', detail: errorMessage(e) }) as const)
      }
      return result
    },

    async setSaveOrder(order) {
      const { project } = get()
      if (!project) return
      set({ backupSettings: await api.setSaveOrder(project.path, order) })
    },

    async restoreFromBackup() {
      const info = await api.restoreFromBackup()
      if (!info) return false
      // Beside whatever is open, never in place of it (F-50): a restore makes
      // a new project folder, and closing the others would dispose their
      // runtimes — and their unsaved save points — for nothing.
      await loadProject(info, true)
      return true
    },

    async cloneFromGithub(url) {
      // Errors are deliberately not swallowed: the dialog shows them, since
      // "that is not a WyrmStar project" is something the writer has to read
      // and act on rather than a failure to log.
      const info = await api.cloneProject(url)
      if (!info) return false
      // Beside whatever is open, as a restore is (F-50).
      await loadProject(info, true)
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
      const map = await frontispiece(options)
      const result = compile(project.data, docs, options, true, map)
      const name = compileFileName(project.data.title, result.extension)
      // PDF bytes cannot be built here: pagination is Chromium's job (F-38),
      // which lives in the main process and is async — unlike .docx, whose
      // container `compile` can assemble synchronously.
      let data: string | Uint8Array = result.bytes ?? result.text
      if (options.format === 'pdf') {
        const pdf = await api.renderPdf(renderHtml(result.blocks, map))
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
      return api.printHtml(renderHtml(result.blocks, await frontispiece(options)))
    },

    async mapPicture(options, mapId = get().mapId) {
      const { project } = get()
      if (!project) return null
      const sheet = sheetOf(project.data, mapId)
      // Everything from the one project, as it is on disk: the names too,
      // since Compile can run before the World Book has been read.
      const [pins, shapes, marks, entries] = await Promise.all([
        api.listMapPins(project.path),
        api.listMapShapes(project.path),
        api.listMapMarks(project.path),
        api.listEntities(project.path)
      ])
      const places = new Map(entries.filter((e) => e.type === 'world').map((e) => [e.id, e.name]))
      const input = {
        mapBounds: sheet.bounds,
        shapes: recordsOn(shapes, sheet.id, project.data),
        marks: recordsOn(marks, sheet.id, project.data),
        pins: recordsOn(pins, sheet.id, project.data).filter((p) => places.has(p.entityId)),
        nameOf: (id: string) => places.get(id) ?? '',
        scale: validScale(sheet.scale) ? sheet.scale : undefined
      }
      return mapHasDrawing(input) ? mapPictureSvg(input, options) : null
    },

    async exportMapImage(format, options, mapId = get().mapId) {
      const { project } = get()
      if (!project) return null
      const picture = await get().mapPicture(options, mapId)
      if (!picture) return null
      const data = format === 'svg' ? picture.svg : await mapPicturePng(picture)
      // "The Saltmarsh map", or for any map but World, "The Saltmarsh — Port Cray".
      const sheet = sheetOf(project.data, mapId)
      const name = compileFileName(
        sheet.id === WORLD_MAP
          ? `${project.data.title} map`
          : `${project.data.title} — ${sheet.name}`,
        format
      )
      return api.exportFile(name, data, { title: 'Export Map Image', buttonLabel: 'Export' })
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

    async addSceneDoc(title) {
      const { project } = get()
      if (!project) return null
      const now = new Date().toISOString()
      const meta = {
        id: newId(),
        title: title.trim() || 'Untitled',
        status: 'draft' as const,
        tags: [SCENE_TAG],
        created: now,
        modified: now
      }
      await api.writeDoc(project.path, { meta, body: '' })
      const node: BinderNode = { id: meta.id, type: 'doc', title: meta.title }
      // Found by name, not by position: the writer can rename or trash any
      // root folder, so there may be no Manuscript at all. The first root
      // folder is the next best home and the binder root the last resort — a
      // scene that lands somewhere surprising beats one written to disk that
      // no binder lists.
      const root = project.data.binder
      const manuscript =
        root.find((n) => n.type === 'folder' && n.title === 'Manuscript') ??
        (root[0]?.type === 'folder' ? root[0] : null)
      if (manuscript) {
        manuscript.children = manuscript.children ?? []
        manuscript.children.push(node)
      } else {
        root.push(node)
      }
      setProject({ ...project })
      await persistProject()
      // No startRename or selectDoc, deliberately — see the interface.
      return meta.id
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

    setBoardUndo(undo) {
      set({ boardUndo: undo })
    },

    async undoBoardOrder() {
      const { boardUndo, project } = get()
      if (!boardUndo || !project) return
      // Forgotten before the apply, not after: if the apply throws, offering
      // the same undo again would re-run the same failure.
      set({ boardUndo: null })
      // Each folder's old order, kept to the scenes still in that folder.
      const ids: string[] = []
      for (const { parentId, ids: was } of boardUndo) {
        const parent =
          parentId === '' ? project.data.binder : findNode(project.data.binder, parentId)?.children
        if (!parent) continue
        const present = new Set(parent.filter((n) => n.type === 'doc').map((n) => n.id))
        ids.push(...was.filter((id) => present.has(id)))
      }
      // The apply records its own undo — which would make this a redo. One
      // step is the promise, so it is forgotten again whether or not the
      // save landed — and forgotten on *this* project's state, wherever
      // that is by then: the save is an await a writer can click another
      // window across, and the flat field would then be another novel's.
      try {
        await get().applyBoardOrder(ids)
      } finally {
        const now = get()
        const { path } = project
        if (now.project?.path === path) set({ boardUndo: null })
        else if (now.parked[path])
          set({ parked: { ...now.parked, [path]: { ...now.parked[path], boardUndo: null } } })
      }
    },

    async applyBoardOrder(orderedIds, pins = []) {
      const { project } = get()
      if (!project) return null
      // First mention wins, so a duplicated id cannot rank a scene twice.
      const rank = new Map<string, number>()
      orderedIds.forEach((id, i) => {
        if (!rank.has(id)) rank.set(id, i)
      })
      const record: BoardUndo = []
      // Per parent: the movable docs are lifted out of their slots and dealt
      // back into those same slots in board order. Slots, not a sort of the
      // whole array, is what keeps a sub-folder or a note at its exact index
      // and keeps every doc inside the parent it started in. A parent whose
      // deal changes nothing is not recorded, so Undo later touches only
      // what this call touched.
      const deal = (siblings: BinderNode[], parentId: string): void => {
        const slots: number[] = []
        siblings.forEach((node, i) => {
          if (node.type === 'doc' && rank.has(node.id)) slots.push(i)
          if (node.children) deal(node.children, node.id)
        })
        const before = slots.map((i) => siblings[i])
        const movable = [...before].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
        let changed = false
        slots.forEach((slot, k) => {
          if (siblings[slot] === movable[k]) return
          siblings[slot] = movable[k]
          changed = true
        })
        if (changed) record.push({ parentId, ids: before.map((n) => n.id) })
      }
      deal(project.data.binder, '')
      // Nothing moved means nothing written: the save would be a no-op on
      // disk but would still bump the checkpoint dirt.
      if (record.length === 0) return null
      // Recorded before the write, not after: a save that throws leaves the
      // binder reordered in memory, and that is precisely when the way back
      // must already exist.
      set({ boardUndo: record })
      setProject({ ...project })
      await persistProject()
      // After the binder, so a save that throws pins nothing for an order
      // that never landed; to the path captured above, for the reason the
      // interface gives.
      await writePositions(project.path, pins)
      return record
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

    async createEntity(type, name, extra) {
      const { project } = get()
      if (!project) return null
      const now = new Date().toISOString()
      // `extra` sits between the defaults and the identity, so it can seed a
      // body or put the entry on the board but never forge an id or a type.
      const entity: Entity = {
        aliases: [],
        body: '',
        ...extra,
        id: newId(),
        type,
        name: name.trim() || 'Untitled',
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
      // A place's pin goes with it, as its portrait does: a pin for an entry
      // that no longer exists is a dot on the map nothing can explain.
      // Every pin it has, on every map, read from disk: the map may never
      // have been opened, and a place can be on several maps.
      const path = project.path
      // The entry is gone already: a map that will not read must not fail
      // that, so the pins loaded are taken instead.
      const listed = await api.listMapPins(path).catch(() => get().mapPins)
      const pins = listed.filter((p) => p.entityId === entity.id)
      for (const pin of pins) await api.deleteMapPin(path, pin.id)
      if (pins.length > 0) {
        const gone = new Set(pins.map((p) => p.id))
        patchSliceAt(path, (slice) => ({ mapPins: slice.mapPins.filter((p) => !gone.has(p.id)) }))
        runtimeFor(path).commitDirty = true
      }
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

    async setPortrait(entityId) {
      const { project, entities } = get()
      if (!project) return false
      if (!entities.some((e) => e.id === entityId)) return false
      const rel = await api.importPortrait(project.path, entityId)
      // Null is the picker being closed: no file was copied, so the entry
      // must not be re-saved to point at an image that is not there.
      if (!rel) return false
      // Looked up again after the await rather than held across it: the
      // picker is modal, but a save that lands meanwhile (the editor's own
      // autosave of the entry) would otherwise be written over with the copy
      // from before it. Through saveEntity, so setEntities stays the only
      // writer of the entity index.
      const entity = get().entities.find((e) => e.id === entityId)
      if (!entity) return false
      await get().saveEntity({ ...entity, portrait: rel })
      return true
    },

    async clearPortrait(entityId) {
      const { project, entities } = get()
      if (!project) return
      const entity = entities.find((e) => e.id === entityId)
      if (!entity) return
      await api.removePortrait(project.path, entityId)
      // The key is deleted from a copy, never assigned undefined — gray-matter
      // throws on an explicit undefined frontmatter value, and main's
      // writeEntity only emits the key when set, so the bare delete is the
      // whole of "no portrait" (the rule removeEntityFromBoard follows too).
      const cleared = { ...entity }
      delete cleared.portrait
      await get().saveEntity(cleared)
    },

    openEntityPanel(id) {
      set({ panelEntityId: id })
    },

    showEntity(id, from) {
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
        viewHistory: [...viewHistory, from ?? mainView].slice(-VIEW_HISTORY_LIMIT),
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

    showMap() {
      // A detour, like stats and tags: the map is looked at and come back
      // from, from the board or the page, and Esc should put the writer
      // back exactly where they were.
      const { mainView, viewHistory } = get()
      if (mainView.kind === 'map') return
      set({
        mainView: { kind: 'map' },
        viewHistory: [...viewHistory, mainView].slice(-VIEW_HISTORY_LIMIT)
      })
    },

    settleMapReturn() {
      const { mainView } = get()
      if (mainView.kind !== 'map' || Object.keys(mainView).length === 1) return
      set({ mainView: { kind: 'map' } })
    },

    async setMapBounds(bounds) {
      const { project, mapId } = get()
      if (!project) return
      const id = sheetOf(project.data, mapId).id
      await updateProjectDataAt(project.path, (data) => withSheet(data, id, { bounds }))
    },

    async setMapScale(scale) {
      const { project, mapId } = get()
      if (!project) return
      const id = sheetOf(project.data, mapId).id
      // Cleared means absent, as every optional field is written.
      await updateProjectDataAt(project.path, (data) =>
        withSheet(data, id, { scale: scale ?? undefined })
      )
    },

    chooseMap(id) {
      const { project } = get()
      if (!project) return
      set({ mapId: hasSheet(project.data, id) ? id : WORLD_MAP })
    },

    showMapSheet(id, from) {
      get().chooseMap(id)
      const { mainView, viewHistory } = get()
      if (mainView.kind === 'map') return
      set({
        mainView: { kind: 'map' },
        viewHistory: [...viewHistory, from ?? mainView].slice(-VIEW_HISTORY_LIMIT)
      })
    },

    async addMap(name) {
      const { project } = get()
      if (!project || mapNameProblem(project.data, name)) return null
      const id = newId()
      await updateProjectDataAt(project.path, (data) =>
        withNewSheet(data, { id, name: name.trim() })
      )
      if (get().project?.path === project.path) set({ mapId: id })
      return id
    },

    async renameMap(id, name) {
      const { project } = get()
      if (!project) return null
      const problem = mapNameProblem(project.data, name, id)
      if (problem) return problem
      await updateProjectDataAt(project.path, (data) => withSheet(data, id, { name: name.trim() }))
      return null
    },

    async clearMap(path, id) {
      await checkpointAt(path, 'Auto: before clearing a map')
      await removeRecordsOn(path, id)
    },

    async deleteMap(path, id) {
      if (id === WORLD_MAP) return
      await checkpointAt(path, 'Auto: before deleting a map')
      await removeRecordsOn(path, id)
      await updateProjectDataAt(path, (data) => withoutSheet(data, id))
      const after = get()
      if (after.project?.path === path) {
        if (after.mapId === id) set({ mapId: WORLD_MAP })
      } else if (after.parked[path]?.mapId === id) {
        set({ parked: { ...after.parked, [path]: { ...after.parked[path], mapId: WORLD_MAP } } })
      }
    },

    async setMapOnBoard(id, on) {
      const { project } = get()
      if (!project) return
      // Taken off, its place goes with it: put back, it is dealt afresh.
      await updateProjectDataAt(project.path, (data) =>
        withSheet(
          data,
          id,
          on ? { onBoard: true } : { onBoard: undefined, boardX: undefined, boardY: undefined }
        )
      )
    },

    async placeMapCard(id, at) {
      const { project } = get()
      if (!project) return
      await updateProjectDataAt(project.path, (data) =>
        withSheet(data, id, {
          boardX: at ? Math.round(at.x) : undefined,
          boardY: at ? Math.round(at.y) : undefined
        })
      )
    },

    showCorkboard() {
      // An arrival, not a detour — unlike stats and tags, which are glanced at
      // mid-sentence and return you to exactly where you were. The corkboard
      // is a place to work from, so it clears the history the way showFolder
      // does.
      //
      // Clicking a card is *not* an arrival, though: since outline mode
      // (F-42) the board is where a story is worked through card by card, so
      // a scene opened from a card remembers the board and Esc goes back to
      // it, onto the same card (`selectDoc`'s `returnTo`). Picking a scene in
      // the binder from there is still an arrival and clears that trail, so
      // Esc never drags a writer back to a board they have moved on from.
      const { mainView } = get()
      if (mainView.kind === 'corkboard') return
      set({ mainView: { kind: 'corkboard' }, viewHistory: [] })
    },

    openAddCard() {
      const path = get().project?.path
      if (!path) return
      get().showCorkboard()
      set({ addCardFor: path })
    },

    closeAddCard() {
      set({ addCardFor: null })
    },

    setHelpMode(on) {
      set({ helpMode: on })
    },

    toggleCorkboard() {
      // The board and the manuscript are the two places a writer works, so
      // one key moves between them rather than two that each only go one way.
      // Anything else on screen — a folder listing, stats, a bible entry —
      // counts as "not the board", so the key takes you to the board from
      // there rather than doing nothing.
      const { mainView } = get()
      if (mainView.kind === 'corkboard') get().showDoc()
      else get().showCorkboard()
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

    settleBoardReturn() {
      const { mainView } = get()
      if (mainView.kind !== 'corkboard' || Object.keys(mainView).length === 1) return
      set({ mainView: { kind: 'corkboard' } })
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

    async createRelationship(fromId, toId, label, colour) {
      const { project } = get()
      if (!project || !label.trim()) return null
      const now = new Date().toISOString()
      const relationship: Relationship = {
        id: newId(),
        fromId,
        toId,
        label: label.trim(),
        ...(storedColour(colour) ? { colour: storedColour(colour) } : {}),
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
      const path = project.path
      const updated: Relationship = { ...relationship, modified: new Date().toISOString() }
      await api.writeRelationship(path, updated)
      // Into the project written, which may no longer be the one in front
      // (a recolour from the board, a rename in the Character Graph).
      patchSliceAt(path, (slice) => ({
        relationships: slice.relationships.map((r) => (r.id === updated.id ? updated : r))
      }))
      runtimeFor(path).commitDirty = true
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
      // Into the project read, whichever is in front by the time it lands.
      const mapPins = await api.listMapPins(project.path)
      patchSliceAt(project.path, () => ({ mapPins }))
    },

    async setMapPin(entityId, x, y) {
      const { project } = get()
      if (!project) return
      // A place has a pin on each map it is on: this one moves its pin on
      // the map in view, or puts one there.
      // The map as the view shows it: an id no map has is World.
      const mapId = sheetOf(project.data, get().mapId).id
      const existing = recordsOn(get().mapPins, mapId, project.data).find(
        (p) => p.entityId === entityId
      )
      const now = new Date().toISOString()
      const pin: MapPin = existing
        ? { ...existing, x, y }
        : { id: newId(), entityId, x, y, created: now, modified: now }
      const map = storedMapId(mapId)
      if (map && !existing) pin.map = map
      await api.writeMapPin(project.path, pin)
      set({
        mapPins: existing
          ? get().mapPins.map((p) => (p.id === pin.id ? pin : p))
          : [...get().mapPins, pin]
      })
      markDirty()
    },

    async moveMapPinAt(path, pinId, x, y) {
      return serializeRecord(path, `pin\0${pinId}`, async () => {
        const now = get()
        const focused = now.project?.path === path
        const pins = focused ? now.mapPins : now.parked[path]?.mapPins
        const found = pins?.find((p) => p.id === pinId)
        if (!found) return
        await writePinAt(path, pinId, { ...found, x, y })
      })
    },

    async styleMapPinAt(path, pinId, style) {
      return serializeRecord(path, `pin\0${pinId}`, async () => {
        const now = get()
        const focused = now.project?.path === path
        const pins = focused ? now.mapPins : now.parked[path]?.mapPins
        const found = pins?.find((p) => p.id === pinId)
        if (!found) return
        const next: MapPin = { ...found }
        if (style.stamp === null) {
          delete next.stamp
          delete next.size
        } else if (style.stamp !== undefined && MAP_STAMP_KINDS.includes(style.stamp)) {
          next.stamp = style.stamp
        }
        if (
          next.stamp &&
          style.size !== undefined &&
          (MARK_SIZES as readonly number[]).includes(style.size)
        ) {
          if (style.size === 1) delete next.size
          else next.size = style.size
        }
        if (next.stamp === found.stamp && next.size === found.size) return
        await writePinAt(path, pinId, next)
      })
    },

    async removeMapPin(pin) {
      const { project } = get()
      if (!project) return
      await api.deleteMapPin(project.path, pin.id)
      set({ mapPins: get().mapPins.filter((p) => p.id !== pin.id) })
      markDirty()
    },

    async loadMapShapes() {
      const { project } = get()
      if (!project) return
      const mapShapes = await api.listMapShapes(project.path)
      patchSliceAt(project.path, () => ({ mapShapes }))
    },

    async createMapShape(kind, points) {
      const { project } = get()
      if (!project) return null
      const rounded = roundPoints(points)
      if (rounded.length < minShapePoints(kind)) return null
      const now = new Date().toISOString()
      const shape: MapShape = { id: newId(), kind, points: rounded, created: now, modified: now }
      const map = storedMapId(sheetOf(project.data, get().mapId).id)
      if (map) shape.map = map
      await api.writeMapShape(project.path, shape)
      set({ mapShapes: [...get().mapShapes, shape] })
      markDirty()
      return shape
    },

    async updateMapShapeAt(path, id, points) {
      return serializeRecord(path, `shape\0${id}`, async () => {
        const now = get()
        const focused = now.project?.path === path
        const shapes = focused ? now.mapShapes : now.parked[path]?.mapShapes
        const found = shapes?.find((s) => s.id === id)
        if (!found) return
        const rounded = roundPoints(points)
        if (rounded.length < minShapePoints(found.kind)) return
        const updated: MapShape = { ...found, points: rounded }
        await api.writeMapShape(path, updated)
        const after = get()
        if (after.project?.path === path) {
          set({ mapShapes: after.mapShapes.map((s) => (s.id === id ? updated : s)) })
        } else if (after.parked[path]) {
          const slice = after.parked[path]
          set({
            parked: {
              ...after.parked,
              [path]: {
                ...slice,
                mapShapes: slice.mapShapes.map((s) => (s.id === id ? updated : s))
              }
            }
          })
        }
        runtimeFor(path).commitDirty = true
      })
    },

    async deleteMapShape(shape) {
      const { project } = get()
      if (!project) return
      await api.deleteMapShape(project.path, shape.id)
      set({ mapShapes: get().mapShapes.filter((s) => s.id !== shape.id) })
      markDirty()
    },

    async renameMapShapeAt(path, id, name) {
      return serializeRecord(path, `shape\0${id}`, async () => {
        const now = get()
        const focused = now.project?.path === path
        const shapes = focused ? now.mapShapes : now.parked[path]?.mapShapes
        const found = shapes?.find((s) => s.id === id)
        if (!found) return
        const trimmed = name.trim()
        if (trimmed === (found.name ?? '')) return
        const updated: MapShape = { ...found }
        if (trimmed) updated.name = trimmed
        else delete updated.name
        await api.writeMapShape(path, updated)
        const after = get()
        if (after.project?.path === path) {
          set({ mapShapes: after.mapShapes.map((s) => (s.id === id ? updated : s)) })
        } else if (after.parked[path]) {
          const slice = after.parked[path]
          set({
            parked: {
              ...after.parked,
              [path]: {
                ...slice,
                mapShapes: slice.mapShapes.map((s) => (s.id === id ? updated : s))
              }
            }
          })
        }
        runtimeFor(path).commitDirty = true
      })
    },

    /* ---------- map marks (F-12 part 4) ---------- */

    async loadMapMarks() {
      const { project } = get()
      if (!project) return
      const mapMarks = await api.listMapMarks(project.path)
      patchSliceAt(project.path, () => ({ mapMarks }))
    },

    async createMapMark(kind, x, y, name, size) {
      const path = get().project?.path
      return path ? get().createMapMarkAt(path, kind, x, y, name, size) : null
    },

    async createMapMarkAt(path, kind, x, y, name, size) {
      const before = get()
      if (before.project?.path !== path && !before.parked[path]) return null
      const trimmed = (name ?? '').trim()
      if (kind === 'label' && !trimmed) return null
      const now = new Date().toISOString()
      const mark: MapMark = {
        id: newId(),
        kind,
        x: Math.round(x),
        y: Math.round(y),
        created: now,
        modified: now
      }
      if (size !== undefined && markSizeOf(size) !== 1) mark.size = size
      if (trimmed) mark.name = trimmed
      // On the map in view in that project, as it was when the mark was made.
      const slice = before.project?.path === path ? before : before.parked[path]
      const map = storedMapId(
        slice.project ? sheetOf(slice.project.data, slice.mapId).id : WORLD_MAP
      )
      if (map) mark.map = map
      await api.writeMapMark(path, mark)
      const after = get()
      if (after.project?.path === path) {
        set({ mapMarks: [...after.mapMarks, mark] })
      } else if (after.parked[path]) {
        const slice = after.parked[path]
        set({
          parked: { ...after.parked, [path]: { ...slice, mapMarks: [...slice.mapMarks, mark] } }
        })
      }
      runtimeFor(path).commitDirty = true
      return mark
    },

    async updateMapMarkAt(path, id, patch) {
      return serializeRecord(path, `mark\0${id}`, async () => {
        const now = get()
        const focused = now.project?.path === path
        const marks = focused ? now.mapMarks : now.parked[path]?.mapMarks
        const found = marks?.find((m) => m.id === id)
        if (!found) return
        const updated: MapMark = { ...found }
        if (patch.x !== undefined) updated.x = Math.round(patch.x)
        if (patch.y !== undefined) updated.y = Math.round(patch.y)
        if (patch.name !== undefined) {
          const trimmed = patch.name.trim()
          if (trimmed) updated.name = trimmed
          else if (found.kind === 'label') return
          else delete updated.name
        }
        if (patch.size !== undefined && (MARK_SIZES as readonly number[]).includes(patch.size)) {
          if (patch.size === 1) delete updated.size
          else updated.size = patch.size
        }
        if (
          updated.x === found.x &&
          updated.y === found.y &&
          (updated.name ?? '') === (found.name ?? '') &&
          updated.size === found.size
        ) {
          return
        }
        updated.modified = new Date().toISOString()
        await api.writeMapMark(path, updated)
        const after = get()
        if (after.project?.path === path) {
          set({ mapMarks: after.mapMarks.map((m) => (m.id === id ? updated : m)) })
        } else if (after.parked[path]) {
          const slice = after.parked[path]
          set({
            parked: {
              ...after.parked,
              [path]: { ...slice, mapMarks: slice.mapMarks.map((m) => (m.id === id ? updated : m)) }
            }
          })
        }
        runtimeFor(path).commitDirty = true
      })
    },

    async deleteMapMark(mark) {
      const path = get().project?.path
      if (!path) return
      await api.deleteMapMark(path, mark.id)
      const after = get()
      if (after.project?.path === path) {
        set({ mapMarks: after.mapMarks.filter((m) => m.id !== mark.id) })
      } else if (after.parked[path]) {
        const slice = after.parked[path]
        set({
          parked: {
            ...after.parked,
            [path]: { ...slice, mapMarks: slice.mapMarks.filter((m) => m.id !== mark.id) }
          }
        })
      }
      runtimeFor(path).commitDirty = true
    },

    /* ---------- red strings (F-46) ---------- */

    async loadBoardStrings() {
      const { project } = get()
      if (!project) return
      set({ boardStrings: await api.listBoardStrings(project.path) })
    },

    async createBoardString(from, to, label, colour) {
      const { project } = get()
      if (!project || from.cardId === to.cardId) return null
      const now = new Date().toISOString()
      const s: BoardString = {
        id: newId(),
        from,
        to,
        ...(label?.trim() ? { label: label.trim() } : {}),
        ...(storedColour(colour) ? { colour: storedColour(colour) } : {}),
        created: now,
        modified: now
      }
      await api.writeBoardString(project.path, s)
      set({ boardStrings: [...get().boardStrings, s] })
      markDirty()
      return s
    },

    async labelBoardString(id, label) {
      const { project } = get()
      const found = get().boardStrings.find((s) => s.id === id)
      if (!project || !found) return
      // Unchanged writes nothing: a rewrite restamps the file for the next
      // checkpoint and every sync.
      if ((found.label ?? '') === label.trim()) return
      const rest: BoardString = { ...found }
      delete rest.label
      const updated: BoardString = label.trim() ? { ...rest, label: label.trim() } : rest
      await api.writeBoardString(project.path, updated)
      set({ boardStrings: get().boardStrings.map((s) => (s.id === id ? updated : s)) })
      markDirty()
    },

    async deleteBoardString(id) {
      const { project } = get()
      if (!project) return
      await api.deleteBoardString(project.path, id)
      set({ boardStrings: get().boardStrings.filter((s) => s.id !== id) })
      markDirty()
    },

    async recolourBoardString(id, colour) {
      const { project } = get()
      const found = get().boardStrings.find((s) => s.id === id)
      if (!project || !found || colourOf(found) === colour) return
      const path = project.path
      const updated: BoardString = { ...found }
      delete updated.colour
      if (storedColour(colour)) updated.colour = colour
      await api.writeBoardString(path, updated)
      // Into the project written, which may no longer be the one in front.
      patchSliceAt(path, (slice) => ({
        boardStrings: slice.boardStrings.map((s) => (s.id === id ? updated : s))
      }))
      runtimeFor(path).commitDirty = true
    },

    /* ---------- stickers ---------- */

    async loadBoardStickers() {
      const { project } = get()
      if (!project) return
      const path = project.path
      const boardStickers = await api.listBoardStickers(path)
      patchSliceAt(path, () => ({ boardStickers }))
    },

    async createBoardSticker(kind, colour, place) {
      const { project } = get()
      if (!project) return null
      const now = new Date().toISOString()
      // A hand is never quite square, nor quite where it aimed: up to a
      // dozen degrees either way, and a pixel or two off.
      const jitter = (): number => Math.round((Math.random() * 4 - 2) * 10) / 10
      const sticker: BoardSticker = {
        id: newId(),
        kind,
        rotation: Math.round((Math.random() * 24 - 12) * 10) / 10,
        x: Math.round(place.x + jitter()),
        y: Math.round(place.y + jitter()),
        created: now,
        modified: now
      }
      if (storedColour(colour)) sticker.colour = colour
      if (place.cardId) sticker.cardId = place.cardId
      await api.writeBoardSticker(project.path, sticker)
      patchSliceAt(project.path, (slice) => ({
        boardStickers: [...slice.boardStickers, sticker]
      }))
      // The path written, which may no longer be the one in front.
      runtimeFor(project.path).commitDirty = true
      return sticker
    },

    async moveBoardSticker(id, place) {
      const { project } = get()
      const found = get().boardStickers.find((s) => s.id === id)
      if (!project || !found) return
      const moved: BoardSticker = { ...found, x: Math.round(place.x), y: Math.round(place.y) }
      delete moved.cardId
      if (place.cardId) moved.cardId = place.cardId
      if (moved.x === found.x && moved.y === found.y && moved.cardId === found.cardId) return
      await api.writeBoardSticker(project.path, moved)
      patchSliceAt(project.path, (slice) => ({
        boardStickers: slice.boardStickers.map((s) => (s.id === id ? moved : s))
      }))
      // The path written, which may no longer be the one in front.
      runtimeFor(project.path).commitDirty = true
    },

    async deleteBoardSticker(id) {
      const { project } = get()
      if (!project) return
      await api.deleteBoardSticker(project.path, id)
      patchSliceAt(project.path, (slice) => ({
        boardStickers: slice.boardStickers.filter((s) => s.id !== id)
      }))
      // The path written, which may no longer be the one in front.
      runtimeFor(project.path).commitDirty = true
    }
  }
})

// Best-effort safety net when the window is closed mid-edit.
window.addEventListener('beforeunload', () => {
  void useWyrm.getState().flushSave()
  void useWyrm.getState().commitNow('Autosave on close')
})

// Every way to quit the desktop app reaches the window first (see
// `main/wyrm/quitGate.ts`), and is answered here, with the same save as
// File → Quit.
api.onQuitRequested(() => void useWyrm.getState().quit())

// Offline queueing (brief §7): commits are always local-first; when the
// network returns, anything still waiting goes up quietly.
window.addEventListener('online', () => {
  const state = useWyrm.getState()
  if (state.syncStatus?.mode === 'github' && state.syncStatus.pendingSync) {
    void state.syncNow(false).catch(() => {})
  }
})

// Add Card is a dialog on the board: leaving the board ends it. The state
// lives in the store (so ⌥⌘N, the menu and the palette can open it), which
// means nothing unmounts it — left set, it popped open again uninvited the
// next time the board was shown. A subscription rather than a line in every
// action that changes the view, of which there are many; not a cleanup on
// the board's unmount, which StrictMode runs on the very first mount and
// would close the dialog the moment ⌥⌘N opened it.
useWyrm.subscribe((now, before) => {
  if (now.addCardFor == null) return
  if (before.mainView.kind === 'corkboard' && now.mainView.kind !== 'corkboard')
    useWyrm.setState({ addCardFor: null })
})
