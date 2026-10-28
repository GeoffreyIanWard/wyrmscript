import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import type { BackupTarget } from '../src/shared/types'
import { backupNameFor, backupProject, restoreBackup } from '../src/main/wyrm/backup'
import { commitAll } from '../src/main/wyrm/git'
import { createProject, readDoc, writeDoc } from '../src/main/wyrm/project'
import { checkSaveLocations } from '../src/main/wyrm/saveCheck'
import { firstDoc } from '../src/renderer/src/lib/tree'

/**
 * F-50 step 2: which save locations hold the latest save point, asked of the
 * repositories themselves against real ones on disk. A timestamp comparison
 * in the renderer drew envelopes filled for copies that did not have the
 * work, because the main process commits on its own (before a sync, before
 * reading stats) and the renderer never hears of it.
 */

const tmpDirs: string[] = []

async function tmp(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

async function makeProject(): Promise<{ dir: string; docId: string }> {
  const dir = join(await tmp('wyrm-check-src-'), 'Winter.wyrm')
  await fsp.mkdir(dir, { recursive: true })
  const info = await createProject(dir, 'Winter')
  return { dir, docId: firstDoc(info.data.binder)!.id }
}

/** A save point the renderer never hears about, as the main process makes them. */
async function commitBehindTheRenderersBack(
  dir: string,
  docId: string,
  body: string
): Promise<void> {
  const doc = await readDoc(dir, docId)
  await writeDoc(dir, { meta: doc.meta, body })
  await commitAll(dir, 'Autosave')
}

async function target(dir: string, id: string): Promise<BackupTarget> {
  return { id, path: join(await tmp('wyrm-check-dst-'), backupNameFor(dir)), lastBackupAt: null }
}

async function head(dir: string): Promise<string> {
  return git.resolveRef({ fs, dir, ref: 'HEAD' })
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('a drive', () => {
  it('holds the save point once backed up, and loses it at the next one', async () => {
    const { dir, docId } = await makeProject()
    const card = await target(dir, 'card')
    await backupProject(dir, card.path)
    expect(await checkSaveLocations(dir, [card], false)).toEqual({
      unreachable: [],
      behind: [],
      diverged: []
    })

    await commitBehindTheRenderersBack(dir, docId, 'Three new paragraphs.\n')
    expect(await checkSaveLocations(dir, [card], false)).toEqual({
      unreachable: [],
      behind: ['card'],
      diverged: []
    })
  })

  it('counts a drive never written to as behind', async () => {
    const { dir } = await makeProject()
    const card = await target(dir, 'card')
    expect((await checkSaveLocations(dir, [card], false)).behind).toEqual(['card'])
  })

  it('calls a drive that is not there missing, not behind', async () => {
    const { dir } = await makeProject()
    const gone: BackupTarget = {
      id: 'gone',
      path: join(await tmp('wyrm-check-x-'), 'NO_CARD', 'Winter.wyrm.git'),
      lastBackupAt: 1
    }
    expect(await checkSaveLocations(dir, [gone], false)).toEqual({
      unreachable: ['gone'],
      behind: [],
      diverged: []
    })
  })

  it('answers for each drive separately', async () => {
    const { dir, docId } = await makeProject()
    const card = await target(dir, 'card')
    const drive = await target(dir, 'drive')
    await backupProject(dir, card.path)
    await commitBehindTheRenderersBack(dir, docId, 'More.\n')
    await backupProject(dir, drive.path)
    expect((await checkSaveLocations(dir, [card, drive], false)).behind).toEqual(['card'])
  })
})

describe('a drive another computer backed up to', () => {
  it('is diverged, not merely behind, and a backup leaves it alone', async () => {
    const { dir, docId } = await makeProject()
    const card = await target(dir, 'card')
    await backupProject(dir, card.path)
    // The other computer: restored from the same card, written on, backed up.
    const other = join(await tmp('wyrm-check-other-'), 'Winter.wyrm')
    await restoreBackup(card.path, other)
    await commitBehindTheRenderersBack(other, docId, 'Written on the other computer.\n')
    await backupProject(other, card.path)
    // And this one writes too.
    await commitBehindTheRenderersBack(dir, docId, 'Written here.\n')

    expect(await checkSaveLocations(dir, [card], false)).toEqual({
      unreachable: [],
      behind: ['card'],
      diverged: ['card']
    })
    const refused = await backupProject(dir, card.path)
    expect(refused.status).toBe('diverged')
  })

  it('is only behind when all its work is already here', async () => {
    const { dir, docId } = await makeProject()
    const card = await target(dir, 'card')
    await backupProject(dir, card.path)
    await commitBehindTheRenderersBack(dir, docId, 'Only here.\n')
    expect((await checkSaveLocations(dir, [card], false)).diverged).toEqual([])
  })
})

describe('GitHub', () => {
  it('holds the save point when the last push or fetch left it there', async () => {
    const { dir, docId } = await makeProject()
    await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: await head(dir) })
    expect((await checkSaveLocations(dir, [], true)).behind).toEqual([])

    // A save point that has not gone up: GitHub no longer holds the latest.
    await commitBehindTheRenderersBack(dir, docId, 'Not pushed yet.\n')
    expect((await checkSaveLocations(dir, [], true)).behind).toEqual(['github'])
  })

  it('holds it when GitHub is ahead, with this device behind it', async () => {
    const { dir, docId } = await makeProject()
    const before = await head(dir)
    await commitBehindTheRenderersBack(dir, docId, 'From the other device.\n')
    // GitHub has the newer commit; this device's HEAD is the older one.
    await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: await head(dir) })
    await git.writeRef({ fs, dir, ref: 'refs/heads/main', value: before, force: true })
    expect((await checkSaveLocations(dir, [], true)).behind).toEqual([])
  })

  it('counts GitHub never reached as behind', async () => {
    const { dir } = await makeProject()
    expect((await checkSaveLocations(dir, [], true)).behind).toEqual(['github'])
  })

  it('says nothing about GitHub for a project not linked to it', async () => {
    const { dir } = await makeProject()
    expect((await checkSaveLocations(dir, [], false)).behind).toEqual([])
  })
})
