import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { commitAll } from '../src/main/wyrm/git'
import { createProject, openProject, readDoc, writeDoc } from '../src/main/wyrm/project'
import { firstDoc } from '../src/renderer/src/lib/tree'

const tmpDirs: string[] = []

async function makeProject(): Promise<{ dir: string; docId: string }> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-test-'))
  tmpDirs.push(dir)
  const info = await createProject(dir, 'Test Novel')
  const doc = firstDoc(info.data.binder)!
  return { dir, docId: doc.id }
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('createProject', () => {
  it('creates the .wyrm structure with an initial commit', async () => {
    const { dir, docId } = await makeProject()
    await expect(fsp.stat(join(dir, 'project.json'))).resolves.toBeTruthy()
    await expect(fsp.stat(join(dir, 'documents', `${docId}.md`))).resolves.toBeTruthy()
    await expect(fsp.stat(join(dir, '.gitignore'))).resolves.toBeTruthy()
    const log = await git.log({ fs, dir })
    expect(log).toHaveLength(1)
    expect(log[0].commit.message).toContain('Test Novel')
  })

  it('openProject round-trips the project data', async () => {
    const { dir } = await makeProject()
    const info = await openProject(dir)
    expect(info.data.title).toBe('Test Novel')
    expect(info.data.version).toBe(1)
    expect(info.data.binder.map((n) => n.title)).toEqual(['Manuscript', 'Notes'])
    expect(info.data.trash).toEqual([])
  })
})

describe('doc read/write', () => {
  it('round-trips meta and body, updating the modified timestamp', async () => {
    const { dir, docId } = await makeProject()
    const before = await readDoc(dir, docId)
    expect(before.meta.id).toBe(docId)
    expect(before.meta.status).toBe('draft')

    await new Promise((r) => setTimeout(r, 5))
    await writeDoc(dir, { meta: before.meta, body: 'It was a dark and **stormy** night.' })
    const after = await readDoc(dir, docId)
    // Bodies are canonically newline-terminated on disk.
    expect(after.body).toBe('It was a dark and **stormy** night.\n')
    expect(after.meta.title).toBe(before.meta.title)
    expect(Date.parse(after.meta.modified)).toBeGreaterThan(Date.parse(before.meta.modified))
  })

  it('round-trips tags and pins (F-10)', async () => {
    const { dir, docId } = await makeProject()
    const before = await readDoc(dir, docId)
    await writeDoc(dir, {
      meta: { ...before.meta, tags: ['scene', 'chapter-one'], pins: ['Climax'] },
      body: before.body
    })
    const after = await readDoc(dir, docId)
    expect(after.meta.tags).toEqual(['scene', 'chapter-one'])
    expect(after.meta.pins).toEqual(['Climax'])
  })
})

describe('commitAll', () => {
  it('commits edits, is a no-op when clean, and commits deletions', async () => {
    const { dir, docId } = await makeProject()

    const doc = await readDoc(dir, docId)
    await writeDoc(dir, { meta: doc.meta, body: 'Edited.' })
    await expect(commitAll(dir, 'Edit')).resolves.toBe(true)
    expect(await git.log({ fs, dir })).toHaveLength(2)

    await expect(commitAll(dir, 'Nothing changed')).resolves.toBe(false)
    expect(await git.log({ fs, dir })).toHaveLength(2)

    await fsp.rm(join(dir, 'documents', `${docId}.md`))
    await expect(commitAll(dir, 'Delete doc')).resolves.toBe(true)
    const log = await git.log({ fs, dir })
    expect(log).toHaveLength(3)
    expect(log[0].commit.message).toContain('Delete doc')
  })
})
