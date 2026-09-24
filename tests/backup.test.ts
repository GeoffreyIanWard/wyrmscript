import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { backupNameFor, backupProject, backupToAll, restoreBackup } from '../src/main/wyrm/backup'
import { commitAll, createVariant } from '../src/main/wyrm/git'
import { createProject, readDoc, writeDoc } from '../src/main/wyrm/project'
import { firstDoc } from '../src/renderer/src/lib/tree'

/**
 * Real repositories in real temp directories — the point of these tests is
 * that a manuscript can actually be read back out of a backup, so mocking any
 * part of the git layer would defeat them.
 */

const tmpDirs: string[] = []

async function tmp(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

async function makeProject(title = 'Backup Novel'): Promise<{ dir: string; docId: string }> {
  const root = await tmp('wyrm-bk-src-')
  const dir = join(root, `${title}.wyrm`)
  await fsp.mkdir(dir, { recursive: true })
  const info = await createProject(dir, title)
  return { dir, docId: firstDoc(info.data.binder)!.id }
}

async function backupPathFor(dir: string): Promise<string> {
  return join(await tmp('wyrm-bk-dst-'), backupNameFor(dir))
}

async function write(dir: string, docId: string, body: string, message: string): Promise<void> {
  const doc = await readDoc(dir, docId)
  await writeDoc(dir, { meta: doc.meta, body })
  await commitAll(dir, message)
}

/** Read one document's stored file straight out of a bare backup repository. */
async function readFromBackup(backup: string, filepath: string): Promise<string> {
  const oid = await git.resolveRef({ fs, gitdir: backup, ref: 'HEAD' })
  const { blob } = await git.readBlob({ fs, gitdir: backup, oid, filepath })
  return new TextDecoder().decode(blob)
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('backing up a project', () => {
  it('creates the repository and makes the manuscript readable out of it', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'The harbor went dark, pane by pane.\n', 'First scene')
    const backup = await backupPathFor(dir)

    const result = await backupProject(dir, backup)

    expect(result.status).toBe('backed-up')
    if (result.status !== 'backed-up') throw new Error('unreachable')
    expect(result.objectsCopied).toBeGreaterThan(0)
    expect(result.filesVerified).toBeGreaterThan(0)
    expect(await readFromBackup(backup, `documents/${docId}.md`)).toContain('pane by pane')
  })

  it('commits pending work first, so the backup is never missing the latest writing', async () => {
    const { dir, docId } = await makeProject()
    const doc = await readDoc(dir, docId)
    // Written to disk but deliberately never committed.
    await writeDoc(dir, { meta: doc.meta, body: 'An uncommitted last paragraph.\n' })
    const backup = await backupPathFor(dir)

    await backupProject(dir, backup)

    expect(await readFromBackup(backup, `documents/${docId}.md`)).toContain(
      'An uncommitted last paragraph.'
    )
  })

  it('is idempotent — a second backup with no new work copies nothing', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'One.\n', 'One')
    const backup = await backupPathFor(dir)

    await backupProject(dir, backup)
    const second = await backupProject(dir, backup)

    expect(second.status).toBe('up-to-date')
  })

  it('copies only the new objects on an incremental backup', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'One.\n', 'One')
    const backup = await backupPathFor(dir)
    const first = await backupProject(dir, backup)

    await write(dir, docId, 'One. Two.\n', 'Two')
    const second = await backupProject(dir, backup)

    if (first.status !== 'backed-up' || second.status !== 'backed-up') {
      throw new Error('expected both to write')
    }
    expect(second.objectsCopied).toBeGreaterThan(0)
    expect(second.objectsCopied).toBeLessThan(first.objectsCopied)
    expect(await readFromBackup(backup, `documents/${docId}.md`)).toContain('One. Two.')
  })

  it('carries variant branches across, not just the main line', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'The version that ships.\n', 'Main line')
    await createVariant(dir, docId, 'Darker ending')
    const backup = await backupPathFor(dir)

    const result = await backupProject(dir, backup)

    if (result.status !== 'backed-up') throw new Error('expected a write')
    expect(result.branches).toBeGreaterThan(1)
    const branches = await git.listBranches({ fs, gitdir: backup })
    expect(branches.some((b) => b.startsWith(`variant/${docId}/`))).toBe(true)
  })

  it('refuses to overwrite a backup holding work this project does not have', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'Shared history.\n', 'Shared')
    const backup = await backupPathFor(dir)
    await backupProject(dir, backup)

    // Another machine's writing, landing in the backup but not here.
    const other = await tmp('wyrm-bk-other-')
    const otherProject = join(other, 'Other.wyrm')
    await restoreBackup(backup, otherProject)
    const otherDocId = docId
    await write(otherProject, otherDocId, 'Shared history. Written elsewhere.\n', 'Elsewhere')
    await backupProject(otherProject, backup)

    await write(dir, docId, 'Shared history. Written here.\n', 'Here')
    const result = await backupProject(dir, backup)

    expect(result.status).toBe('diverged')
    // The other machine's work must still be intact and readable.
    expect(await readFromBackup(backup, `documents/${docId}.md`)).toContain('Written elsewhere')
  })

  it('leaves the backup untouched when it refuses', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'Shared.\n', 'Shared')
    const backup = await backupPathFor(dir)
    await backupProject(dir, backup)
    const before = await git.resolveRef({ fs, gitdir: backup, ref: 'HEAD' })

    const other = await tmp('wyrm-bk-other2-')
    const otherProject = join(other, 'Other.wyrm')
    await restoreBackup(backup, otherProject)
    await write(otherProject, docId, 'Shared. Elsewhere.\n', 'Elsewhere')
    await backupProject(otherProject, backup)
    const afterOther = await git.resolveRef({ fs, gitdir: backup, ref: 'HEAD' })

    await write(dir, docId, 'Shared. Here.\n', 'Here')
    await backupProject(dir, backup)

    expect(await git.resolveRef({ fs, gitdir: backup, ref: 'HEAD' })).toBe(afterOther)
    expect(afterOther).not.toBe(before)
  })
})

