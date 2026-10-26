import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import matter from 'gray-matter'
import type { Entity, SyncOutcome } from '../src/shared/types'
import {
  PushRejectedError,
  isFrontmattered,
  isRecord,
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
import { listMapMarks, writeMapMark } from '../src/main/wyrm/mapMarks'
import { listMapShapes, writeMapShape } from '../src/main/wyrm/mapShapes'
import { listMapPins, writeMapPin } from '../src/main/wyrm/worldMap'
import { listBoardStrings, writeBoardString } from '../src/main/wyrm/boardStrings'
import { listBoardStickers, writeBoardSticker } from '../src/main/wyrm/boardStickers'
import { listRelationships, writeRelationship } from '../src/main/wyrm/relationships'
import { listPlotlines, writePlotline } from '../src/main/wyrm/plotlines'
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

describe('clean merges beside a real conflict (I-13)', () => {
  // A plain text file with ten lines: each device changes a different line,
  // which diff3 merges cleanly, while the same document's prose conflicts.
  const NOTES = 'notes.txt'
  const lines = (overrides: Record<number, string>): string =>
    Array.from({ length: 10 }, (_, i) => `${overrides[i + 1] ?? `Line ${i + 1}.`}\n`).join('')

  async function writeNotes(dir: string, text: string, message: string): Promise<void> {
    await fsp.writeFile(join(dir, NOTES), text)
    await commitAll(dir, message)
  }

  async function worldWithNotes(): Promise<{ w: World; b: string }> {
    const w = await makeWorld()
    await writeNotes(w.a, lines({}), 'Notes')
    expectStatus(await syncProject(w.a, w.transport), 'pushed')
    const b = await cloneB(w)
    await writeNotes(b, lines({ 9: 'Line nine, from B.' }), 'B notes')
    await editDoc(b, w.docId, 'Ending written on device B.\n', 'B ending')
    expectStatus(await syncProject(b, w.transport), 'pushed')
    await writeNotes(w.a, lines({ 2: 'Line two, from A.' }), 'A notes')
    await editDoc(w.a, w.docId, 'Ending written on device A.\n', 'A ending')
    return { w, b }
  }

  it('keeps both devices’ halves of a file that merged cleanly, whatever the writer chose', async () => {
    const { w } = await worldWithNotes()
    const conflicts = expectStatus(await syncProject(w.a, w.transport), 'conflicts').conflicts
    // Only the document is the writer's to decide.
    expect(conflicts.map((c) => c.path)).toEqual([`documents/${w.docId}.md`])

    await resolveSyncConflicts(w.a, [{ path: conflicts[0].path, resolution: 'mine' }], w.transport)
    const notes = await fsp.readFile(join(w.a, NOTES), 'utf8')
    expect(notes).toBe(lines({ 2: 'Line two, from A.', 9: 'Line nine, from B.' }))
    expect((await readDoc(w.a, w.docId)).body).toBe('Ending written on device A.\n')
  })

  it('keeps them too when a deletion means the merge is assembled file by file', async () => {
    const w = await makeWorld()
    const now = new Date().toISOString()
    const entity: Entity = {
      id: 'elara001',
      type: 'character',
      name: 'Elara Voss',
      aliases: [],
      body: 'Original biography.',
      created: now,
      modified: now
    }
    await writeEntity(w.a, entity)
    await writeNotes(w.a, lines({}), 'Elara and notes')
    expectStatus(await syncProject(w.a, w.transport), 'pushed')
    const b = await cloneB(w)

    await writeEntity(b, { ...entity, body: 'Biography rewritten on B.' })
    await writeNotes(b, lines({ 9: 'Line nine, from B.' }), 'B rewrites Elara')
    expectStatus(await syncProject(b, w.transport), 'pushed')
    await deleteEntity(w.a, 'character', entity.id)
    await writeNotes(w.a, lines({ 2: 'Line two, from A.' }), 'A deletes Elara')

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    expect(outcome.conflicts.map((c) => c.path)).not.toContain(NOTES)
    const conflict = outcome.conflicts.find((c) => c.kind === 'entity')!
    await resolveSyncConflicts(w.a, [{ path: conflict.path, resolution: 'mine' }], w.transport)
    expect(await fsp.readFile(join(w.a, NOTES), 'utf8')).toBe(
      lines({ 2: 'Line two, from A.', 9: 'Line nine, from B.' })
    )
  })

  it('reaches the other device intact', async () => {
    const { w, b } = await worldWithNotes()
    const conflicts = expectStatus(await syncProject(w.a, w.transport), 'conflicts').conflicts
    await resolveSyncConflicts(
      w.a,
      [{ path: conflicts[0].path, resolution: 'theirs' }],
      w.transport
    )
    expectStatus(await syncProject(b, w.transport), 'pulled')
    expect(await fsp.readFile(join(b, NOTES), 'utf8')).toBe(
      lines({ 2: 'Line two, from A.', 9: 'Line nine, from B.' })
    )
  })
})

describe('a file that is not text, changed on both devices (I-17)', () => {
  const PORTRAIT = 'characters/portrait.png'
  const png = (fill: number): Buffer =>
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]), Buffer.alloc(256, fill)])

  it('is the writer’s choice, never a line merge, and the choice arrives byte for byte', async () => {
    const w = await makeWorld()
    const b = await cloneB(w)
    const theirs = png(0xb1)
    const mine = png(0xa1)
    await fsp.mkdir(join(b, 'characters'), { recursive: true })
    await fsp.writeFile(join(b, PORTRAIT), theirs)
    await commitAll(b, 'B portrait')
    expectStatus(await syncProject(b, w.transport), 'pushed')
    await fsp.mkdir(join(w.a, 'characters'), { recursive: true })
    await fsp.writeFile(join(w.a, PORTRAIT), mine)
    await commitAll(w.a, 'A portrait')

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    const conflict = outcome.conflicts.find((c) => c.path === PORTRAIT)!
    expect(conflict.kind).toBe('file')
    expect(conflict.localBody).toBe('(not text — an image or other file)')
    expect(conflict.remoteBody).toBe('(not text — an image or other file)')

    await resolveSyncConflicts(w.a, [{ path: PORTRAIT, resolution: 'theirs' }], w.transport)
    expect((await fsp.readFile(join(w.a, PORTRAIT))).equals(theirs)).toBe(true)
  })
})

