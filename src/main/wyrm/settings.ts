import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

import type {
  AppearanceSettings,
  PrintSettings,
  RecentProject,
  StatsSettings
} from '../../shared/types'
import { DEFAULT_APPEARANCE, DEFAULT_PRINT, DEFAULT_STATS } from '../../shared/types'
import { randomUUID } from 'node:crypto'
import type { BackupSettings, BackupTarget } from '../../shared/types'

/** F-24: how many recently-opened projects the home screen offers. */
const RECENT_PROJECTS_LIMIT = 8

/** Per-project sync bookkeeping. The remote URL itself lives in .git/config. */
export interface SyncProjectSettings {
  mode: 'unset' | 'local-only' | 'github'
  lastSyncAt: number | null
  pendingSync: boolean
}

interface AppSettings {
  lastProjectPath?: string
  /** Backup configuration per project path — different novels, different drives. */
  backups?: Record<string, BackupSettings>
  /** GitHub OAuth app client id — public identifier, one-time app setup. */
  syncClientId?: string
  /** OAuth token, safeStorage-encrypted when the OS keychain is available. */
  githubToken?: string
  githubLogin?: string
  syncProjects?: Record<string, SyncProjectSettings>
  /** Palette, accents and page geometry — app-level, follows the writer. */
  appearance?: Partial<AppearanceSettings>
  /** Daily goal and counting mode. App-level like appearance: a writing habit
   *  belongs to the writer, not to one manuscript. The counts themselves are
   *  not stored here — they are derived from each project's git history. */
  stats?: Partial<StatsSettings>
  /** F-38: auto-print and the chosen printer — app-level, like appearance. */
  print?: Partial<PrintSettings>
  /** F-24: most-recent first, capped at RECENT_PROJECTS_LIMIT. Outlives
   *  `lastProjectPath` being cleared on close — closing a project removes it
   *  from auto-reopen, not from the list a writer picks it back up from. */
  recentProjects?: RecentProject[]
}

const NO_BACKUP: BackupSettings = { targets: [], auto: false }
const NO_SYNC: SyncProjectSettings = { mode: 'unset', lastSyncAt: null, pendingSync: false }

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export async function readSettings(): Promise<AppSettings> {
  try {
    return JSON.parse(await fsp.readFile(settingsFile(), 'utf8')) as AppSettings
  } catch {
    return {}
  }
}

export async function writeSettings(patch: Partial<AppSettings>): Promise<void> {
  const current = await readSettings()
  await fsp.writeFile(settingsFile(), JSON.stringify({ ...current, ...patch }, null, 2), 'utf8')
}

export async function readAppearance(): Promise<AppearanceSettings> {
  const settings = await readSettings()
  // Merged over the defaults rather than replacing them, so a settings file
  // written by an older build keeps working when new fields appear.
  const appearance = { ...DEFAULT_APPEARANCE, ...settings.appearance }
  // I-09: 'nes' briefly meant the red-on-near-black CRT palette, now called
  // Virtual Wyrm — the genuine NES palette added afterward is 'famicom'
  // instead, precisely so this value stays retired and safe to remap.
  if ((settings.appearance?.palette as string | undefined) === 'nes') {
    appearance.palette = 'virtualwyrm'
  }
  return appearance
}

export async function writeAppearance(
  patch: Partial<AppearanceSettings>
): Promise<AppearanceSettings> {
  const next = { ...(await readAppearance()), ...patch }
  await writeSettings({ appearance: next })
  return next
}

export async function readStatsSettings(): Promise<StatsSettings> {
  const settings = await readSettings()
  return { ...DEFAULT_STATS, ...settings.stats }
}

export async function writeStatsSettings(patch: Partial<StatsSettings>): Promise<StatsSettings> {
  const next = { ...(await readStatsSettings()), ...patch }
  await writeSettings({ stats: next })
  return next
}

export async function readPrintSettings(): Promise<PrintSettings> {
  const settings = await readSettings()
  return { ...DEFAULT_PRINT, ...settings.print }
}

export async function writePrintSettings(patch: Partial<PrintSettings>): Promise<PrintSettings> {
  const next = { ...(await readPrintSettings()), ...patch }
  await writeSettings({ print: next })
  return next
}

export async function readSyncProject(projectPath: string): Promise<SyncProjectSettings> {
  const settings = await readSettings()
  return settings.syncProjects?.[projectPath] ?? NO_SYNC
}

