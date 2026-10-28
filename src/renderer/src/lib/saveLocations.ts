import type { BackupSettings, SyncStatus } from '../../../shared/types'
import { isConnected, isRemoteMissing } from './syncState'

/**
 * F-50: the places a project is kept, as the Save to drawer shows them — one
 * card each, the first the default.
 *
 * Three kinds, from three stores that already existed: the project's own
 * folder (always there on a computer, and never removable, because the app
 * writes to it as the writer types), each backup target (F-40), and the
 * GitHub copy (Phase 5). Only the order is new, kept in `BackupSettings.order`.
 */
export type SaveLocation =
  | { id: 'folder'; kind: 'folder'; path: string; lastSavedAt: number | null }
  | { id: string; kind: 'disk'; path: string; lastSavedAt: number | null }
  | { id: 'github'; kind: 'github'; remoteUrl: string | null; lastSavedAt: number | null }

/** Including the project's own folder. Kept small so the drawer stays readable. */
export const MAX_LOCATIONS = 3

export const FOLDER_ID = 'folder'
export const GITHUB_ID = 'github'

/**
 * Every location, in the writer's order. A location the order does not name
 * (new, or never reordered) goes after the named ones, in the natural order:
 * folder, disks as added, GitHub. An id in the order that is no longer a
 * location is skipped — a target removed elsewhere must not leave a hole.
 *
 * GitHub counts once the project means to sync (`mode: 'github'`), connected
 * or not: a remote that vanished from .git/config is a broken location the
 * writer has to see, not one that silently stops existing.
 */
export function saveLocations(
  projectPath: string,
  lastCheckpointAt: number | null,
  backup: BackupSettings | null,
  sync: SyncStatus | null
): SaveLocation[] {
  const all: SaveLocation[] = [
    { id: FOLDER_ID, kind: 'folder', path: projectPath, lastSavedAt: lastCheckpointAt }
  ]
  for (const target of backup?.targets ?? []) {
    all.push({ id: target.id, kind: 'disk', path: target.path, lastSavedAt: target.lastBackupAt })
  }
  if (sync?.mode === 'github') {
    all.push({
      id: GITHUB_ID,
      kind: 'github',
      remoteUrl: sync.remoteUrl,
      lastSavedAt: sync.lastSyncAt
    })
  }
  const order = backup?.order ?? []
  const rank = (id: string): number => {
    const at = order.indexOf(id)
    return at === -1 ? order.length : at
  }
  // A stable sort, so unnamed locations keep their natural order among themselves.
  return all
    .map((location, natural) => ({ location, natural }))
    .sort((a, b) => rank(a.location.id) - rank(b.location.id) || a.natural - b.natural)
    .map(({ location }) => location)
}

/** The project's own folder is never removed; every other card can be. */
export function isRemovable(location: SaveLocation): boolean {
  return location.kind !== 'folder'
}

/** The order after moving one card to `to` (clamped), as ids, default first. */
export function moveLocation(locations: SaveLocation[], id: string, to: number): string[] {
  const ids = locations.map((l) => l.id)
  const from = ids.indexOf(id)
  if (from === -1) return ids
  const target = Math.max(0, Math.min(ids.length - 1, to))
  ids.splice(from, 1)
  ids.splice(target, 0, id)
  return ids
}

/**
 * What turning "Save to multiple locations" off removes: every card but the
 * default — except the project's own folder, which is never removed. So with
 * GitHub as the default, the folder stays beside it.
 */
export function removedBySingle(locations: SaveLocation[]): SaveLocation[] {
  return locations.slice(1).filter(isRemovable)
}

/**
 * The toggle says what is true: on whenever there is more than one card,
 * including the project's own folder sitting beside a GitHub or drive
 * default, which turning it off cannot remove.
 */
export function savesToMultiple(locations: SaveLocation[]): boolean {
  return locations.length > 1
}

/**
 * Why a location cannot be reached right now, in the writer's words, or null
 * when nothing is known to be wrong. The drawer shows "Broken connection!"
 * with this as the explanation on hover.
 *
 * `unreachable` is the set of target ids the main process could not reach
 * (an unmounted volume answers no for both the path and its parent).
 */
export function brokenReason(
  location: SaveLocation,
  sync: SyncStatus | null,
  unreachable: readonly string[],
  syncFailed: boolean
): string | null {
  if (location.kind === 'disk') {
    return unreachable.includes(location.id) ? 'Drive not connected' : null
  }
  if (location.kind === 'github') {
    if (isRemoteMissing(sync)) return 'This project lost its link to GitHub'
    if (sync?.login == null) return 'Signed out of GitHub'
    if (isConnected(sync) && syncFailed) return 'GitHub unreachable'
  }
  return null
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago". */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const mins = Math.floor((now - timestamp) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** The card's name and second line. Never says "git" or "repository". */
export function describeLocation(location: SaveLocation): { name: string; detail: string } {
  if (location.kind === 'folder') return { name: 'This computer', detail: location.path }
  if (location.kind === 'disk') return { name: driveName(location.path), detail: location.path }
  return {
    name: 'GitHub',
    detail: location.remoteUrl?.replace(/^https?:\/\//, '').replace(/\.git$/, '') ?? 'Not linked'
  }
}

/**
 * A short name for the drive a backup is on: the volume on a Mac
 * (`/Volumes/CARD/…`), the drive letter on Windows (`E:\…`), else "Disk".
 */
export function driveName(path: string): string {
  const mac = /^\/Volumes\/([^/]+)/.exec(path)
  if (mac) return mac[1]
  const win = /^([A-Za-z]):[\\/]/.exec(path)
  if (win) return `Drive ${win[1].toUpperCase()}:`
  return 'Disk'
}
