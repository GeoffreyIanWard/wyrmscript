import fs from 'node:fs'
import { join } from 'node:path'
import git from 'isomorphic-git'
import type { BackupTarget, SaveCheck } from '../../shared/types'
import { unreachableTargets } from './backup'

/** Where the last fetch or push left GitHub's copy of the sync branch. */
const REMOTE_REF = 'refs/remotes/origin/main'

async function resolve(gitdir: string, ref: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs, gitdir, ref })
  } catch {
    return null
  }
}

/** True when `oid` is HEAD or a descendant of it, i.e. it holds HEAD's work. */
async function holds(gitdir: string, oid: string | null, head: string): Promise<boolean> {
  if (oid == null) return false
  if (oid === head) return true
  try {
    return await git.isDescendent({ fs, gitdir, oid, ancestor: head, depth: -1 })
  } catch {
    // An object this repository does not have: it cannot be holding HEAD.
    return false
  }
}

/**
 * F-50 step 2: for the status line's envelopes, which locations cannot be
 * reached, and which do not yet hold the latest save point.
 *
 * Answered from the repositories rather than from timestamps. The renderer's
 * "last save point" time only moves for commits it made itself, and the main
 * process commits on its own (before a sync, before reading stats), and a
 * pull brings in commits with another device's times — so a timestamp
 * comparison drew envelopes filled for copies that did not have the work.
 *
 * A drive holds the save point when its branch of the same name is HEAD or
 * ahead of it. GitHub holds it when the tracking ref the last fetch or push
 * left behind is — as of the last time GitHub was reached, which is the most
 * the app can know without asking it. A drive that cannot be reached is
 * reported missing, not behind.
 */
export async function checkSaveLocations(
  projectPath: string,
  targets: BackupTarget[],
  hasGithub: boolean
): Promise<SaveCheck> {
  const unreachable = await unreachableTargets(targets)
  const gitdir = join(projectPath, '.git')
  const head = await resolve(gitdir, 'HEAD')
  // No save point yet: nothing holds one, and the renderer says so already.
  if (head == null) return { unreachable, behind: [] }
  const branch = (await git.currentBranch({ fs, gitdir, fullname: true }).catch(() => null)) ?? null
  const behind: string[] = []
  for (const target of targets) {
    if (unreachable.includes(target.id)) continue
    const theirs = branch ? await resolve(target.path, branch) : null
    // Their commit may not be in this repository (a backup ahead of it is
    // "diverged" and was left alone), so ask the backup, which has both if
    // it holds HEAD at all.
    if (!(await holds(target.path, theirs, head))) behind.push(target.id)
  }
  if (hasGithub && !(await holds(gitdir, await resolve(gitdir, REMOTE_REF), head))) {
    behind.push('github')
  }
  return { unreachable, behind }
}
