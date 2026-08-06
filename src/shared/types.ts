export type BinderNodeType = 'folder' | 'doc'

export interface BinderNode {
  id: string
  type: BinderNodeType
  title: string
  children?: BinderNode[]
}

export type DocStatus = 'draft' | 'revised' | 'final'

/**
 * The document-scoped pin vocabulary (F-10). Pins are a closed, app-shipped
 * set — unlike tags, writers cannot invent new ones. "Scene" is deliberately
 * absent: it is a tag (`SCENE_TAG` below), not a pin, so any document can be
 * marked plottable without a document-kind change.
 */
export const DOC_PINS = [
  'Setup',
  'Rising Action',
  'Climax',
  'Falling Action',
  'Resolution'
] as const
export type DocPin = (typeof DOC_PINS)[number]

/** The character-scoped pin vocabulary (F-10). World/glossary entities have none yet. */
export const CHARACTER_PINS = ['Protagonist', 'Antagonist', 'Viewpoint Character'] as const
export type CharacterPin = (typeof CHARACTER_PINS)[number]

/**
 * The tag that makes a document orderable/plottable (F-02/F-03/F-04 filter on
 * this). Not a new BinderNodeType — any document can carry it and keep being
 * treated as an ordinary document everywhere else in the app.
 */
export const SCENE_TAG = 'scene'

export interface DocMeta {
  id: string
  title: string
  label?: string
  status?: DocStatus
  /** Free-form, writer-invented, including `SCENE_TAG`. */
  tags?: string[]
  /** From `DOC_PINS`. */
  pins?: string[]
  /**
   * Position on the F-02 timeline (scene-tagged documents only). A
   * fractional rank — reordering one card never touches any other card's
   * value. Unset until a writer first drags a card; until then the
   * timeline falls back to binder order.
   */
  timelineOrder?: number
  /**
   * Free-form in-world date label ("Year 3, the first thaw"). Not parsed or
   * validated — no calendar system is assumed — so it is shown when set but
   * never governs sort order; `timelineOrder` alone does that.
   */
  timelineDate?: string
  /**
   * F-03: dramatic tension/intensity, 0–10, scene-tagged documents only.
   * Manual — set by dragging a node on the plot graph, never derived from
   * anything. Unset until a writer first drags a scene's node.
   */
  tension?: number
  created: string
  modified: string
}

export interface ProjectData {
  version: 1
  title: string
  binder: BinderNode[]
  trash: BinderNode[]
}

export interface ProjectInfo {
  path: string
  data: ProjectData
}

/** F-24: the home screen's recents list. Title is captured at open time
 *  rather than read live, so a closed project's entry still shows a name
 *  without reopening it just to display a row. */
export interface RecentProject {
  path: string
  title: string
  openedAt: string
}

export interface DocFile {
  meta: DocMeta
  body: string
}

/** The three story-bible flavours. One mechanic, three skins (brief §5). */
export type EntityType = 'glossary' | 'character' | 'world'

export interface Entity {
  id: string
  type: EntityType
  /** Canonical name, e.g. "Elara Voss". */
  name: string
  /** Nicknames, titles, alternate spellings — all auto-link too. */
  aliases: string[]
  /** Free-form definition / bio / description (Markdown). */
  body: string
  /**
   * Free-form, writer-invented (F-10). Factions are not a separate mechanism —
   * a faction is just a tag shared by several entities (e.g. "House Voss").
   */
  tags?: string[]
  /** From `CHARACTER_PINS`. Meaningless and left empty on `world`/`glossary` entities. */
  pins?: string[]
  /**
   * F-13: nesting for `world` entities only (a building inside a
   * neighbourhood inside a city). One field, not a separate hierarchy
   * structure — the tree is reconstructed on the fly by following parent
   * pointers, the same "no second source of truth" reasoning behind every
   * other F-nn this session (tags, pins, plotlines, relationships). Meaningless
   * on `character`/`glossary` entities.
   */
  parentId?: string
  created: string
  modified: string
}

