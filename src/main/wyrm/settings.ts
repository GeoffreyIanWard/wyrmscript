import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

import type { AppearanceSettings, StatsSettings } from '../../shared/types'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../../shared/types'
import type { BackupSettings } from '../../shared/types'

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
}

const NO_BACKUP: BackupSettings = { path: null, auto: false, lastBackupAt: null }
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

export async function readBackupSettings(projectPath: string): Promise<BackupSettings> {
  const settings = await readSettings()
  return settings.backups?.[projectPath] ?? NO_BACKUP
}

export async function writeBackupSettings(
  projectPath: string,
  patch: Partial<BackupSettings>
): Promise<BackupSettings> {
  const settings = await readSettings()
  const next: BackupSettings = { ...NO_BACKUP, ...settings.backups?.[projectPath], ...patch }
  await writeSettings({ backups: { ...settings.backups, [projectPath]: next } })
  return next
}
