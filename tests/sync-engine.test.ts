import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import type { Entity, SyncOutcome } from '../src/shared/types'
import {
  PushRejectedError,
  resolveSyncConflicts,
  syncProject,
  type SyncTransport
} from '../src/main/wyrm/sync'
import { restoreBackup } from '../src/main/wyrm/backup'
import { commitAll, listVariants } from '../src/main/wyrm/git'
import {
  createProject,
  readDoc,
  readDocAtRef,
  saveProject,
  writeDoc
} from '../src/main/wyrm/project'
import { deleteEntity, listEntities, writeEntity } from '../src/main/wyrm/entities'
import { findNode, firstDoc } from '../src/renderer/src/lib/tree'

/**
 * The engine runs against real repositories with a transport faked over a
 * bare repo on disk — the same seam production binds to HTTP. Everything the
 * transport does not do (classify, merge, materialize, commit, reconcile) is
 * therefore exercised for real. "Device B" is cloned with restoreBackup,
 * which is itself the shipped restore path.
 */

const tmpDirs: string[] = []

async function tmp(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

async function copyObjects(fromGitDir: string, toGitDir: string): Promise<void> {
  await fsp.cp(join(fromGitDir, 'objects'), join(toGitDir, 'objects'), {
    recursive: true,
    force: false,
    errorOnExist: false
  })
}

interface FakeTransport extends SyncTransport {
  setOffline(down: boolean): void
  remoteGitDir: string
}

/** A "GitHub" that is just a bare repository on disk. */
function fakeTransport(remoteGitDir: string): FakeTransport {
  let offline = false
  return {
    remoteGitDir,
    setOffline(down: boolean): void {
      offline = down
    },
    async fetchMainHead(dir: string): Promise<string | null> {
      if (offline) throw new Error('fetch failed: network is down')
      const oid = await git
        .resolveRef({ fs, gitdir: remoteGitDir, ref: 'refs/heads/main' })
        .catch(() => null)
      if (oid) {
        await copyObjects(remoteGitDir, join(dir, '.git'))
        await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: oid, force: true })
      }
      return oid
    },
    async push(dir: string, refs: string[]): Promise<void> {
      if (offline) throw new Error('fetch failed: network is down')
      for (const ref of refs) {
        const local = await git.resolveRef({ fs, dir, ref })
        const existing = await git.resolveRef({ fs, gitdir: remoteGitDir, ref }).catch(() => null)
        if (existing && existing !== local) {
          const ff = await git
            .isDescendent({ fs, dir, oid: local, ancestor: existing, depth: -1 })
            .catch(() => false)
          if (!ff) throw new PushRejectedError(`non-fast-forward on ${ref}`)
        }
        await copyObjects(join(dir, '.git'), remoteGitDir)
        await git.writeRef({ fs, gitdir: remoteGitDir, ref, value: local, force: true })
      }
    }
  }
}

interface World {
  a: string
  docId: string
  transport: FakeTransport
}

/** Device A with a pushed first draft, and the bare "GitHub" beside it. */
async function makeWorld(body = 'Base paragraph.\n'): Promise<World> {
  const a = join(await tmp('wyrm-sync-a-'), 'Novel.wyrm')
  await fsp.mkdir(a, { recursive: true })
  const info = await createProject(a, 'Sync Novel')
  const docId = firstDoc(info.data.binder)!.id
  const doc = await readDoc(a, docId)
  await writeDoc(a, { meta: doc.meta, body })
  await commitAll(a, 'First draft')

  const remoteGitDir = join(await tmp('wyrm-sync-remote-'), 'novel.git')
  await git.init({ fs, bare: true, gitdir: remoteGitDir, defaultBranch: 'main' })
  const transport = fakeTransport(remoteGitDir)

  const first = await syncProject(a, transport)
  expect(first.status).toBe('pushed')
  return { a, docId, transport }
}