describe('corkboard and map records merge field by field', () => {
  it('a stamp moved on one device and named on the other keeps both, with no conflict', async () => {
    const w = await makeWorld()
    const now = new Date().toISOString()
    await writeMapMark(w.a, { id: 'm1', kind: 'forest', x: 10, y: 20, created: now, modified: now })
    await commitAll(w.a, 'A forest')
    expectStatus(await syncProject(w.a, w.transport), 'pushed')
    const b = await cloneB(w)

    const [onB] = await listMapMarks(b)
    await writeMapMark(b, { ...onB, name: 'Hollin Wood' })
    await commitAll(b, 'B names the forest')
    expectStatus(await syncProject(b, w.transport), 'pushed')
    const [onA] = await listMapMarks(w.a)
    await writeMapMark(w.a, { ...onA, x: 300, y: 400 })
    await commitAll(w.a, 'A moves the forest')

    expectStatus(await syncProject(w.a, w.transport), 'merged')
    const [merged] = await listMapMarks(w.a)
    expect(merged).toMatchObject({ x: 300, y: 400, name: 'Hollin Wood' })
  })
})

const T0 = '2024-01-10T00:00:00.000Z'

/** Device A with `setup` committed and pushed, and device B cloned from it. */
async function twoDevices(setup: (a: string) => Promise<void>): Promise<{ w: World; b: string }> {
  const w = await makeWorld()
  await setup(w.a)
  await commitAll(w.a, 'Setup')
  expectStatus(await syncProject(w.a, w.transport), 'pushed')
  return { w, b: await cloneB(w) }
}

