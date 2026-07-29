import fs from 'node:fs'
import git from 'isomorphic-git'

const author = { name: 'Wyrmscript', email: 'wyrmscript@local' }

export async function initRepo(dir: string): Promise<void> {
  await git.init({ fs, dir, defaultBranch: 'main' })
}

/**
 * Stage every change in the working tree (adds, edits, deletes) and commit.
 * No-op when the tree is clean. Returns true if a commit was created.
 */
export async function commitAll(dir: string, message: string): Promise<boolean> {
  // statusMatrix rows: [filepath, HEAD (0|1), workdir (0|1|2), stage (0..3)];
  // [f, 1, 1, 1] means unchanged.
  const matrix = await git.statusMatrix({ fs, dir })
  const dirty = matrix.filter(
    ([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1)
  )
  if (dirty.length === 0) return false
  for (const [filepath, , workdir] of dirty) {
    if (workdir === 0) {
      await git.remove({ fs, dir, filepath })
    } else {
      await git.add({ fs, dir, filepath })
    }
  }
  await git.commit({ fs, dir, message, author })
  return true
}