/** Clone device B from the fake remote — via the shipped restore path. */
async function cloneB(world: World): Promise<string> {
  const b = join(await tmp('wyrm-sync-b-'), 'Novel B.wyrm')
  return (await restoreBackup(world.transport.remoteGitDir, b), b)
}

async function editDoc(dir: string, docId: string, body: string, message: string): Promise<void> {
  const doc = await readDoc(dir, docId)
  await writeDoc(dir, { meta: doc.meta, body })
  await commitAll(dir, message)
}

function expectStatus<S extends SyncOutcome['status']>(
  outcome: SyncOutcome,
  status: S
): Extract<SyncOutcome, { status: S }> {
  expect(outcome.status).toBe(status)
  return outcome as Extract<SyncOutcome, { status: S }>
}

describe('plain flows', () => {
  it('pushes a first draft to an empty remote and is then up to date', async () => {
    const w = await makeWorld()
    const again = await syncProject(w.a, w.transport)
    expect(again.status).toBe('up-to-date')
  })

  it('commits unsaved work before anything else, so a sync can never miss it', async () => {
    const w = await makeWorld()
    const doc = await readDoc(w.a, w.docId)
    await writeDoc(w.a, { meta: doc.meta, body: 'Dirty, never committed by hand.\n' })

    expectStatus(await syncProject(w.a, w.transport), 'pushed')

    const remoteHead = await git.resolveRef({
      fs,
      gitdir: w.transport.remoteGitDir,
      ref: 'refs/heads/main'
    })
    const { blob } = await git.readBlob({
      fs,
      gitdir: w.transport.remoteGitDir,
      oid: remoteHead,
      filepath: `documents/${w.docId}.md`
    })
    expect(new TextDecoder().decode(blob)).toContain('Dirty, never committed by hand.')
  })

  it('pulling a fast-forward updates the file on disk, not just the ref', async () => {
    const w = await makeWorld()
    const b = await cloneB(w)
    await editDoc(b, w.docId, 'Rewritten on the other device.\n', 'B edit')
    expectStatus(await syncProject(b, w.transport), 'pushed')

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'pulled')
    expect(outcome.pushed).toBe(true)

    // The ref moving is not the feature; the words being on disk is. A stale
    // working tree here would be silently re-committed over the pull by the
    // next autosave — the exact bug class the engine is built to prevent.
    expect((await readDoc(w.a, w.docId)).body).toContain('Rewritten on the other device.')
  })

  it('reports offline and changes nothing when the network is down', async () => {
    const w = await makeWorld()
    const before = await git.resolveRef({ fs, dir: w.a, ref: 'HEAD' })
    w.transport.setOffline(true)

    expectStatus(await syncProject(w.a, w.transport), 'offline')

    expect(await git.resolveRef({ fs, dir: w.a, ref: 'HEAD' })).toBe(before)
    expect((await readDoc(w.a, w.docId)).body).toBe('Base paragraph.\n')
  })

  it('refuses to sync with a remote holding an unrelated history', async () => {
    const w = await makeWorld()
    const stranger = join(await tmp('wyrm-sync-c-'), 'Other.wyrm')
    await fsp.mkdir(stranger, { recursive: true })
    await createProject(stranger, 'A Different Novel')

    const outcome = expectStatus(await syncProject(stranger, w.transport), 'error')
    expect(outcome.detail).toContain('different history')
  })
})