/** B edits and pushes first; A then edits and is left unsynced. */
async function bThenA(
  w: World,
  b: string,
  editB: (dir: string) => Promise<void>,
  editA: (dir: string) => Promise<void>
): Promise<void> {
  await editB(b)
  await commitAll(b, 'B edits')
  expectStatus(await syncProject(b, w.transport), 'pushed')
  await editA(w.a)
  await commitAll(w.a, 'A edits')
}

/** Set frontmatter keys exactly as given — the writers all restamp `modified`. */
async function restamp(dir: string, rel: string, patch: Record<string, unknown>): Promise<void> {
  const file = join(dir, rel)
  const parsed = matter(await fsp.readFile(file, 'utf8'))
  await fsp.writeFile(file, matter.stringify(parsed.content, { ...parsed.data, ...patch }), 'utf8')
}

async function frontmatterOf(dir: string, rel: string): Promise<Record<string, unknown>> {
  return matter(await fsp.readFile(join(dir, rel), 'utf8')).data
}

const iso = (v: unknown): string => new Date(String(v)).toISOString()

describe('a record field changed differently on both devices is the writer’s call', () => {
  it('a relationship label renamed on both is a conflict, never this device winning', async () => {
    const { w, b } = await twoDevices((a) =>
      writeRelationship(a, {
        id: 'r1',
        fromId: 'e1',
        toId: 'e2',
        label: 'sibling of',
        created: T0,
        modified: T0
      })
    )
    const rename = (label: string) => async (dir: string) => {
      const [r] = await listRelationships(dir)
      await writeRelationship(dir, { ...r, label })
    }
    await bThenA(w, b, rename('rival of'), rename('ally of'))

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    expect(outcome.conflicts.map((c) => c.path)).toEqual(['relationships/r1.md'])
    expect(outcome.conflicts[0].kind).toBe('file')
  })

  it('a shape’s points edited at different vertices on both is a conflict, and “theirs” is B’s shape', async () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ]
    const { w, b } = await twoDevices((a) =>
      writeMapShape(a, { id: 's1', kind: 'land', points: square, created: T0, modified: T0 })
    )
    const withPoint = (i: number, x: number, y: number) => async (dir: string) => {
      const [s] = await listMapShapes(dir)
      await writeMapShape(dir, {
        ...s,
        points: s.points.map((p, j) => (j === i ? { x, y } : p))
      })
    }
    await bThenA(w, b, withPoint(0, 5, 5), withPoint(2, 90, 90))
    const theirs = (await listMapShapes(b))[0].points

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    expect(outcome.conflicts.map((c) => c.path)).toEqual(['map-shapes/s1.md'])

    await resolveSyncConflicts(
      w.a,
      [{ path: 'map-shapes/s1.md', resolution: 'theirs' }],
      w.transport
    )
    expect((await listMapShapes(w.a))[0].points).toEqual(theirs)
    expect(theirs[0]).toEqual({ x: 5, y: 5 })
  })
})

