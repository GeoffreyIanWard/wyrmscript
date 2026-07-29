import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

interface AppSettings {
  lastProjectPath?: string
}

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