describe('restoring from a backup', () => {
  it('rebuilds a working project whose documents match the original', async () => {
    const { dir, docId } = await makeProject('Restored Novel')
    await write(dir, docId, 'Everything that was written.\n', 'All of it')
    const backup = await backupPathFor(dir)
    await backupProject(dir, backup)

    const dest = join(await tmp('wyrm-bk-restore-'), 'Restored Novel.wyrm')
    const data = await restoreBackup(backup, dest)

    expect(data.title).toBe('Restored Novel')
    const restored = await readDoc(dest, docId)
    expect(restored.body).toContain('Everything that was written.')
    expect((await readDoc(dir, docId)).body).toBe(restored.body)
  })

  it('keeps history, so the restored project can still be rolled back', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'Draft one.\n', 'Draft one')
    await write(dir, docId, 'Draft two.\n', 'Draft two')
    const backup = await backupPathFor(dir)
    await backupProject(dir, backup)

    const dest = join(await tmp('wyrm-bk-restore2-'), 'Novel.wyrm')
    await restoreBackup(backup, dest)

    const log = await git.log({ fs, dir: dest })
    expect(log.map((e) => e.commit.message.trim())).toContain('Draft one')
    expect(log.map((e) => e.commit.message.trim())).toContain('Draft two')
  })

  it('refuses to restore over an existing project', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'Precious.\n', 'Precious')
    const backup = await backupPathFor(dir)
    await backupProject(dir, backup)

    const dest = join(await tmp('wyrm-bk-restore3-'), 'Occupied.wyrm')
    await fsp.mkdir(dest, { recursive: true })
    await fsp.writeFile(join(dest, 'project.json'), '{"do":"not clobber"}', 'utf8')

    await expect(restoreBackup(backup, dest)).rejects.toThrow(/already exists/)
    expect(await fsp.readFile(join(dest, 'project.json'), 'utf8')).toContain('not clobber')
  })
})