describe('positions merge as a pair', () => {
  it('a pin moved on x only on A and on y only on B is a conflict', async () => {
    const { w, b } = await twoDevices((a) =>
      writeMapPin(a, { id: 'p1', entityId: 'place1', x: 10, y: 20, created: T0, modified: T0 })
    )
    const move = (patch: { x?: number; y?: number }) => async (dir: string) => {
      const [p] = await listMapPins(dir)
      await writeMapPin(dir, { ...p, ...patch })
    }
    await bThenA(w, b, move({ y: 200 }), move({ x: 100 }))

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    expect(outcome.conflicts.map((c) => c.path)).toEqual(['map/p1.md'])
  })

  it('a scene’s boardX on A and boardY on B merge to A’s pair with the base boardY', async () => {
    const w = await makeWorld()
    const placeDoc = (x: number, y: number) => async (dir: string) => {
      const doc = await readDoc(dir, w.docId)
      await writeDoc(dir, { meta: { ...doc.meta, boardX: x, boardY: y }, body: doc.body })
    }
    await placeDoc(100, 50)(w.a)
    await commitAll(w.a, 'Place')
    expectStatus(await syncProject(w.a, w.transport), 'pushed')
    const b = await cloneB(w)
    await bThenA(
      w,
      b,
      async (dir) => {
        const doc = await readDoc(dir, w.docId)
        await writeDoc(dir, { meta: { ...doc.meta, boardY: 90 }, body: doc.body })
      },
      async (dir) => {
        const doc = await readDoc(dir, w.docId)
        await writeDoc(dir, { meta: { ...doc.meta, boardX: 200 }, body: doc.body })
      }
    )

    expectStatus(await syncProject(w.a, w.transport), 'merged')
    const merged = (await readDoc(w.a, w.docId)).meta
    expect({ x: merged.boardX, y: merged.boardY }).toEqual({ x: 200, y: 50 })
  })

  it('an entry’s boardX on A and boardY on B merge to A’s pair with the base boardY', async () => {
    const entity: Entity = {
      id: 'wyrmfire',
      type: 'glossary',
      name: 'Wyrmfire',
      aliases: [],
      body: 'A fire that does not go out.',
      onBoard: true,
      boardX: 10,
      boardY: 20,
      created: T0,
      modified: T0
    }
    const { w, b } = await twoDevices((a) => writeEntity(a, entity))
    const move = (patch: Partial<Entity>) => async (dir: string) => {
      const e = (await listEntities(dir)).find((x) => x.id === entity.id)!
      await writeEntity(dir, { ...e, ...patch })
    }
    await bThenA(w, b, move({ boardY: 900 }), move({ boardX: 700 }))

    expectStatus(await syncProject(w.a, w.transport), 'merged')
    const merged = (await listEntities(w.a)).find((e) => e.id === entity.id)!
    expect({ x: merged.boardX, y: merged.boardY }).toEqual({ x: 700, y: 20 })
  })
})

interface RecordCase {
  name: string
  path: string
  setup: (dir: string) => Promise<void>
  editB: (dir: string) => Promise<void>
  editA: (dir: string) => Promise<void>
  check: (dir: string) => Promise<void>
}

