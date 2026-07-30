export type BinderNodeType = 'folder' | 'doc'

export interface BinderNode {
  id: string
  type: BinderNodeType
  title: string
  children?: BinderNode[]
}

export type DocStatus = 'draft' | 'revised' | 'final'

export interface DocMeta {
  id: string
  title: string
  label?: string
  status?: DocStatus
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
 * Whole-app palette. `paper` is the 1-bit default; `green`/`amber` add the
 * CRT glow and scanlines; the rest are comfort variants — same strict
 * two-colour discipline, chosen to be easy on the eyes rather than
 * period-accurate.
 */
export type PaletteTheme = 'paper' | 'ereader' | 'night' | 'dark' | 'green' | 'amber'

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

  /** Show a save dialog and write compiled output. Returns the path, or null if cancelled. */
  exportFile(defaultName: string, data: string | Uint8Array): Promise<string | null>

  /** Appearance is app-level, not per-project — it follows the writer. */
  getAppearance(): Promise<AppearanceSettings>
  setAppearance(patch: Partial<AppearanceSettings>): Promise<AppearanceSettings>

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
