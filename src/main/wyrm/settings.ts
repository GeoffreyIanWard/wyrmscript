import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

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
