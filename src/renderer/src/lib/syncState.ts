import type { BackupSettings, SyncStatus } from '../../../shared/types'

/**
 * F-01: one definition of "is this project actually connected to a remote",
 * and one definition of "does a second copy exist anywhere".
 *
 * These predicates exist because the surfaces disagreed. `mode` is a stored
 * intent ("the writer chose GitHub") while `remoteUrl` is read live from
 * `.git/config` — so they can drift apart, and a project whose remote was
 * removed outside the app kept `mode: 'github'` with no `remoteUrl`. The menu
 * gated Sync Now on `mode` alone and left it live; the status bar read `mode`
 * alone and reported `◆ SYNCED`; only SyncDialog required both and correctly
 * showed the reconnect form. So the app simultaneously claimed the work was
 * safely synced and had no idea where to send it — the worst possible
 * arrangement for an app whose promise is that nothing is ever lost.
 *
 * Anything answering "can we sync / is the work off this machine" must use
 * these rather than testing `mode` by hand.
 */

/** A remote we could actually push to right now. */
export function isConnected(status: SyncStatus | null | undefined): boolean {
  return status?.mode === 'github' && status.remoteUrl != null
}

/**
 * True when the writer meant to be on GitHub but the remote has gone missing.
 * Distinct from local-only: it is not a choice, it is a broken connection, and
 * it should read as one rather than as a quiet local project.
 */
export function isRemoteMissing(status: SyncStatus | null | undefined): boolean {
  return status?.mode === 'github' && status.remoteUrl == null
}

/**
 * Whether any copy exists beyond the working project folder. Deliberately
 * counts a backup path the same as a remote: what matters for "could a dead
 * disk take this" is that a second copy exists, not which mechanism made it.
 * A backup folder on the *same* disk still fails that test, which the UI text
 * says out loud — we cannot tell from a path which physical drive it is on.
 */
export function hasSecondCopy(
  status: SyncStatus | null | undefined,
  backup: BackupSettings | null | undefined
): boolean {
  if (backup == null) return isConnected(status)
  return isConnected(status) || backup.targets.length > 0
}