/**
 * F-04: a plotline is a lightweight entity in its own right (name, colour,
 * status) — not a story-bible `Entity` (it never auto-links in prose, which
 * is what `Entity` is fundamentally for) and not just a tag (a tag has
 * nowhere to hang a colour or a status). A scene belongs to a plotline by
 * carrying a `DocMeta.tags` entry equal to the plotline's `name` — the same
 * tag mechanism as everywhere else, just read by name instead of a stored
 * id, so renaming a plotline is a deliberate, visible act (re-tag the
 * scenes) rather than a silent id remap.
 */
export type PlotlineStatus = 'open' | 'resolved'

/** A small, closed set of swatches — not free-color-picker input — so two
 *  plotlines are always visually distinguishable without relying on a
 *  writer's color sense, and so the palette stays finite and printable. */
export const PLOTLINE_COLOURS = [
  '#000000',
  '#8b2e2e',
  '#2e5f8b',
  '#3f7a3f',
  '#8b6f2e',
  '#6a3f8b'
] as const
export type PlotlineColour = (typeof PLOTLINE_COLOURS)[number]

export interface Plotline {
  id: string
  name: string
  colour: string
  /** Manual — set on the plotline itself, not derived from any scene's pins. */
  status: PlotlineStatus
  created: string
  modified: string
}

/**
 * F-11: a character graph edge. Typed and directional — "sibling of" reads
 * differently forwards and backwards, and only a directional edge can
 * answer "who is estranged from whom" rather than just "these two are
 * connected somehow." A new lightweight record, the same shape of decision
 * as F-04's `Plotline`: not a field on `Entity` (which would drift out of
 * sync the moment one side of a two-way relationship is edited without the
 * other), and not a story-bible entity of its own (it never auto-links).
 */
export interface Relationship {
  id: string
  /** Character entity ids — the direction the label reads, `fromId` → `toId`. */
  fromId: string
  toId: string
  /** e.g. "sibling of", "estranged from". Free-form, writer-owned. */
  label: string
  created: string
  modified: string
}

/**
 * F-12: a World Book location's position on the map. One `MapPin` per
 * placed location, not one big map file — the roadmap's standing open
 * question ("a map is spatial data that does not diff or merge as prose
 * does") is answered by not treating it as one file at all: each pin is its
 * own record, the same shape of decision as `Plotline`/`Relationship`, so a
 * sync conflict on one pin's position is an ordinary per-file frontmatter
 * conflict the existing sync engine already resolves, not a new kind of
 * problem. A `world` entity with no `MapPin` simply isn't on the map yet.
 */
export interface MapPin {
  id: string
  entityId: string
  /** Pixel coordinates within the map canvas. */
  x: number
  y: number
  created: string
  modified: string
}

export interface CommitInfo {
  oid: string
  message: string
  /** ms since epoch */
  timestamp: number
}

export interface VariantInfo {
  branch: string
  name: string
  /** ms since epoch */
  createdAt: number
  oid: string
}

/* ---------- Compile / export (brief §8) ---------- */

export type CompileFormat = 'txt' | 'md' | 'docx'

/**
 * A formatted span of manuscript text. Only the three supported marks exist —
 * story-bible auto-links are ProseMirror decorations, never marks, so they
 * cannot reach this model at all (see the house rules).
 */
export interface CompileRun {
  text: string
  bold?: boolean
  italic?: boolean
  highlight?: boolean
}

/** A hard break inside a paragraph (TipTap `hardBreak`). */
export interface CompileBreak {
  break: true
}

export type CompileInline = CompileRun | CompileBreak

/**
 * The compiled manuscript as a flat block list, format-independent. Every
 * output format is a pure function of this — so selection, ordering, and
 * separator logic is written and tested exactly once.
 */
export type CompileBlock =
  | { kind: 'titlePage'; title: string; lines: string[] }
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'separator'; text: string }
  | { kind: 'pageBreak' }
  | { kind: 'paragraph'; runs: CompileInline[] }