describe('divergence without overlap', () => {
  it('auto-merges edits to different documents and records both parents', async () => {
    const w = await makeWorld()
    const b = await cloneB(w)

    // B adds a brand-new document and pushes.
    const now = new Date().toISOString()
    const newId = 'bnewdoc1'
    await writeDoc(b, {
      meta: { id: newId, title: 'Harbor Notes', status: 'draft', created: now, modified: now },
      body: 'Written only on device B.\n'
    })
    const bInfo = JSON.parse(await fsp.readFile(join(b, 'project.json'), 'utf8'))
    bInfo.binder.push({ id: newId, type: 'doc', title: 'Harbor Notes' })
    await saveProject(b, bInfo)
    await commitAll(b, 'B adds a doc')
    expectStatus(await syncProject(b, w.transport), 'pushed')

    // A edits the original document meanwhile.
    const preSync = await git.resolveRef({ fs, dir: w.a, ref: 'HEAD' })
    await editDoc(w.a, w.docId, 'Base paragraph, polished on A.\n', 'A polishes')

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'merged')
    expect(outcome.pushed).toBe(true)

    expect((await readDoc(w.a, w.docId)).body).toContain('polished on A')
    expect((await readDoc(w.a, newId)).body).toContain('Written only on device B.')

    const head = await git.resolveRef({ fs, dir: w.a, ref: 'HEAD' })
    const { commit } = await git.readCommit({ fs, dir: w.a, oid: head })
    expect(commit.parent).toHaveLength(2)
    expect(commit.parent).not.toContain(preSync) // parent is A's post-edit head, not pre-edit
  })

  it('merges a body edit with a frontmatter-only change instead of nagging', async () => {
    const w = await makeWorld()
    const b = await cloneB(w)

    // B only re-stamps status; the prose is untouched.
    const bDoc = await readDoc(b, w.docId)
    await writeDoc(b, { meta: { ...bDoc.meta, status: 'revised' }, body: bDoc.body })
    await commitAll(b, 'B marks revised')
    expectStatus(await syncProject(b, w.transport), 'pushed')

    await editDoc(w.a, w.docId, 'Base paragraph, expanded on A.\n', 'A expands')

    expectStatus(await syncProject(w.a, w.transport), 'merged')
    const merged = await readDoc(w.a, w.docId)
    expect(merged.body).toContain('expanded on A')
    expect(merged.meta.status).toBe('revised')
  })

  it('treats identical prose typed on both devices as agreement, not conflict', async () => {
    const w = await makeWorld()
    const b = await cloneB(w)
    await editDoc(b, w.docId, 'The same sentence.\n', 'B types it')
    expectStatus(await syncProject(b, w.transport), 'pushed')
    await editDoc(w.a, w.docId, 'The same sentence.\n', 'A types it too')

    expectStatus(await syncProject(w.a, w.transport), 'merged')
    expect((await readDoc(w.a, w.docId)).body).toBe('The same sentence.\n')
  })
})

