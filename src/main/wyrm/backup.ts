import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import git from 'isomorphic-git'
import type { BackupOutcome, ProjectData } from '../../shared/types'
import { commitAll } from './git'

/**
 * Local backup: mirror a project's git history into a second repository on
 * disk (an external drive, a synced folder, another machine's share). Local
 * history protects against editing mistakes; only an off-machine copy
 * protects against a dead disk (F-01).
 *
 * **Why this is hand-rolled plumbing rather than `git push`.** isomorphic-git
 * has no local transport — `push` requires an HTTP client, and both
 * `file:///path` and a bare path fail with MissingParameterError. Shelling out
 * to system git would break the brief's §10 decision to require no git
 * install. So the mirror is done the way git's own "dumb" transport does it:
 * copy the objects, then move the refs.
 *
 * Three properties make that safe, and none of them are optional:
 *
 * 1. **Objects are copied before refs are moved.** Interrupted halfway, the
 *    backup holds some unreferenced objects (harmless garbage) while its refs
 *    still describe a complete, older history. The reverse order would leave a
 *    ref pointing at a missing object — a corrupt repository.
 * 2. **Every object is written to a temp path and renamed into place.** A torn
 *    write sitting at its final name would be treated as "already present" by
 *    every later backup, so the corruption would be permanent and silent.
 *    Object files are immutable and content-addressed, so rename is atomic and
 *    re-copying is always safe.
 * 3. **Fast-forward only.** If the backup contains commits this project does
 *    not, that is someone else's writing and the backup is left untouched.
 *    Nothing here ever deletes a ref or an object.
 */

const BACKUP_COMMIT_MESSAGE = 'Auto: before backup'

/** Git directory of a normal project; the backup itself is bare. */
function gitDirOf(projectPath: string): string {
  return join(projectPath, '.git')
}

async function exists(path: string): Promise<boolean> {
  try {
    await fsp.stat(path)
    return true
  } catch {
    return false
  }
}

/** Suggested backup repository path for a project — a sibling of the picked folder. */
export function backupNameFor(projectPath: string): string {
  return `${basename(projectPath).replace(/\.wyrm$/, '')}.wyrm.git`
}

async function ensureBareRepo(backupPath: string): Promise<void> {
  if (await exists(join(backupPath, 'objects'))) return
  await fsp.mkdir(backupPath, { recursive: true })
  await git.init({ fs, bare: true, gitdir: backupPath, defaultBranch: 'main' })
}

/**
 * Copy every object the target lacks. Objects are immutable and named by
 * content hash, so this is idempotent and order-independent among themselves.
 */
async function copyMissingObjects(srcGitDir: string, dstGitDir: string): Promise<number> {
  const srcObjects = join(srcGitDir, 'objects')
  const dstObjects = join(dstGitDir, 'objects')
  // One fixed staging path, reused per object — this is what git itself does
  // with its `tmp_obj_*` files, and a leftover is inert rather than corrupt.
  const staging = join(dstObjects, 'incoming.tmp')
  await fsp.mkdir(dstObjects, { recursive: true })
  let copied = 0

  const walk = async (relative: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fsp.readdir(join(srcObjects, relative), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = relative ? join(relative, entry.name) : entry.name
      if (entry.isDirectory()) {
        // `objects/info` describes *this* repository's packs; copying it would
        // advertise packs the backup may not have.
        if (rel === 'info') continue
        await walk(rel)
        continue
      }
      if (entry.name.endsWith('.tmp')) continue
      const target = join(dstObjects, rel)
      if (await exists(target)) continue
      await fsp.mkdir(dirname(target), { recursive: true })
      await fsp.copyFile(join(srcObjects, rel), staging)
      await fsp.rename(staging, target)
      copied++
    }
  }

  await walk('')
  await fsp.rm(staging, { force: true })
  return copied
}

/**
 * Can `to` be reached from `from` without losing history? False whenever the
 * backup holds commits this project cannot see, which is the one case where
 * overwriting would destroy prose.
 */
async function isFastForward(srcGitDir: string, from: string, to: string): Promise<boolean> {
  if (from === to) return true
  try {
    return await git.isDescendent({ fs, gitdir: srcGitDir, oid: to, ancestor: from, depth: -1 })
  } catch {
    return false
  }
}

/**
 * Read the manuscript back out of the backup. Resolving a ref only proves the
 * tip commit landed; listing and reading every file at that commit proves the
 * novel itself is recoverable, which is the only claim worth making.
 */