export interface CompileOptions {
  format: CompileFormat
  /** Binder document ids to include. Null means every document in the binder. */
  includeIds: string[] | null
  /** Text placed between documents; empty means a blank line only. */
  separator: string
  titlePage: boolean
  docTitles: boolean
  folderTitles: boolean
  /** Only honoured by formats with pages (`docx`). */
  pageBreakBetweenFolders: boolean
}

export interface CompileResult {
  blocks: CompileBlock[]
  /** Prose words only — headings, separators and the title page are excluded,
   *  so this is comparable with the status bar's count. */
  wordCount: number
  /** Number of documents that contributed prose. */
  docCount: number
  /** Text formats only; `docx` output is bytes. */
  text: string
  bytes?: Uint8Array
  extension: string
}

/* ---------- Appearance & page geometry (F-05, F-06) ---------- */

export type AccentTheme = '1bit' | '4bit'

/**
 * Whole-app palette. `paper` is the 1-bit default; `green`/`amber`/`vaporwave`/
 * `virtualwyrm` add CRT glow and scanlines; `ereader`/`night`/`dark`/`halftone`/
 * `blueprint`/`bios`/`collegiate` keep the same strict two-colour discipline
 * as the default, chosen for comfort or period flavour rather than novelty;
 * `ledger`/`arcade` deliberately keep a second highlight colour rather than
 * flattening to monochrome; `famicom` goes further still, breaking the
 * two-colour discipline entirely to run a full roster of real NES-palette
 * colours across ink/paper/accents/highlight (named `famicom` rather than
 * `nes` so it can't collide with the retired I-09 value in old settings
 * files — see the migration note in `main/wyrm/settings.ts`); `win95` keeps
 * a second colour too (teal desktop, silver window chrome, white page) but
 * stays flat-chrome like every palette above — no 3D bevels (F-28).
 */
export type PaletteTheme =
  | 'paper'
  | 'ereader'
  | 'night'
  | 'dark'
  | 'green'
  | 'amber'
  | 'vaporwave'
  | 'halftone'
  | 'ledger'
  | 'arcade'
  | 'blueprint'
  | 'bios'
  | 'collegiate'
  | 'virtualwyrm'
  | 'famicom'
  | 'win95'

export interface AppearanceSettings {
  accents: AccentTheme
  palette: PaletteTheme
  firstLineIndent: boolean
  /** Line measure in characters — the width of the text column. */
  measure: number
  /** Prose size in px. */
  fontSize: number
  /** Prose line height, unitless. */
  lineHeight: number
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  accents: '1bit',
  palette: 'paper',
  firstLineIndent: false,
  measure: 62,
  fontSize: 17,
  lineHeight: 1.7
}

/* ---------- Writing stats (4c, brief §8) ---------- */

/**
 * How "words written today" is measured. The brief warns against making this
 * obnoxiously gamified, and the three modes disagree most on exactly the day
 * that matters: one spent cutting.
 */
export type WordCountMode =
  /** End-of-day total minus yesterday's. A day spent cutting reads negative,
   *  and the app says so rather than flattering the writer. */
  | 'net'
  /** Only additions counted, deletions ignored. Kinder to revision days, but
   *  retyping the same sentence counts every time. */
  | 'added'
  /** Net, floored at zero — a cutting day reads 0 instead of negative. */
  | 'net-positive'

/** One calendar day of writing, derived from git history (main/wyrm/stats.ts). */
export interface DayStat {
  /** Local calendar date, YYYY-MM-DD. */
  date: string
  /** Total manuscript words at this day's last checkpoint. */
  total: number
  /** This day's end-of-day total minus the previous active day's. May be negative. */
  net: number
  /** Sum of the positive per-checkpoint changes within the day. Never negative. */
  added: number
  /** Checkpoints recorded on this day. */
  commits: number
}

export interface StatsSettings {
  /** Words per day the writer is aiming for. */
  dailyGoal: number
  mode: WordCountMode
  /**
   * Whether word counts appear while writing — the editor's header count, the
   * status bar's count, and the today-vs-goal indicator, all together.
   *
   * Off is a real writing preference, not a niche one: a number that ticks up
   * beside the cursor invites watching it instead of the sentence. Turning it
   * off hides the ambient counters only; Writing Stats still reports
   * everything on demand, because choosing not to be watched while drafting
   * is different from not wanting to know.
   */
  showCounter: boolean
}

