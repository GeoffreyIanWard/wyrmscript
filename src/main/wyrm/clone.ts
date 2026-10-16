import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { basename, join } from 'node:path'
import git from 'isomorphic-git'
import type { ProjectData } from '../../shared/types'
import { setRemoteUrl, type SyncTransport } from './sync'

/**
 * Bring a project down from its remote (F-43).
 *
 * The missing direction of GitHub sync: `sync.ts` connects an *existing
 * local* project to a remote, and nothing brought one the other way, so a
 * writer setting up a second machine had to copy the folder by hand or reach
 * for `git` — which §10 of the brief deliberately does not require them to
 * have.
 *
 * Hand-rolled init-remote-fetch-checkout rather than a `clone` call, because
 * isomorphic-git is driven directly here the same way `backup.ts` hand-rolls
 * its mirror, and because the fetch has to go through the **injected
 * transport**: that is the seam carrying auth in production and a bare repo
 * on disk in the tests, which is how this is tested for real rather than
 * against a mock.
 *
 * Two rules, both about not leaving a mess:
 *
 * - A destination that already holds anything is refused, exactly as
 *   `restoreBackup` refuses one. Writing a project into a folder with files
 *   already in it is how someone loses the files that were there.
 * - **Anything that fails after the folder is created takes the folder with
 *   it.** A repository that turns out not to be a WyrmStar project is the
 *   expected case here, not an exotic one, and leaving a half-made project
 *   behind means the writer's next attempt fails on "already exists" for a
 *   folder they never made.
 */
export async function cloneProject(
  destPath: string,
  url: string,
  transport: SyncTransport
): Promise<ProjectData> {
  if (await exists(destPath)) {
    const entries = await fsp.readdir(destPath).catch(() => [])
    if (entries.length > 0) {
      throw new Error(`${basename(destPath)} already exists and is not empty.`)
    }
  }

  await fsp.mkdir(destPath, { recursive: true })
  try {
    await git.init({ fs, dir: destPath, defaultBranch: 'main' })
    await setRemoteUrl(destPath, url)

    // The transport does the fetching, so it also does the complaining: it
    // already knows how to say that a remote has no `main` line to sync with
    // and may belong to a different tool.
    const head = await transport.fetchMainHead(destPath)
    if (head == null) {
      throw new Error('That GitHub copy is empty — there is no project in it yet.')
    }

    await git.writeRef({ fs, dir: destPath, ref: 'refs/heads/main', value: head, force: true })
    await git.writeRef({
      fs,
      dir: destPath,
      ref: 'HEAD',
      value: 'refs/heads/main',
      symbolic: true,
      force: true
    })
    await git.checkout({ fs, dir: destPath, ref: 'main', force: true })

    const raw = await fsp.readFile(join(destPath, 'project.json'), 'utf8').catch(() => null)
    if (raw == null) {
      throw new Error('That GitHub copy does not contain a WyrmStar project.')
    }
    return JSON.parse(raw) as ProjectData
  } catch (err) {
    await fsp.rm(destPath, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
}

async function exists(path: string): Promise<boolean> {
  return fsp
    .access(path)
    .then(() => true)
    .catch(() => false)
}
