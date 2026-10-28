import type { BackupSettings, SyncStatus } from '../../../shared/types'
import { guessRemovable } from '../../../shared/removable'
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
  | { id: string; kind: 'disk'; path: string; lastSavedAt: number | null; removable: boolean }
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
    all.push({
      id: target.id,
      kind: 'disk',
      path: target.path,
      lastSavedAt: target.lastBackupAt,
      // Targets added before F-50 step 4 have no answer stored: guess.
      removable: target.removable ?? guessRemovable(target.path)
    })
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

/**
 * The project's own folder is never removed; every other card can be. (Not
 * to be confused with a *removable drive*: that is `removable` on a disk.)
 */
export function canBeRemoved(location: SaveLocation): boolean {
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
  return locations.slice(1).filter(canBeRemoved)
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
 * `syncProblem` is the store's account of the last sync that could not reach
 * GitHub. Conflicts are deliberately not a reason: GitHub was reached, and
 * the writer has passages to resolve, not a connection to fix.
 */
export function brokenReason(
  location: SaveLocation,
  sync: SyncStatus | null,
  unreachable: readonly string[],
  syncProblem: string | null
): string | null {
  if (location.kind === 'disk') {
    if (!unreachable.includes(location.id)) return null
    // A card out of its slot is ordinary; a drive that should always be
    // there and is not is something to look into.
    return location.removable ? 'Drive not connected' : 'Drive not found'
  }
  if (location.kind === 'github') {
    if (isRemoteMissing(sync)) return 'This project lost its link to GitHub'
    if (sync?.login == null) return 'Signed out of GitHub'
    if (isConnected(sync) && syncProblem != null) return syncProblem
  }
  return null
}

/**
 * F-50 step 2: how one location's envelope is drawn in the status line.
 *
 * - `saving`: being written right now. It fills in when the write finishes.
 * - `missing`: a drive that is not connected. Dashed, and quiet: an unplugged
 *   card is the normal state of removable media, never an alarm (F-40).
 * - `attention`: something the writer has to act on. The line ends in "!".
 * - `behind`: reachable, but without the latest save point yet.
 * - `saved`: holds the latest save point. Filled.
 */
export type EnvelopeState = 'saving' | 'missing' | 'attention' | 'behind' | 'saved'

export interface EnvelopeContext {
  sync: SyncStatus | null
  unreachable: readonly string[]
  /** Locations that do not hold the latest save point (the store's `behind`). */
  behind: readonly string[]
  /** Drives holding work this project does not have (the store's `diverged`). */
  diverged: readonly string[]
  syncProblem: string | null
  /** Conflicts waiting for the writer (the store's `syncNeedsAttention`). */
  syncNeedsAttention: boolean
  savingTo: readonly string[]
}

export function envelopeOf(
  location: SaveLocation,
  ctx: EnvelopeContext
): { state: EnvelopeState; reason: string | null } {
  if (ctx.savingTo.includes(location.id)) return { state: 'saving', reason: 'Saving…' }
  const broken = brokenReason(location, ctx.sync, ctx.unreachable, ctx.syncProblem)
  // Quiet for a removable drive, as F-40 always treated an unplugged card;
  // a fixed drive gone missing needs the writer.
  if (location.kind === 'disk' && broken && location.removable)
    return { state: 'missing', reason: broken }
  if (broken) return { state: 'attention', reason: broken }
  if (location.kind === 'github' && ctx.syncNeedsAttention)
    return { state: 'attention', reason: 'Some passages need your eye' }
  // A drive another computer backed up to: a backup will never write over
  // it, so it needs the writer, not time.
  if (ctx.diverged.includes(location.id)) return { state: 'attention', reason: DIVERGED }
  if (location.lastSavedAt == null) return { state: 'behind', reason: 'Not saved here yet' }
  // Asked of the repositories, not worked out from times: the renderer does
  // not hear of every save point (see `checkSaveLocations`).
  if (ctx.behind.includes(location.id) || (location.kind === 'github' && ctx.sync?.pendingSync))
    return { state: 'behind', reason: 'Not up to date with the last save' }
  return { state: 'saved', reason: null }
}

/**
 * F-50 step 4: said as a removable drive is added, or a drive is marked
 * removable — once, as it happens, rather than on the card for good.
 */
export function removableWarning(name: string): string {
  return `${name} is removable: saves skip it whenever it is not plugged in, and its card shows when it was last written.`
}

/** Why a diverged drive is left alone, and what to do about it. */
export const DIVERGED =
  'Holds work this project does not have, so it was left untouched. Restore it to a new project to compare.'

/**
 * F-50 step 5: whether sync conflicts are waiting for the writer. The store's
 * `syncNeedsAttention` also goes up when a sync throws, and that is a
 * connection problem (`syncProblem`), not passages to choose between.
 */
export function conflictsWaiting(
  syncNeedsAttention: boolean,
  syncProblem: string | null,
  waitingConflicts: readonly unknown[] | null
): boolean {
  return (waitingConflicts?.length ?? 0) > 0 || (syncNeedsAttention && syncProblem == null)
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