describe('binary files', () => {
  // Portraits are PNGs. Pulls, pushes, backups and clones all move blobs by
  // oid, but a divergent merge is assembled by the engine itself, and it
  // used to assemble every file as a string: a byte sequence that is not
  // valid UTF-8 decodes to U+FFFD and is re-encoded as such on write, so the
  // first two-device merge after a portrait was added committed a corrupted
  // copy — on a file neither device had touched.

  const PORTRAIT = 'characters/portrait.png'

  /** 512 bytes no UTF-8 decoder can round-trip: a PNG signature, then bytes
   *  that are invalid in every position, then noise. */
  function portraitBytes(): Buffer {
    const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x80, 0xc0])
    return Buffer.concat([head, randomBytes(512 - head.length)])
  }

  async function addPortrait(dir: string, bytes: Buffer, message: string): Promise<void> {
    await fsp.mkdir(join(dir, 'characters'), { recursive: true })
    await fsp.writeFile(join(dir, PORTRAIT), bytes)
    await commitAll(dir, message)
  }

  async function portraitOnDisk(dir: string): Promise<Buffer> {
    return fsp.readFile(join(dir, PORTRAIT))
  }

  async function portraitAtHead(dir: string): Promise<Buffer> {
    const head = await git.resolveRef({ fs, dir, ref: 'HEAD' })
    const { blob } = await git.readBlob({ fs, dir, oid: head, filepath: PORTRAIT })
    return Buffer.from(blob)
  }

  it('a portrait neither device touched survives a divergent merge byte for byte', async () => {
    const w = await makeWorld()
    const bytes = portraitBytes()

    // A second scene, so each device can edit a document of its own.
    const now = new Date().toISOString()
    const otherId = 'scene0002'
    await writeDoc(w.a, {
      meta: { id: otherId, title: 'Second Scene', status: 'draft', created: now, modified: now },
      body: 'Second scene.\n'
    })
    const aInfo = JSON.parse(await fsp.readFile(join(w.a, 'project.json'), 'utf8'))
    aInfo.binder.push({ id: otherId, type: 'doc', title: 'Second Scene' })
    await saveProject(w.a, aInfo)
    await addPortrait(w.a, bytes, 'A adds a portrait and a second scene')
    expectStatus(await syncProject(w.a, w.transport), 'pushed')

    const b = await cloneB(w)
    expect((await portraitOnDisk(b)).equals(bytes)).toBe(true)

    await editDoc(w.a, w.docId, 'First scene, polished on A.\n', 'A polishes')
    expectStatus(await syncProject(w.a, w.transport), 'pushed')
    await editDoc(b, otherId, 'Second scene, polished on B.\n', 'B polishes')

    const outcome = expectStatus(await syncProject(b, w.transport), 'merged')
    expect(outcome.pushed).toBe(true)
    expect((await portraitOnDisk(b)).equals(bytes)).toBe(true)
    expect((await portraitAtHead(b)).equals(bytes)).toBe(true)

    expectStatus(await syncProject(w.a, w.transport), 'pulled')
    expect((await portraitOnDisk(w.a)).equals(bytes)).toBe(true)
    expect((await portraitOnDisk(b)).equals(bytes)).toBe(true)
  })

  it('a portrait only this device added survives its own divergent merge byte for byte', async () => {
    const w = await makeWorld()
    const b = await cloneB(w)
    const bytes = portraitBytes()
    await addPortrait(b, bytes, 'B adds a portrait')

    await editDoc(w.a, w.docId, 'First scene, polished on A.\n', 'A polishes')
    expectStatus(await syncProject(w.a, w.transport), 'pushed')

    const outcome = expectStatus(await syncProject(b, w.transport), 'merged')
    expect(outcome.pushed).toBe(true)
    expect((await portraitOnDisk(b)).equals(bytes)).toBe(true)
    expect((await portraitAtHead(b)).equals(bytes)).toBe(true)

    expectStatus(await syncProject(w.a, w.transport), 'pulled')
    expect((await portraitOnDisk(w.a)).equals(bytes)).toBe(true)
    expect((await portraitOnDisk(b)).equals(bytes)).toBe(true)
  })

  it('a portrait only the other device added arrives through a divergent merge byte for byte', async () => {
    const w = await makeWorld()
    const b = await cloneB(w)
    const bytes = portraitBytes()
    await addPortrait(b, bytes, 'B adds a portrait')
    expectStatus(await syncProject(b, w.transport), 'pushed')

    await editDoc(w.a, w.docId, 'First scene, polished on A.\n', 'A polishes')

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'merged')
    expect(outcome.pushed).toBe(true)
    expect((await portraitOnDisk(w.a)).equals(bytes)).toBe(true)
    expect((await portraitAtHead(w.a)).equals(bytes)).toBe(true)

    expectStatus(await syncProject(b, w.transport), 'pulled')
    expect((await portraitOnDisk(b)).equals(bytes)).toBe(true)
    expect((await portraitOnDisk(w.a)).equals(bytes)).toBe(true)
  })
})