export const DEFAULT_STATS: StatsSettings = {
  dailyGoal: 500,
  mode: 'net',
  showCounter: true
}

/* ---------- Local backup (F-01) ---------- */

export interface BackupSettings {
  /** Absolute path of the backup repository, or null when none is configured. */
  path: string | null
  /** Mirror automatically after every checkpoint. */
  auto: boolean
  lastBackupAt: number | null
}

export type BackupOutcome =
  | {
      status: 'backed-up'
      objectsCopied: number
      branches: number
      /** Files read back out of the backup to prove the manuscript is recoverable. */
      filesVerified: number
      at: number
    }
  | { status: 'up-to-date'; at: number }
  /** The backup holds work this project does not. Nothing was written. */
  | { status: 'diverged'; branch: string; detail: string }

/* ---------- GitHub sync (Phase 5, brief §7) ---------- */

/** Per-project sync state. `local-only` is an explicit, first-class choice (F-01). */
export interface SyncStatus {
  mode: 'unset' | 'local-only' | 'github'
  remoteUrl: string | null
  /** Signed-in GitHub account (app-level, shared across projects). */
  login: string | null
  /** Whether the OAuth client id has been configured (one-time app setup). */
  clientIdSet: boolean
  lastSyncAt: number | null
  /** Work committed locally that has not reached GitHub yet. */
  pendingSync: boolean
}

/** Device-flow prompt: show the code, send the writer to the URL. */
export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  /** Seconds until the code expires. */
  expiresIn: number
}

export type SignInPoll =
  { state: 'pending' } | { state: 'ok'; login: string } | { state: 'error'; detail: string }

/** One file that changed on both devices in ways that cannot both be kept. */
export interface SyncConflict {
  /** Repo-relative path — the id the resolution answers by. */
  path: string
  kind: 'doc' | 'entity' | 'project' | 'file'
  /** Human name: document title, entity name, or a file label. */
  title: string
  /** Body text on this device; null means it was deleted here. */
  localBody: string | null
  /** Body text on the other device; null means it was deleted there. */
  remoteBody: string | null
}

/** `both` keeps this device's text and shelves the other's as a variant (docs only). */
export type ConflictResolution = 'mine' | 'theirs' | 'both'

export type SyncOutcome =
  | { status: 'up-to-date'; at: number }
  | { status: 'pushed'; at: number }
  | { status: 'pulled'; at: number; pushed: boolean }
  | { status: 'merged'; at: number; pushed: boolean }
  | { status: 'conflicts'; conflicts: SyncConflict[] }
  | { status: 'offline'; detail: string }
  | { status: 'error'; detail: string }

/** API exposed to the renderer over the context bridge. */
export interface WyrmApi {
  /** Show a save dialog and create a fresh .wyrm project. Null if cancelled. */
  createProject(title: string): Promise<ProjectInfo | null>
  /** Show an open dialog and open an existing .wyrm project. Null if cancelled. */
  openProject(): Promise<ProjectInfo | null>
  /** Open a project by path (e.g. the last-used project). Null if missing/invalid. */
  openProjectPath(path: string): Promise<ProjectInfo | null>
  saveProject(path: string, data: ProjectData): Promise<void>
  readDoc(path: string, id: string): Promise<DocFile>
  writeDoc(path: string, doc: DocFile): Promise<void>
  /** Stage everything and commit if anything changed. Returns true if a commit was made. */
  commit(path: string, message: string): Promise<boolean>
  getLastProjectPath(): Promise<string | null>
  /** F-24: most-recent first, for the home screen's recents list. */
  getRecentProjects(): Promise<RecentProject[]>
  /** F-24: clears the auto-reopen pointer. The project stays in recentProjects. */
  closeProject(): Promise<void>