const RECORD_CASES: RecordCase[] = [
  {
    name: 'map pins',
    path: 'map/p1.md',
    setup: (d) =>
      writeMapPin(d, { id: 'p1', entityId: 'place1', x: 10, y: 20, created: T0, modified: T0 }),
    editB: async (d) => writeMapPin(d, { ...(await listMapPins(d))[0], entityId: 'place2' }),
    editA: async (d) => writeMapPin(d, { ...(await listMapPins(d))[0], x: 300, y: 400 }),
    check: async (d) =>
      expect((await listMapPins(d))[0]).toMatchObject({ entityId: 'place2', x: 300, y: 400 })
  },
  {
    name: 'map shapes',
    path: 'map-shapes/s1.md',
    setup: (d) =>
      writeMapShape(d, {
        id: 's1',
        kind: 'river',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50 }
        ],
        created: T0,
        modified: T0
      }),
    editB: async (d) => writeMapShape(d, { ...(await listMapShapes(d))[0], name: 'River Wend' }),
    editA: async (d) =>
      writeMapShape(d, {
        ...(await listMapShapes(d))[0],
        points: [
          { x: 0, y: 0 },
          { x: 80, y: 80 }
        ]
      }),
    check: async (d) =>
      expect((await listMapShapes(d))[0]).toMatchObject({
        name: 'River Wend',
        points: [
          { x: 0, y: 0 },
          { x: 80, y: 80 }
        ]
      })
  },
  {
    name: 'map marks',
    path: 'map-marks/m1.md',
    setup: (d) =>
      writeMapMark(d, { id: 'm1', kind: 'forest', x: 10, y: 20, created: T0, modified: T0 }),
    editB: async (d) => writeMapMark(d, { ...(await listMapMarks(d))[0], kind: 'hills' }),
    editA: async (d) => writeMapMark(d, { ...(await listMapMarks(d))[0], name: 'Hollin Wood' }),
    check: async (d) =>
      expect((await listMapMarks(d))[0]).toMatchObject({ kind: 'hills', name: 'Hollin Wood' })
  },
  {
    name: 'board strings',
    path: 'strings/st1.md',
    setup: (d) =>
      writeBoardString(d, {
        id: 'st1',
        from: { cardId: 'c1', dx: 1, dy: 2 },
        to: { cardId: 'c2', dx: 3, dy: 4 },
        created: T0,
        modified: T0
      }),
    editB: async (d) => writeBoardString(d, { ...(await listBoardStrings(d))[0], label: 'owes' }),
    editA: async (d) =>
      writeBoardString(d, {
        ...(await listBoardStrings(d))[0],
        to: { cardId: 'c2', dx: 30, dy: 40 }
      }),
    check: async (d) =>
      expect((await listBoardStrings(d))[0]).toMatchObject({
        label: 'owes',
        to: { cardId: 'c2', dx: 30, dy: 40 }
      })
  },
  {
    name: 'board stickers',
    path: 'stickers/sk1.md',
    setup: (d) =>
      writeBoardSticker(d, {
        id: 'sk1',
        kind: 'star',
        rotation: 4,
        x: 10,
        y: 20,
        cardId: 'c1',
        created: T0,
        modified: T0
      }),
    editB: async (d) =>
      writeBoardSticker(d, { ...(await listBoardStickers(d))[0], colour: 'green' }),
    editA: async (d) => writeBoardSticker(d, { ...(await listBoardStickers(d))[0], x: 60, y: 70 }),
    check: async (d) =>
      expect((await listBoardStickers(d))[0]).toMatchObject({
        colour: 'green',
        x: 60,
        y: 70,
        cardId: 'c1'
      })
  },
  {
    name: 'relationships',
    path: 'relationships/r1.md',
    setup: (d) =>
      writeRelationship(d, {
        id: 'r1',
        fromId: 'e1',
        toId: 'e2',
        label: 'sibling of',
        created: T0,
        modified: T0
      }),
    editB: async (d) =>
      writeRelationship(d, { ...(await listRelationships(d))[0], label: 'rival of' }),
    editA: async (d) => writeRelationship(d, { ...(await listRelationships(d))[0], toId: 'e3' }),
    check: async (d) =>
      expect((await listRelationships(d))[0]).toMatchObject({ label: 'rival of', toId: 'e3' })
  },
  {
    name: 'plotlines',
    path: 'plotlines/pl1.md',
    setup: (d) =>
      writePlotline(d, {
        id: 'pl1',
        name: 'The Heist',
        colour: 'red',
        status: 'open',
        created: T0,
        modified: T0
      }),
    editB: async (d) =>
      writePlotline(d, { ...(await listPlotlines(d))[0], name: 'The Long Heist' }),
    editA: async (d) => writePlotline(d, { ...(await listPlotlines(d))[0], status: 'resolved' }),
    check: async (d) =>
      expect((await listPlotlines(d))[0]).toMatchObject({
        name: 'The Long Heist',
        status: 'resolved'
      })
  }
]

describe('every record collection merges different-field edits cleanly', () => {
  it.each(RECORD_CASES)('$name', async (c) => {
    const { w, b } = await twoDevices(async (a) => {
      await c.setup(a)
      // The folder this writer produces is one the engine merges field by field.
      await fsp.access(join(a, c.path))
      expect(isFrontmattered(c.path)).toBe(true)
      expect(isRecord(c.path)).toBe(true)
    })
    await bThenA(w, b, c.editB, c.editA)

    expectStatus(await syncProject(w.a, w.transport), 'merged')
    await c.check(w.a)
  })
})