async function verifyReadable(backupPath: string, oid: string): Promise<number> {
  const files = await git.listFiles({ fs, gitdir: backupPath, ref: oid })
  for (const filepath of files) {
    await git.readBlob({ fs, gitdir: backupPath, oid, filepath })
  }
  return files.length
}

/**
 * Mirror a project into its backup repository. Commits any pending work first,
 * so the backup can never be missing the last few minutes of writing.
 */
export async function backupProject(
  projectPath: string,
  backupPath: string
): Promise<BackupOutcome> {
  await commitAll(projectPath, BACKUP_COMMIT_MESSAGE)
  const srcGitDir = gitDirOf(projectPath)
  await ensureBareRepo(backupPath)

  const branches = await git.listBranches({ fs, gitdir: srcGitDir })
  const wanted: { ref: string; oid: string }[] = []
  for (const branch of branches) {
    wanted.push({
      ref: `refs/heads/${branch}`,
      oid: await git.resolveRef({ fs, gitdir: srcGitDir, ref: `refs/heads/${branch}` })
    })
  }
  if (wanted.length === 0) throw new Error('This project has no history to back up yet.')

  // Refuse the whole backup if any branch diverged — a partial mirror would
  // leave the backup describing two different stories.
  for (const { ref, oid } of wanted) {
    const existing = await git
      .resolveRef({ fs, gitdir: backupPath, ref })
      .catch(() => null as string | null)
    if (existing && !(await isFastForward(srcGitDir, existing, oid))) {
      return {
        status: 'diverged',
        branch: ref.replace('refs/heads/', ''),
        detail:
          'The backup contains work this project does not have. Nothing was changed — restore it to a new project to compare.'
      }
    }
  }

  const stale = await Promise.all(
    wanted.map(async ({ ref, oid }) => {
      const existing = await git
        .resolveRef({ fs, gitdir: backupPath, ref })
        .catch(() => null as string | null)
      return existing !== oid
    })
  )
  const at = Date.now()
  if (!stale.some(Boolean)) return { status: 'up-to-date', at }

  const objectsCopied = await copyMissingObjects(srcGitDir, backupPath)

  for (const { ref, oid } of wanted) {
    await git.writeRef({ fs, gitdir: backupPath, ref, value: oid, force: true })
  }
  const head = await git.currentBranch({ fs, gitdir: srcGitDir, fullname: true })
  if (head) {
    await git.writeRef({
      fs,
      gitdir: backupPath,
      ref: 'HEAD',
      value: head,
      symbolic: true,
      force: true
    })
  }

  const headOid = head ? await git.resolveRef({ fs, gitdir: backupPath, ref: head }) : wanted[0].oid
  const filesVerified = await verifyReadable(backupPath, headOid)

  return { status: 'backed-up', objectsCopied, branches: wanted.length, filesVerified, at }
}

/**
 * Materialize a backup repository into a new project folder. Always writes to
 * a fresh directory — restoring can never overwrite an existing project, so a
 * mistaken restore costs disk space rather than a manuscript.
 */
export async function restoreBackup(backupPath: string, destPath: string): Promise<ProjectData> {
  if (await exists(destPath)) {
    const entries = await fsp.readdir(destPath).catch(() => [])
    if (entries.length > 0)
      throw new Error(`${basename(destPath)} already exists and is not empty.`)
  }
  await fsp.mkdir(destPath, { recursive: true })
  await git.init({ fs, dir: destPath, defaultBranch: 'main' })

  const destGitDir = gitDirOf(destPath)
  await copyMissingObjects(backupPath, destGitDir)

  const branches = await git.listBranches({ fs, gitdir: backupPath })
  if (branches.length === 0) throw new Error('That backup has no history in it.')
  for (const branch of branches) {
    const ref = `refs/heads/${branch}`
    const oid = await git.resolveRef({ fs, gitdir: backupPath, ref })
    await git.writeRef({ fs, gitdir: destGitDir, ref, value: oid, force: true })
  }

  const head =
    (await git.currentBranch({ fs, gitdir: backupPath, fullname: true })) ??
    `refs/heads/${branches[0]}`
  await git.writeRef({
    fs,
    gitdir: destGitDir,
    ref: 'HEAD',
    value: head,
    symbolic: true,
    force: true
  })
  await git.checkout({ fs, dir: destPath, ref: head.replace('refs/heads/', ''), force: true })

  const raw = await fsp.readFile(join(destPath, 'project.json'), 'utf8').catch(() => null)
  if (raw == null) throw new Error('That backup does not contain a WyrmStar project.')
  return JSON.parse(raw) as ProjectData
}