describe('clearing an optional field', () => {
  // A cleared field is an absent key — writeEntity and writeDoc omit unset
  // optional fields rather than writing an empty one — and every save
  // restamps `modified`, so the other device merely re-saving the entry is
  // enough to make the file both-modified. The merge used to carry the
  // cleared key through as `undefined`, which js-yaml refuses to dump, so a
  // Tidy on one device turned every later sync on the other into a failure.

  it('an entity whose tags were cleared on one device merges, and stays cleared', async () => {
    const w = await makeWorld()
    const now = new Date().toISOString()
    const entity: Entity = {
      id: 'wyrmfire',
      type: 'glossary',
      name: 'Wyrmfire',
      aliases: [],
      body: 'A fire that does not go out.',
      tags: ['x'],
      created: now,
      modified: now
    }
    await writeEntity(w.a, entity)
    await commitAll(w.a, 'Add Wyrmfire')
    expectStatus(await syncProject(w.a, w.transport), 'pushed')
    const b = await cloneB(w)

    await writeEntity(w.a, { ...entity, tags: undefined })
    await commitAll(w.a, 'A clears tags')
    expectStatus(await syncProject(w.a, w.transport), 'pushed')

    // B re-saves the entry untouched; only the stamp moves.
    const onB = (await listEntities(b)).find((e) => e.id === entity.id)!
    await writeEntity(b, onB)
    await commitAll(b, 'B re-saves')

    expectStatus(await syncProject(b, w.transport), 'merged')

    const merged = (await listEntities(b)).find((e) => e.id === entity.id)
    expect(merged?.tags).toBeUndefined()
    expect(merged?.body).toBe(onB.body)
    const raw = await fsp.readFile(join(b, 'glossary', `${entity.id}.md`), 'utf8')
    expect(raw).not.toContain('tags:')
  })

  it('a scene whose board position was tidied away on one device merges, and stays unplaced', async () => {
    const w = await makeWorld()
    const doc = await readDoc(w.a, w.docId)
    await writeDoc(w.a, { meta: { ...doc.meta, boardX: 120, boardY: 80 }, body: doc.body })
    await commitAll(w.a, 'A places the card')
    expectStatus(await syncProject(w.a, w.transport), 'pushed')
    const b = await cloneB(w)

    // Tidy, as the store does it: the keys are deleted, not set to undefined.
    const placed = await readDoc(w.a, w.docId)
    const meta = { ...placed.meta }
    delete meta.boardX
    delete meta.boardY
    await writeDoc(w.a, { meta, body: placed.body })
    await commitAll(w.a, 'A tidies')
    expectStatus(await syncProject(w.a, w.transport), 'pushed')

    const onB = await readDoc(b, w.docId)
    await writeDoc(b, onB)
    await commitAll(b, 'B re-saves')

    expectStatus(await syncProject(b, w.transport), 'merged')

    const merged = await readDoc(b, w.docId)
    expect(merged.meta.boardX).toBeUndefined()
    expect(merged.meta.boardY).toBeUndefined()
    expect(merged.body).toBe(onB.body)
    const raw = await fsp.readFile(join(b, 'documents', `${w.docId}.md`), 'utf8')
    expect(raw).not.toMatch(/^board[XY]:/m)
  })
})

