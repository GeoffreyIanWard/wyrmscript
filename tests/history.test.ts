import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import {
  commitAll,
  createVariant,
  deleteVariant,
  listVariants,
  logCommits
} from '../src/main/wyrm/git'
import {
  createProject,
  docRepoPath,
  readDoc,
  readDocAtRef,
  restoreDocToRef,
  writeDoc
} from '../src/main/wyrm/project'
import { firstDoc } from '../src/renderer/src/lib/tree'

const tmpDirs: string[] = []

async function makeProject(): Promise<{ dir: string; docId: string }> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-hist-'))
  tmpDirs.push(dir)
  const info = await createProject(dir, 'History Novel')
  return { dir, docId: firstDoc(info.data.binder)!.id }
}

async function writeAndCommit(
  dir: string,
  docId: string,
  body: string,
  message: string
): Promise<void> {
  const doc = await readDoc(dir, docId)
  await writeDoc(dir, { meta: doc.meta, body })
  await commitAll(dir, message)
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('logCommits', () => {
  it('lists commits newest first, optionally filtered to one file', async () => {
    const { dir, docId } = await makeProject()
    await writeAndCommit(dir, docId, 'Draft one.', 'First draft')
    await writeAndCommit(dir, docId, 'Draft two.', 'Second draft')

    const all = await logCommits(dir)
    expect(all.map((c) => c.message)).toEqual([
      'Second draft',
      'First draft',
      'Create project “History Novel”'
    ])

    const scoped = await logCommits(dir, docRepoPath(docId))
    expect(scoped.length).toBeGreaterThanOrEqual(3) // created + two edits
    expect(scoped[0].message).toBe('Second draft')
    expect(scoped[0].timestamp).toBeGreaterThan(0)
  })
})

describe('readDocAtRef / restoreDocToRef', () => {
  it('reads historical content and restores it as a new commit', async () => {
    const { dir, docId } = await makeProject()
    await writeAndCommit(dir, docId, 'The original opening line.', 'First draft')
    const firstOid = (await logCommits(dir))[0].oid
    await writeAndCommit(dir, docId, 'A heavily rewritten opening.', 'Rewrite')

    const historical = await readDocAtRef(dir, docId, firstOid)
    expect(historical?.body.trim()).toBe('The original opening line.')

    const before = (await logCommits(dir)).length
    const restored = await restoreDocToRef(dir, docId, firstOid, 'Restore first draft')
    expect(restored.body.trim()).toBe('The original opening line.')
    expect((await readDoc(dir, docId)).body.trim()).toBe('The original opening line.')

    const log = await logCommits(dir)
    expect(log[0].message).toBe('Restore first draft')
    // Non-destructive: history only grew (restore commit; safety commit only
    // if the tree was dirty), and the rewrite is still reachable.
    expect(log.length).toBeGreaterThan(before)
    expect(log.some((c) => c.message === 'Rewrite')).toBe(true)
  })

  it('safety-commits pending changes before restoring', async () => {
    const { dir, docId } = await makeProject()
    await writeAndCommit(dir, docId, 'Committed text.', 'First draft')
    const firstOid = (await logCommits(dir))[0].oid

    // Uncommitted change sitting in the working tree:
    const doc = await readDoc(dir, docId)
    await writeDoc(dir, { meta: doc.meta, body: 'Uncommitted masterpiece.' })

    await restoreDocToRef(dir, docId, firstOid, 'Back to committed text')
    const log = await logCommits(dir)
    expect(log[0].message).toBe('Back to committed text')
    expect(log[1].message).toBe('Auto: before restore')

    // The uncommitted text is preserved inside the safety commit.
    const saved = await readDocAtRef(dir, docId, log[1].oid)
    expect(saved?.body.trim()).toBe('Uncommitted masterpiece.')
  })

  it('returns null for a doc that does not exist at a ref', async () => {
    const { dir } = await makeProject()
    const head = (await logCommits(dir))[0].oid
    expect(await readDocAtRef(dir, 'nonexistent', head)).toBeNull()
  })
})

describe('variants', () => {
  it('creates, lists, reads, adopts, and deletes snapshot variants', async () => {
    const { dir, docId } = await makeProject()
    await writeAndCommit(dir, docId, 'The hopeful ending.', 'Hopeful ending')

    const variant = await createVariant(dir, docId, 'Hopeful Ending')
    expect(variant.branch).toBe(`variant/${docId}/hopeful-ending`)

    // Keep writing on the main line.
    await writeAndCommit(dir, docId, 'The bleak ending.', 'Bleak rewrite')

    const variants = await listVariants(dir, docId)
    expect(variants).toHaveLength(1)
    expect(variants[0].name).toBe('hopeful ending')

    const snapshot = await readDocAtRef(dir, docId, variants[0].branch)
    expect(snapshot?.body.trim()).toBe('The hopeful ending.')

    // Adopt = restore to the branch ref.
    await restoreDocToRef(dir, docId, variants[0].branch, 'Adopt “Hopeful Ending”')
    expect((await readDoc(dir, docId)).body.trim()).toBe('The hopeful ending.')

    await deleteVariant(dir, variants[0].branch)
    expect(await listVariants(dir, docId)).toHaveLength(0)
    // Repo stays healthy after branch deletion.
    expect(await git.listBranches({ fs, dir })).toEqual(['main'])
  })

  it('disambiguates variant slugs on name collision', async () => {
    const { dir, docId } = await makeProject()
    const first = await createVariant(dir, docId, 'Take Two')
    const second = await createVariant(dir, docId, 'Take Two')
    expect(first.branch).not.toBe(second.branch)
    expect(await listVariants(dir, docId)).toHaveLength(2)
  })
})