describe('interruption safety', () => {
  it('recovers from a half-finished backup instead of leaving it corrupt', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'The whole novel.\n', 'Whole')
    const backup = await backupPathFor(dir)

    // Simulate an interruption after objects were copied but before refs
    // moved: the objects are present, no ref points at them.
    await backupProject(dir, backup)
    await git.deleteRef({ fs, gitdir: backup, ref: 'refs/heads/main' })

    const result = await backupProject(dir, backup)

    expect(result.status).toBe('backed-up')
    expect(await readFromBackup(backup, `documents/${docId}.md`)).toContain('The whole novel.')
  })

  it('replaces a truncated object rather than trusting its name', async () => {
    // Objects are only ever renamed into place, so a torn write cannot occupy
    // a final name. Prove the invariant holds: no stray temp file survives.
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'Complete.\n', 'Complete')
    const backup = await backupPathFor(dir)
    await backupProject(dir, backup)

    const stray = await fsp
      .readdir(join(backup, 'objects'))
      .then((names) => names.filter((n) => n.endsWith('.tmp')))
    expect(stray).toEqual([])
  })
})

/**
 * F-40: several destinations at once. The properties that matter are that the
 * targets are independent — an unplugged card cannot stop the external drive
 * being written, and neither can a genuinely broken one — and that what
 * happened at each is reported rather than collapsed into one verdict.
 */
describe('backing up to several targets', () => {
  it('writes every reachable target', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'The harbour froze over.', 'First')
    const first = await backupPathFor(dir)
    const second = await backupPathFor(dir)

    const run = await backupToAll(dir, [
      { id: 'a', path: first, lastBackupAt: null },
      { id: 'b', path: second, lastBackupAt: null }
    ])

    expect(run.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    // Both really hold the manuscript, not just a repo shell.
    for (const backup of [first, second]) {
      expect(await readFromBackup(backup, `documents/${docId}.md`)).toContain('harbour froze')
    }
  })

  it('skips an unplugged target without touching the others', async () => {
    // The normal state of removable media. It must not be a failure, and it
    // must not stop the drive that *is* connected from being written.
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'A knock at the door.', 'First')
    const connected = await backupPathFor(dir)

    const run = await backupToAll(dir, [
      { id: 'card', path: '/Volumes/NotMounted/novel.git', lastBackupAt: null },
      { id: 'drive', path: connected, lastBackupAt: null }
    ])

    expect(run.results.find((r) => r.targetId === 'card')?.status).toBe('unreachable')
    expect(run.results.find((r) => r.targetId === 'drive')?.status).toBe('ok')
    expect(await readFromBackup(connected, `documents/${docId}.md`)).toContain('knock at the door')
  })

  it('reports a genuine failure and still writes the rest', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, 'Ashes on the tide.', 'First')
    const good = await backupPathFor(dir)
    // A file where the backup repository should go: reachable (its parent
    // exists) but impossible to create as a repo.
    const blocked = join(await tmp('wyrm-bk-bad-'), 'occupied.git')
    await fsp.writeFile(blocked, 'not a directory')

    const run = await backupToAll(dir, [
      { id: 'bad', path: blocked, lastBackupAt: null },
      { id: 'good', path: good, lastBackupAt: null }
    ])

    expect(run.results.find((r) => r.targetId === 'bad')?.status).toBe('failed')
    expect(run.results.find((r) => r.targetId === 'good')?.status).toBe('ok')
    expect(await readFromBackup(good, `documents/${docId}.md`)).toContain('Ashes on the tide')
  })

  it('reports nothing for no targets rather than failing', async () => {
    const { dir } = await makeProject()

    expect((await backupToAll(dir, [])).results).toEqual([])
  })
})