describe('genuine conflicts', () => {
  async function diverge(w: World): Promise<string> {
    const b = await cloneB(w)
    await editDoc(b, w.docId, 'Ending written on device B.\n', 'B ending')
    expectStatus(await syncProject(b, w.transport), 'pushed')
    await editDoc(w.a, w.docId, 'Ending written on device A.\n', 'A ending')
    return b
  }

  it('surfaces both-edited prose to the writer with parsed bodies and the doc title', async () => {
    const w = await makeWorld()
    await diverge(w)

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    expect(outcome.conflicts).toHaveLength(1)
    const conflict = outcome.conflicts[0]
    expect(conflict.kind).toBe('doc')
    expect(conflict.title).toBe('First Scene')
    expect(conflict.localBody).toBe('Ending written on device A.\n')
    expect(conflict.remoteBody).toBe('Ending written on device B.\n')
    // Frontmatter is engine business, never shown to the writer.
    expect(conflict.localBody).not.toContain('---')
    expect(conflict.localBody).not.toContain('modified:')
  })

  it('moves nothing at all while a conflict waits', async () => {
    const w = await makeWorld()
    await diverge(w)
    await syncProject(w.a, w.transport)
    const headAfterFirst = await git.resolveRef({ fs, dir: w.a, ref: 'HEAD' })

    expectStatus(await syncProject(w.a, w.transport), 'conflicts')

    expect(await git.resolveRef({ fs, dir: w.a, ref: 'HEAD' })).toBe(headAfterFirst)
    expect((await readDoc(w.a, w.docId)).body).toBe('Ending written on device A.\n')
  })

  it('keep mine: my text stays, theirs remains reachable through the merge parent', async () => {
    const w = await makeWorld()
    await diverge(w)
    const conflicts = expectStatus(await syncProject(w.a, w.transport), 'conflicts').conflicts

    const outcome = expectStatus(
      await resolveSyncConflicts(
        w.a,
        [{ path: conflicts[0].path, resolution: 'mine' }],
        w.transport
      ),
      'merged'
    )
    expect(outcome.pushed).toBe(true)

    expect((await readDoc(w.a, w.docId)).body).toBe('Ending written on device A.\n')
    const head = await git.resolveRef({ fs, dir: w.a, ref: 'HEAD' })
    const { commit } = await git.readCommit({ fs, dir: w.a, oid: head })
    expect(commit.parent).toHaveLength(2)
    const atTheirParent = await readDocAtRef(w.a, w.docId, commit.parent[1])
    expect(atTheirParent?.body).toBe('Ending written on device B.\n')
  })

  it('take theirs: the other device’s text becomes current', async () => {
    const w = await makeWorld()
    await diverge(w)
    const conflicts = expectStatus(await syncProject(w.a, w.transport), 'conflicts').conflicts

    await resolveSyncConflicts(
      w.a,
      [{ path: conflicts[0].path, resolution: 'theirs' }],
      w.transport
    )

    expect((await readDoc(w.a, w.docId)).body).toBe('Ending written on device B.\n')
  })

  it('keep both: mine stays current and theirs is shelved as a variant', async () => {
    const w = await makeWorld()
    await diverge(w)
    const conflicts = expectStatus(await syncProject(w.a, w.transport), 'conflicts').conflicts

    await resolveSyncConflicts(w.a, [{ path: conflicts[0].path, resolution: 'both' }], w.transport)

    expect((await readDoc(w.a, w.docId)).body).toBe('Ending written on device A.\n')
    const variants = await listVariants(w.a, w.docId)
    expect(variants.length).toBeGreaterThan(0)
    const shelved = await readDocAtRef(w.a, w.docId, variants[0].branch)
    expect(shelved?.body).toBe('Ending written on device B.\n')
  })

  it('the resolved merge reaches the remote, and the other device pulls it clean', async () => {
    const w = await makeWorld()
    const b = await diverge(w)
    const conflicts = expectStatus(await syncProject(w.a, w.transport), 'conflicts').conflicts
    await resolveSyncConflicts(w.a, [{ path: conflicts[0].path, resolution: 'mine' }], w.transport)

    const onB = expectStatus(await syncProject(b, w.transport), 'pulled')
    expect(onB.pushed).toBe(true)
    expect((await readDoc(b, w.docId)).body).toBe('Ending written on device A.\n')
  })
})