export async function writeSyncProject(
  projectPath: string,
  patch: Partial<SyncProjectSettings>
): Promise<SyncProjectSettings> {
  const settings = await readSettings()
  const next: SyncProjectSettings = {
    ...NO_SYNC,
    ...settings.syncProjects?.[projectPath],
    ...patch
  }
  await writeSettings({ syncProjects: { ...settings.syncProjects, [projectPath]: next } })
  return next
}

/**
 * The single-target shape this setting had before F-40. Read, never written.
 */
interface LegacyBackupSettings {
  path?: string | null
  auto?: boolean
  lastBackupAt?: number | null
}

/**
 * Upgrades a pre-F-40 backup setting in place. Migration happens on read
 * rather than in a one-shot pass because there is no moment we control when
 * every project's settings are loaded — a writer may open a project that has
 * not been touched since before the upgrade, months from now.
 *
 * Losing a configured backup location here would quietly leave a project with
 * no second copy while the app still claimed one existed, so the legacy path
 * is carried over with its last-backup time intact rather than being reset.
 */
function migrate(stored: (BackupSettings & LegacyBackupSettings) | undefined): BackupSettings {
  if (stored == null) return NO_BACKUP
  if (Array.isArray(stored.targets)) {
    return { targets: stored.targets, auto: stored.auto ?? false }
  }
  const targets: BackupTarget[] =
    typeof stored.path === 'string' && stored.path.length > 0
      ? [{ id: randomUUID(), path: stored.path, lastBackupAt: stored.lastBackupAt ?? null }]
      : []
  return { targets, auto: stored.auto ?? false }
}

export async function readBackupSettings(projectPath: string): Promise<BackupSettings> {
  const settings = await readSettings()
  return migrate(settings.backups?.[projectPath])
}

export async function writeBackupSettings(
  projectPath: string,
  patch: Partial<BackupSettings>
): Promise<BackupSettings> {
  const settings = await readSettings()
  // Migrate before patching, so a patch landing on a legacy record does not
  // drop the target it already had.
  const next: BackupSettings = { ...migrate(settings.backups?.[projectPath]), ...patch }
  await writeSettings({ backups: { ...settings.backups, [projectPath]: next } })
  return next
}

/** Replaces one target's fields, leaving every other target untouched. */
export async function updateBackupTarget(
  projectPath: string,
  targetId: string,
  patch: Partial<Omit<BackupTarget, 'id'>>
): Promise<BackupSettings> {
  const current = await readBackupSettings(projectPath)
  return writeBackupSettings(projectPath, {
    targets: current.targets.map((t) => (t.id === targetId ? { ...t, ...patch } : t))
  })
}

export async function addBackupTarget(projectPath: string, path: string): Promise<BackupSettings> {
  const current = await readBackupSettings(projectPath)
  // Adding a location twice would mirror to it twice per checkpoint and show
  // it twice in the panel; treat a repeat add as a no-op.
  if (current.targets.some((t) => t.path === path)) return current
  return writeBackupSettings(projectPath, {
    targets: [...current.targets, { id: randomUUID(), path, lastBackupAt: null }]
  })
}

export async function removeBackupTarget(
  projectPath: string,
  targetId: string
): Promise<BackupSettings> {
  const current = await readBackupSettings(projectPath)
  return writeBackupSettings(projectPath, {
    targets: current.targets.filter((t) => t.id !== targetId)
  })
}

export async function readRecentProjects(): Promise<RecentProject[]> {
  const settings = await readSettings()
  return settings.recentProjects ?? []
}

/** F-24: called on every successful open/create — moves `path` to the front,
 *  refreshing its title in case the project was renamed since. */
export async function touchRecentProject(path: string, title: string): Promise<void> {
  const settings = await readSettings()
  const rest = (settings.recentProjects ?? []).filter((p) => p.path !== path)
  const next: RecentProject[] = [
    { path, title, openedAt: new Date().toISOString() },
    ...rest
  ].slice(0, RECENT_PROJECTS_LIMIT)
  await writeSettings({ recentProjects: next })
}

/** F-24: a project deleted or moved from disk drops off the list the next
 *  time it fails to open, rather than sitting there as a dead row forever. */
export async function removeRecentProject(path: string): Promise<void> {
  const settings = await readSettings()
  await writeSettings({
    recentProjects: (settings.recentProjects ?? []).filter((p) => p.path !== path)
  })
}