describe('merging stamps and the non-strict rule', () => {
  const ENTRY = 'glossary/g1.md'
  const entry: Entity = {
    id: 'g1',
    type: 'glossary',
    name: 'Alpha',
    aliases: [],
    body: 'An entry.',
    tags: ['x'],
    created: T0,
    modified: T0
  }

  it.each([
    {
      name: 'A has the newer modified, B the older created',
      a: { modified: '2024-05-02T00:00:00.000Z', created: '2024-01-12T00:00:00.000Z' },
      b: { modified: '2024-03-01T00:00:00.000Z', created: '2024-01-03T00:00:00.000Z' }
    },
    {
      name: 'B has the newer modified, A the older created',
      a: { modified: '2024-03-01T00:00:00.000Z', created: '2024-01-03T00:00:00.000Z' },
      b: { modified: '2024-05-02T00:00:00.000Z', created: '2024-01-12T00:00:00.000Z' }
    }
  ])('modified is the newer of the two and created the older: $name', async (c) => {
    const { w, b } = await twoDevices((a) => writeEntity(a, entry))
    await bThenA(
      w,
      b,
      (dir) => restamp(dir, ENTRY, c.b),
      (dir) => restamp(dir, ENTRY, c.a)
    )

    expectStatus(await syncProject(w.a, w.transport), 'merged')
    const data = await frontmatterOf(w.a, ENTRY)
    expect(iso(data.modified)).toBe('2024-05-02T00:00:00.000Z')
    expect(iso(data.created)).toBe('2024-01-03T00:00:00.000Z')
  })

  it('an entry’s name and tags changed differently on both devices keep this device’s', async () => {
    const { w, b } = await twoDevices((a) => writeEntity(a, entry))
    const edit = (name: string, tags: string[]) => async (dir: string) => {
      const e = (await listEntities(dir)).find((x) => x.id === entry.id)!
      await writeEntity(dir, { ...e, name, tags })
    }
    await bThenA(w, b, edit('Alpha-B', ['b']), edit('Alpha-A', ['a']))

    expectStatus(await syncProject(w.a, w.transport), 'merged')
    const merged = (await listEntities(w.a)).find((e) => e.id === entry.id)!
    expect(merged.name).toBe('Alpha-A')
    expect(merged.tags).toEqual(['a'])
    expect(merged.body.trim()).toBe('An entry.')
  })
})

describe('a frontmattered file that is not UTF-8 goes to the writer as bytes', () => {
  const FILE = 'characters/bin1.md'
  const file = (name: string, modified: string): Buffer =>
    Buffer.concat([
      Buffer.from(
        `---\nid: bin1\ntype: character\nname: ${name}\naliases: []\ncreated: '${T0}'\nmodified: '${modified}'\n---\nCaf`
      ),
      Buffer.from([0xe9]),
      Buffer.from(' owner.\n')
    ])
  const FFFD = Buffer.from([0xef, 0xbf, 0xbd])

  async function conflicted(): Promise<{ w: World; mine: Buffer; theirs: Buffer }> {
    const base = file('Old Name', T0)
    const mine = file('Old Name', '2024-02-01T00:00:00.000Z')
    const theirs = file('New Name', T0)
    const { w, b } = await twoDevices(async (a) => {
      await fsp.mkdir(join(a, 'characters'), { recursive: true })
      await fsp.writeFile(join(a, FILE), base)
    })
    await bThenA(
      w,
      b,
      (dir) => fsp.writeFile(join(dir, FILE), theirs),
      (dir) => fsp.writeFile(join(dir, FILE), mine)
    )
    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    expect(outcome.conflicts.map((c) => c.path)).toEqual([FILE])
    return { w, mine, theirs }
  }

  it.each(['mine', 'theirs'] as const)(
    'choosing %s keeps the 0xE9 and never writes U+FFFD',
    async (side) => {
      const { w, mine, theirs } = await conflicted()
      await resolveSyncConflicts(w.a, [{ path: FILE, resolution: side }], w.transport)

      const onDisk = await fsp.readFile(join(w.a, FILE))
      expect(onDisk.includes(0xe9)).toBe(true)
      expect(onDisk.includes(FFFD)).toBe(false)
      expect(onDisk.equals(side === 'mine' ? mine : theirs)).toBe(true)
    }
  )
})