describe('the hard cases', () => {
  it('entity deleted here but edited there is the writer’s call, and “theirs” restores it', async () => {
    const w = await makeWorld()
    const now = new Date().toISOString()
    const entity: Entity = {
      id: 'elara001',
      type: 'character',
      name: 'Elara Voss',
      aliases: ['the Captain'],
      body: 'Original biography.',
      created: now,
      modified: now
    }
    await writeEntity(w.a, entity)
    await commitAll(w.a, 'Add Elara')
    expectStatus(await syncProject(w.a, w.transport), 'pushed')
    const b = await cloneB(w)

    await writeEntity(b, { ...entity, body: 'Biography rewritten on B.' })
    await commitAll(b, 'B rewrites Elara')
    expectStatus(await syncProject(b, w.transport), 'pushed')

    await deleteEntity(w.a, 'character', entity.id)
    await commitAll(w.a, 'A deletes Elara')

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    const conflict = outcome.conflicts.find((c) => c.kind === 'entity')
    expect(conflict).toBeDefined()
    expect(conflict!.localBody).toBeNull()
    expect(conflict!.remoteBody).toContain('rewritten on B')

    await resolveSyncConflicts(w.a, [{ path: conflict!.path, resolution: 'theirs' }], w.transport)
    const entities = await listEntities(w.a)
    expect(entities.find((e) => e.id === entity.id)?.body).toContain('rewritten on B')
  })

  it('a binder conflict resolved “mine” cannot orphan the other device’s document', async () => {
    const w = await makeWorld()
    const b = await cloneB(w)

    // Both devices rename the same folder (guaranteed project.json conflict);
    // B also adds a new document under it.
    const now = new Date().toISOString()
    const bInfo = JSON.parse(await fsp.readFile(join(b, 'project.json'), 'utf8'))
    findNode(bInfo.binder, bInfo.binder[1].id)!.title = 'Renamed on B'
    const newId = 'orphand1'
    await writeDoc(b, {
      meta: { id: newId, title: 'Nearly Lost', status: 'draft', created: now, modified: now },
      body: 'The chapter that must survive.\n'
    })
    bInfo.binder.push({ id: newId, type: 'doc', title: 'Nearly Lost' })
    await saveProject(b, bInfo)
    await commitAll(b, 'B renames + adds')
    expectStatus(await syncProject(b, w.transport), 'pushed')

    const aInfo = JSON.parse(await fsp.readFile(join(w.a, 'project.json'), 'utf8'))
    findNode(aInfo.binder, aInfo.binder[1].id)!.title = 'Renamed on A'
    await saveProject(w.a, aInfo)
    await commitAll(w.a, 'A renames')

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    const project = outcome.conflicts.find((c) => c.kind === 'project')
    expect(project).toBeDefined()

    await resolveSyncConflicts(w.a, [{ path: project!.path, resolution: 'mine' }], w.transport)

    // A's binder won — but B's document file merged in at tree level, and the
    // reconciliation re-attached it rather than letting it become invisible.
    const merged = JSON.parse(await fsp.readFile(join(w.a, 'project.json'), 'utf8'))
    const recovered = JSON.stringify(merged.binder)
    expect(recovered).toContain('orphand1')
    expect(recovered).toContain('(recovered)')
    expect((await readDoc(w.a, newId)).body).toContain('must survive')
  })

  it('retries once when the remote moved between fetch and push, then merges', async () => {
    const w = await makeWorld()
    const b = await cloneB(w)

    let raced = false
    const racy: SyncTransport = {
      fetchMainHead: (dir) => w.transport.fetchMainHead(dir),
      push: async (dir, refs) => {
        if (!raced) {
          raced = true
          // Someone else's send lands first.
          await editDoc(b, w.docId, 'Landed during the race.\n', 'B races')
          const bPush = await syncProject(b, w.transport)
          expect(bPush.status).toBe('pushed')
          throw new PushRejectedError('non-fast-forward on refs/heads/main')
        }
        return w.transport.push(dir, refs)
      }
    }

    // A has its own new commit on a different file, so after re-fetch this
    // becomes a clean divergence merge.
    const now = new Date().toISOString()
    await writeDoc(w.a, {
      meta: { id: 'racedoc1', title: 'Race Doc', status: 'draft', created: now, modified: now },
      body: 'Written on A during the race.\n'
    })
    const aInfo = JSON.parse(await fsp.readFile(join(w.a, 'project.json'), 'utf8'))
    aInfo.binder.push({ id: 'racedoc1', type: 'doc', title: 'Race Doc' })
    await saveProject(w.a, aInfo)
    await commitAll(w.a, 'A during race')

    const outcome = await syncProject(w.a, racy)
    expect(outcome.status).toBe('merged')
    expect((await readDoc(w.a, w.docId)).body).toContain('Landed during the race.')
    expect((await readDoc(w.a, 'racedoc1')).body).toContain('Written on A')
  })
})
