import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import git from 'isomorphic-git'
import type { CommitInfo, VariantInfo } from '../../shared/types'

export const author = { name: 'WyrmStar', email: 'wyrmstar@local' }

export async function initRepo(dir: string): Promise<void> {
  await git.init({ fs, dir, defaultBranch: 'main' })
}

/**
 * Stage every change in the working tree (adds, edits, deletes) and commit.
 * No-op when the tree is clean. Returns true if a commit was created.
 *
 * Change detection is content-exact (blob hashes against HEAD), not
 * stat-based: statusMatrix alone can miss an edit when the new content has
 * the same byte length and lands within the same mtime second — the classic
 * "racy git" case, and an unacceptable failure mode for an app whose whole
 * point is that no version is ever lost.
 */
export async function commitAll(dir: string, message: string): Promise<boolean> {
  const changed = await stageAllChanges(dir)
  if (!changed) return false
  await git.commit({ fs, dir, message, author })
  return true
}

/** Stage every working-tree change with the hash-exact walk. True if anything changed. */
export async function stageAllChanges(dir: string): Promise<boolean> {
  // statusMatrix rows: [filepath, HEAD (0|1), workdir (0|1|2), stage (0..3)]
  const matrix = await git.statusMatrix({ fs, dir })
  const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => null)
  let changed = false

  for (const [filepath, head, workdir] of matrix) {
    if (workdir === 0) {
      await git.remove({ fs, dir, filepath })
      if (head !== 0) changed = true
      continue
    }
    const content = await fsp.readFile(join(dir, filepath))
    const { oid } = await git.hashBlob({ object: content })
    let headBlobOid: string | null = null
    if (head === 1 && headOid) {
      headBlobOid = await git
        .readBlob({ fs, dir, oid: headOid, filepath })
        .then((b) => b.oid)
        .catch(() => null)
    }
    if (oid !== headBlobOid) {
      await git.add({ fs, dir, filepath })
      changed = true
    }
  }

  return changed
}

/**
 * Commit the working tree as a merge with explicit parents. Unlike commitAll
 * this commits even when the tree is byte-identical to HEAD's — a resolution
 * of "keep everything mine" still has to record that the other parent's
 * history has been incorporated, or the two lines would diverge forever.
 */
export async function commitMerge(
  dir: string,
  message: string,
  parents: string[]
): Promise<string> {
  await stageAllChanges(dir)
  return git.commit({ fs, dir, message, author, parent: parents })
}

/** Commit history, newest first — optionally only commits touching one file. */
export async function logCommits(
  dir: string,
  filepath?: string,
  depth = 500
): Promise<CommitInfo[]> {
  try {
    const entries = await git.log({
      fs,
      dir,
      depth,
      ...(filepath ? { filepath, force: true } : {})
    })
    return entries.map((e) => ({
      oid: e.oid,
      message: e.commit.message.trim(),
      timestamp: e.commit.committer.timestamp * 1000
    }))
  } catch {
    return [] // fresh repo with no commits, or file absent from all history
  }
}

/** File content at a commit (or any ref). Null if the file didn't exist there. */
export async function readFileAtRef(
  dir: string,
  ref: string,
  filepath: string
): Promise<string | null> {
  try {
    const oid = await git.resolveRef({ fs, dir, ref })
    const { blob } = await git.readBlob({ fs, dir, oid, filepath })
    return new TextDecoder().decode(blob)
  } catch {
    return null
  }
}

/* ---------- variants: frozen snapshots as branches ---------- */

const variantPrefix = (docId: string): string => `variant/${docId}/`

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'variant'
}

/**
 * Snapshot the current state to a variant branch for one document.
 * The caller is responsible for flushing unsaved edits first; any pending
 * working-tree changes are committed so the branch captures what's on screen.
 */
export async function createVariant(
  dir: string,
  docId: string,
  name: string
): Promise<VariantInfo> {
  await commitAll(dir, `Snapshot for variant “${name}”`)
  const existing = await git.listBranches({ fs, dir })
  let slug = slugify(name)
  for (let n = 2; existing.includes(variantPrefix(docId) + slug); n++) {
    slug = `${slugify(name)}-${n}`
  }
  const ref = variantPrefix(docId) + slug
  await git.branch({ fs, dir, ref, checkout: false })
  const oid = await git.resolveRef({ fs, dir, ref })
  return { branch: ref, name, createdAt: Date.now(), oid }
}

export async function listVariants(dir: string, docId: string): Promise<VariantInfo[]> {
  const branches = await git.listBranches({ fs, dir })
  const variants: VariantInfo[] = []
  for (const branch of branches.filter((b) => b.startsWith(variantPrefix(docId)))) {
    const oid = await git.resolveRef({ fs, dir, ref: branch })
    const { commit } = await git.readCommit({ fs, dir, oid })
    variants.push({
      branch,
      name: branch.slice(variantPrefix(docId).length).replace(/-/g, ' '),
      createdAt: commit.committer.timestamp * 1000,
      oid
    })
  }
  return variants.sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteVariant(dir: string, branch: string): Promise<void> {
  await git.deleteBranch({ fs, dir, ref: branch })
}