  /** Commit history, newest first; docId scopes it to one document's file. */
  log(path: string, docId?: string): Promise<CommitInfo[]>
  /** A document as it existed at a commit oid or branch ref. Null if absent. */
  readDocAtRef(path: string, id: string, ref: string): Promise<DocFile | null>
  /** Restore a doc to its state at a ref, as a new commit (safety commit first). */
  restoreDocToRef(path: string, id: string, ref: string, label: string): Promise<DocFile>
  createVariant(path: string, docId: string, name: string): Promise<VariantInfo>
  listVariants(path: string, docId: string): Promise<VariantInfo[]>
  deleteVariant(path: string, branch: string): Promise<void>

  /** Every story-bible entry across all three types. */
  listEntities(path: string): Promise<Entity[]>
  writeEntity(path: string, entity: Entity): Promise<void>
  deleteEntity(path: string, type: EntityType, id: string): Promise<void>
  /** All documents with metadata — used to compute backlinks. */
  readAllDocs(path: string): Promise<DocFile[]>

  /** F-04: plotlines. Scenes belong to one by tag (see `Plotline`'s doc comment). */
  listPlotlines(path: string): Promise<Plotline[]>
  writePlotline(path: string, plotline: Plotline): Promise<void>
  deletePlotline(path: string, id: string): Promise<void>

  /** F-11: character graph edges. */
  listRelationships(path: string): Promise<Relationship[]>
  writeRelationship(path: string, relationship: Relationship): Promise<void>
  deleteRelationship(path: string, id: string): Promise<void>

  /** F-12: world map pin placements. */
  listMapPins(path: string): Promise<MapPin[]>
  writeMapPin(path: string, pin: MapPin): Promise<void>
  deleteMapPin(path: string, id: string): Promise<void>

  /** Show a save dialog and write compiled output. Returns the path, or null if cancelled. */
  exportFile(defaultName: string, data: string | Uint8Array): Promise<string | null>

  /** Appearance is app-level, not per-project — it follows the writer. */
  getAppearance(): Promise<AppearanceSettings>
  setAppearance(patch: Partial<AppearanceSettings>): Promise<AppearanceSettings>

  /** Daily goal and counting mode — app-level, like appearance. */
  getStatsSettings(): Promise<StatsSettings>
  setStatsSettings(patch: Partial<StatsSettings>): Promise<StatsSettings>
  /** Per-day writing history for a project, oldest first, derived from its
   *  git history. Checkpoints first so uncommitted work is included. */
  getDailyStats(path: string): Promise<DayStat[]>

  getBackupSettings(path: string): Promise<BackupSettings>
  /** Pick a backup location for this project. Null if cancelled. */
  chooseBackupLocation(path: string): Promise<BackupSettings | null>
  setBackupAuto(path: string, auto: boolean): Promise<BackupSettings>
  clearBackupLocation(path: string): Promise<BackupSettings>
  /** Checkpoint, then mirror this project into its backup repository. */
  backupNow(path: string): Promise<BackupOutcome>
  /** Pick a backup and a destination, then open the restored project. Null if cancelled. */
  restoreFromBackup(): Promise<ProjectInfo | null>

  getSyncStatus(path: string): Promise<SyncStatus>
  /** One-time app setup: the GitHub OAuth app's client id (public, not a secret). */
  setSyncClientId(path: string, clientId: string): Promise<SyncStatus>
  /** Begin the GitHub device flow. */
  signInStart(): Promise<DeviceCodeInfo>
  /** Poll for the device-flow result; call every few seconds until not pending. */
  signInPoll(): Promise<SignInPoll>
  signOut(path: string): Promise<SyncStatus>
  /** Connect this project: create a private repository, or use a pasted URL. */
  connectSync(
    path: string,
    options: { create: boolean; name?: string; url?: string }
  ): Promise<SyncStatus>
  disconnectSync(path: string): Promise<SyncStatus>
  /** Record "keep everything local" as a deliberate choice (F-01). */
  setLocalOnly(path: string): Promise<SyncStatus>
  syncNow(path: string): Promise<SyncOutcome>
  resolveSyncConflicts(
    path: string,
    choices: { path: string; resolution: ConflictResolution }[]
  ): Promise<SyncOutcome>
}