describe('text and bytes beside a real document conflict', () => {
  const NOTES = 'notes.txt'
  const numbered = (overrides: Record<number, string>, eol = '\n'): string =>
    Array.from({ length: 10 }, (_, i) => `${overrides[i + 1] ?? `Line ${i + 1}.`}${eol}`).join('')

  /** Both devices change notes; with `docConflict` they also rewrite the same scene. */
  async function notesWorld(
    base: string | Buffer,
    theirs: string | Buffer,
    mine: string | Buffer,
    docConflict: boolean
  ): Promise<World> {
    const { w, b } = await twoDevices((a) => fsp.writeFile(join(a, NOTES), base))
    await bThenA(
      w,
      b,
      async (dir) => {
        await fsp.writeFile(join(dir, NOTES), theirs)
        if (docConflict) await writeEnding(dir, w.docId, 'Ending written on device B.\n')
      },
      async (dir) => {
        await fsp.writeFile(join(dir, NOTES), mine)
        if (docConflict) await writeEnding(dir, w.docId, 'Ending written on device A.\n')
      }
    )
    return w
  }

  async function writeEnding(dir: string, docId: string, body: string): Promise<void> {
    const doc = await readDoc(dir, docId)
    await writeDoc(dir, { meta: doc.meta, body })
  }

  async function resolveDoc(w: World): Promise<void> {
    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    expect(outcome.conflicts.map((c) => c.path)).toEqual([`documents/${w.docId}.md`])
    await resolveSyncConflicts(
      w.a,
      [{ path: `documents/${w.docId}.md`, resolution: 'mine' }],
      w.transport
    )
  }

  it('a U+FFFD the writer typed is text: non-overlapping edits around it both survive', async () => {
    const base = numbered({ 5: 'Line five � stays.' })
    const w = await notesWorld(
      base,
      numbered({ 5: 'Line five � stays.', 9: 'Line nine, from B.' }),
      numbered({ 2: 'Line two, from A.', 5: 'Line five � stays.' }),
      true
    )
    await resolveDoc(w)

    expect(await fsp.readFile(join(w.a, NOTES), 'utf8')).toBe(
      numbered({ 2: 'Line two, from A.', 5: 'Line five � stays.', 9: 'Line nine, from B.' })
    )
  })

  it('a binary with a shared base is a conflict, and “theirs” arrives byte for byte', async () => {
    const PORTRAIT = 'characters/portrait.png'
    const segment = (n: number, note: string, tail: number[]): Buffer =>
      Buffer.concat([
        Buffer.from(`segment ${n} ${note} `),
        Buffer.from([0xff, 0xfe, 0x80, ...tail])
      ])
    const join0a = (parts: Buffer[]): Buffer =>
      Buffer.concat(parts.flatMap((p, i) => (i === 0 ? [p] : [Buffer.from([0x0a]), p])))
    const parts = (first: Buffer, last: Buffer): Buffer[] => [
      first,
      ...[1, 2, 3, 4].map((n) => segment(n, 'base', [0xc0])),
      last
    ]
    const base = join0a(parts(segment(0, 'base', [0xc0]), segment(5, 'base', [0xc0])))
    const theirs = join0a(
      parts(segment(0, 'edited on B', [0xc1, 0xc1]), segment(5, 'base', [0xc0]))
    )
    const mine = join0a(parts(segment(0, 'base', [0xc0]), segment(5, 'edited on A', [0xc2])))

    const { w, b } = await twoDevices(async (a) => {
      await fsp.mkdir(join(a, 'characters'), { recursive: true })
      await fsp.writeFile(join(a, PORTRAIT), base)
    })
    await bThenA(
      w,
      b,
      (dir) => fsp.writeFile(join(dir, PORTRAIT), theirs),
      (dir) => fsp.writeFile(join(dir, PORTRAIT), mine)
    )

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    expect(outcome.conflicts.map((c) => c.path)).toEqual([PORTRAIT])
    expect(outcome.conflicts[0].localBody).toBe('(not text — an image or other file)')
    expect(outcome.conflicts[0].remoteBody).toBe('(not text — an image or other file)')

    await resolveSyncConflicts(w.a, [{ path: PORTRAIT, resolution: 'theirs' }], w.transport)
    expect((await fsp.readFile(join(w.a, PORTRAIT))).equals(theirs)).toBe(true)
  })

  it('a text file in conflict is shown as its full raw text, not as a placeholder', async () => {
    const w = await notesWorld(
      numbered({}),
      numbered({ 4: 'Line four, from B.' }),
      numbered({ 4: 'Line four, from A.' }),
      false
    )

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    expect(outcome.conflicts).toHaveLength(1)
    const conflict = outcome.conflicts[0]
    expect(conflict.path).toBe(NOTES)
    expect(conflict.kind).toBe('file')
    expect(conflict.localBody).toBe(numbered({ 4: 'Line four, from A.' }))
    expect(conflict.remoteBody).toBe(numbered({ 4: 'Line four, from B.' }))
    expect(conflict.localBody).not.toContain('(not text')
    expect(conflict.remoteBody).not.toContain('(not text')
  })

  it('CRLF endings survive a plain clean merge byte for byte', async () => {
    const w = await notesWorld(
      numbered({}, '\r\n'),
      numbered({ 9: 'Line nine, from B.' }, '\r\n'),
      numbered({ 2: 'Line two, from A.' }, '\r\n'),
      false
    )

    expectStatus(await syncProject(w.a, w.transport), 'merged')
    const merged = await fsp.readFile(join(w.a, NOTES))
    expect(
      merged.equals(
        Buffer.from(numbered({ 2: 'Line two, from A.', 9: 'Line nine, from B.' }, '\r\n'))
      )
    ).toBe(true)
  })

  it('CRLF endings survive the oracle’s merge beside a real conflict', async () => {
    const w = await notesWorld(
      numbered({}, '\r\n'),
      numbered({ 9: 'Line nine, from B.' }, '\r\n'),
      numbered({ 2: 'Line two, from A.' }, '\r\n'),
      true
    )
    await resolveDoc(w)

    const merged = await fsp.readFile(join(w.a, NOTES))
    expect(
      merged.equals(
        Buffer.from(numbered({ 2: 'Line two, from A.', 9: 'Line nine, from B.' }, '\r\n'))
      )
    ).toBe(true)
  })

  it('a BOM survives the file-by-file merge a deletion forces', async () => {
    const BOM = Buffer.from([0xef, 0xbb, 0xbf])
    const withBom = (overrides: Record<number, string>): Buffer =>
      Buffer.concat([BOM, Buffer.from(numbered(overrides))])
    const entity: Entity = {
      id: 'elara001',
      type: 'character',
      name: 'Elara Voss',
      aliases: [],
      body: 'Original biography.',
      created: T0,
      modified: T0
    }
    const { w, b } = await twoDevices(async (a) => {
      await writeEntity(a, entity)
      await fsp.writeFile(join(a, NOTES), withBom({}))
    })
    await bThenA(
      w,
      b,
      async (dir) => {
        await writeEntity(dir, { ...entity, body: 'Biography rewritten on B.' })
        await fsp.writeFile(join(dir, NOTES), withBom({ 9: 'Line nine, from B.' }))
      },
      async (dir) => {
        await deleteEntity(dir, 'character', entity.id)
        await fsp.writeFile(join(dir, NOTES), withBom({ 2: 'Line two, from A.' }))
      }
    )

    const outcome = expectStatus(await syncProject(w.a, w.transport), 'conflicts')
    expect(outcome.conflicts.map((c) => c.path)).toEqual(['characters/elara001.md'])
    await resolveSyncConflicts(
      w.a,
      [{ path: 'characters/elara001.md', resolution: 'mine' }],
      w.transport
    )

    const merged = await fsp.readFile(join(w.a, NOTES))
    expect(merged.subarray(0, 3).equals(BOM)).toBe(true)
    expect(merged.equals(withBom({ 2: 'Line two, from A.', 9: 'Line nine, from B.' }))).toBe(true)
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
