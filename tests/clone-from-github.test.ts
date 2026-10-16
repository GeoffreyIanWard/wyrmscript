import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { cloneProject } from '../src/main/wyrm/clone'
import { syncProject, type SyncTransport } from '../src/main/wyrm/sync'
import { commitAll } from '../src/main/wyrm/git'
import { createProject, readDoc, writeDoc } from '../src/main/wyrm/project'
import { firstDoc } from '../src/renderer/src/lib/tree'

/**
 * F-43, the other direction of sync: making a local project out of one that
 * already exists on GitHub.
 *
 * Run against real repositories with the transport faked over a bare repo on
 * disk — the same seam production binds to HTTP, and the same harness
 * `sync-engine.test.ts` uses. So the init, the ref writing, the checkout and
 * the project it produces are all exercised for real; only the network is
 * stood in for.
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

/** A "GitHub" that is just a bare repository on disk. */
function fakeTransport(remoteGitDir: string): SyncTransport {
  return {
    async fetchMainHead(dir: string): Promise<string | null> {
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
      for (const ref of refs) {
        const local = await git.resolveRef({ fs, dir, ref })
        await copyObjects(join(dir, '.git'), remoteGitDir)
        await git.writeRef({ fs, gitdir: remoteGitDir, ref, value: local, force: true })
      }
    }
  }
}

/** A project on "device A", pushed to a bare GitHub beside it. */
async function pushedProject(body = 'The harbour went dark.\n'): Promise<{
  remoteGitDir: string
  transport: SyncTransport
  title: string
  body: string
}> {
  const a = join(await tmp('wyrm-clone-a-'), 'Novel.wyrm')
  await fsp.mkdir(a, { recursive: true })
  const info = await createProject(a, 'The Wyrm of Winter')
  const docId = firstDoc(info.data.binder)!.id
  const doc = await readDoc(a, docId)
  await writeDoc(a, { meta: doc.meta, body })
  await commitAll(a, 'First draft')

  const remoteGitDir = join(await tmp('wyrm-clone-remote-'), 'novel.git')
  await git.init({ fs, bare: true, gitdir: remoteGitDir, defaultBranch: 'main' })
  const transport = fakeTransport(remoteGitDir)
  expect((await syncProject(a, transport)).status).toBe('pushed')
  return { remoteGitDir, transport, title: 'The Wyrm of Winter', body }
}

describe('bringing a project down from its remote', () => {
  it('produces a project with the manuscript in it', async () => {
    const { transport, title, body } = await pushedProject()
    const dest = join(await tmp('wyrm-clone-b-'), 'Brought Down.wyrm')

    const data = await cloneProject(dest, 'https://example.invalid/novel.git', transport)

    expect(data.title).toBe(title)
    // Not just a folder of files: the documents are readable through the
    // same reader the app uses, with the prose that was written on device A.
    const docId = firstDoc(data.binder)!.id
    expect((await readDoc(dest, docId)).body).toBe(body)
  })

  it('arrives already connected to the remote it came from', async () => {
    // Otherwise the writer lands in the sync picker being asked to choose
    // local-only or GitHub for a project that plainly came from GitHub.
    const { transport } = await pushedProject()
    const dest = join(await tmp('wyrm-clone-b-'), 'Brought Down.wyrm')
    const url = 'https://example.invalid/novel.git'

    await cloneProject(dest, url, transport)

    const remotes = await git.listRemotes({ fs, dir: dest })
    expect(remotes.find((r) => r.remote === 'origin')?.url).toBe(url)
  })

  it('arrives with its history, not just its files', async () => {
    // A checkout with no history would sync as a brand new project and
    // conflict with everything already on the remote.
    const { transport } = await pushedProject()
    const dest = join(await tmp('wyrm-clone-b-'), 'Brought Down.wyrm')

    await cloneProject(dest, 'https://example.invalid/novel.git', transport)

    const log = await git.log({ fs, dir: dest, ref: 'main' })
    expect(log.length).toBeGreaterThan(0)
    expect(await git.currentBranch({ fs, dir: dest })).toBe('main')
  })

  it('can sync straight away, with nothing to say', async () => {
    // The real proof that the clone is a peer rather than a lookalike: the
    // sync engine, run against the same remote, finds them identical.
    const { transport } = await pushedProject()
    const dest = join(await tmp('wyrm-clone-b-'), 'Brought Down.wyrm')
    await cloneProject(dest, 'https://example.invalid/novel.git', transport)

    const outcome = await syncProject(dest, transport)

    expect(outcome.status).toBe('up-to-date')
  })

  it('refuses a repository that is not a WyrmStar project', async () => {
    const remoteGitDir = join(await tmp('wyrm-clone-other-'), 'other.git')
    await git.init({ fs, bare: true, gitdir: remoteGitDir, defaultBranch: 'main' })
    // Somebody else's repository: real commits, no project.json.
    const work = await tmp('wyrm-clone-work-')
    await git.init({ fs, dir: work, defaultBranch: 'main' })
    await fsp.writeFile(join(work, 'README.md'), '# not a novel\n')
    await git.add({ fs, dir: work, filepath: 'README.md' })
    await git.commit({
      fs,
      dir: work,
      message: 'readme',
      author: { name: 'A', email: 'a@example.invalid' }
    })
    await copyObjects(join(work, '.git'), remoteGitDir)
    await git.writeRef({
      fs,
      gitdir: remoteGitDir,
      ref: 'refs/heads/main',
      value: await git.resolveRef({ fs, dir: work, ref: 'main' }),
      force: true
    })

    const dest = join(await tmp('wyrm-clone-b-'), 'Not A Novel.wyrm')
    await expect(
      cloneProject(dest, 'https://example.invalid/other.git', fakeTransport(remoteGitDir))
    ).rejects.toThrow(/does not contain a WyrmStar project/)
  })

  it('leaves no half-made project behind when it fails', async () => {
    // The failure above is the expected case, not an exotic one. A folder
    // left behind means the writer's next attempt fails on "already exists"
    // for a folder they never made.
    const remoteGitDir = join(await tmp('wyrm-clone-empty-'), 'empty.git')
    await git.init({ fs, bare: true, gitdir: remoteGitDir, defaultBranch: 'main' })
    const dest = join(await tmp('wyrm-clone-b-'), 'Nothing.wyrm')

    await expect(
      cloneProject(dest, 'https://example.invalid/empty.git', fakeTransport(remoteGitDir))
    ).rejects.toThrow(/empty/)

    expect(fs.existsSync(dest)).toBe(false)
  })

  it('will not write into a folder that already has something in it', async () => {
    const { transport } = await pushedProject()
    const dest = join(await tmp('wyrm-clone-b-'), 'Occupied.wyrm')
    await fsp.mkdir(dest, { recursive: true })
    await fsp.writeFile(join(dest, 'notes.txt'), 'work in progress')

    await expect(
      cloneProject(dest, 'https://example.invalid/novel.git', transport)
    ).rejects.toThrow(/already exists and is not empty/)

    // And the file that was there is still there.
    expect(await fsp.readFile(join(dest, 'notes.txt'), 'utf8')).toBe('work in progress')
  })
})
