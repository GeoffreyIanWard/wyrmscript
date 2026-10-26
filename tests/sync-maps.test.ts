import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import type { MapSheet, ProjectData, SyncOutcome } from '../src/shared/types'
import { resolveSyncConflicts, syncProject, type SyncTransport } from '../src/main/wyrm/sync'
import { restoreBackup } from '../src/main/wyrm/backup'
import { commitAll } from '../src/main/wyrm/git'
import { createProject, saveProject } from '../src/main/wyrm/project'
import { mergeMapLists, withMergedMaps } from '../src/main/wyrm/mergeMaps'

/**
 * Sync and several maps: project.json's list of maps is merged by map, so
 * two devices each adding a map keep both, rather than conflict over the
 * whole of "Binder & project settings" and lose one map's name and card.
 */

const sheet = (id: string, name: string, extra: Partial<MapSheet> = {}): MapSheet => ({
  id,
  name,
  ...extra
})

describe('merging the maps list', () => {
  it('keeps a map added on either side, this side’s order first', () => {
    const base = [sheet('a', 'Port Cray')]
    expect(
      mergeMapLists(base, [...base, sheet('b', 'The Fens')], [...base, sheet('c', 'Salt Isles')])
    ).toEqual([sheet('a', 'Port Cray'), sheet('b', 'The Fens'), sheet('c', 'Salt Isles')])
  })

  it('drops a map deleted on one side, unless the other changed it since', () => {
    const base = [sheet('a', 'Port Cray'), sheet('b', 'The Fens')]
    // Deleted here, untouched there: gone.
    expect(mergeMapLists(base, [base[1]], base).map((m) => m.id)).toEqual(['b'])
    // Deleted there, untouched here: gone too.
    expect(mergeMapLists(base, base, [base[0]]).map((m) => m.id)).toEqual(['a'])
    // Deleted there, renamed here: kept too.
    expect(mergeMapLists(base, [sheet('a', 'Cray Harbour'), base[1]], [base[1]])).toEqual([
      sheet('a', 'Cray Harbour'),
      sheet('b', 'The Fens')
    ])
    // Added on both sides with no base: this device's.
    expect(mergeMapLists([], [sheet('a', 'X')], [sheet('a', 'Y')])).toEqual([sheet('a', 'X')])
    // Deleted here, renamed there: kept, with the new name.
    expect(mergeMapLists(base, [base[1]], [sheet('a', 'Cray Harbour'), base[1]])).toEqual([
      sheet('b', 'The Fens'),
      sheet('a', 'Cray Harbour')
    ])
  })

  it('takes a field changed on one side, and this device’s for a field changed on both', () => {
    const base = [sheet('a', 'Port Cray', { onBoard: true })]
    const ours = [sheet('a', 'Cray', { onBoard: true })]
    const theirs = [sheet('a', 'Port Cray', { onBoard: true, boardX: 10, boardY: 20 })]
    expect(mergeMapLists(base, ours, theirs)).toEqual([
      sheet('a', 'Cray', { onBoard: true, boardX: 10, boardY: 20 })
    ])
    expect(mergeMapLists(base, ours, [sheet('a', 'Crayport', { onBoard: true })])).toEqual(ours)
  })

  it('moves a card as one x/y pair, never a point neither device chose', () => {
    const base = [sheet('a', 'P', { boardX: 0, boardY: 0 })]
    const ours = [sheet('a', 'P', { boardX: 100, boardY: 0 })]
    const theirs = [sheet('a', 'P', { boardX: 0, boardY: 200 })]
    expect(mergeMapLists(base, ours, theirs)).toEqual([sheet('a', 'P', { boardX: 100, boardY: 0 })])
  })

  it('clears a field cleared on one side, as an absent key', () => {
    const base = [sheet('a', 'P', { onBoard: true, boardX: 1, boardY: 2 })]
    const ours = [sheet('a', 'P')]
    const merged = mergeMapLists(base, ours, base)
    expect(merged).toEqual([sheet('a', 'P')])
    expect(Object.keys(merged[0])).toEqual(['id', 'name'])
  })

  it('puts the merged list into all three files, the same lines in each', () => {
    const data = (maps?: MapSheet[]): string =>
      JSON.stringify(
        { version: 1, title: 'T', binder: [], trash: [], ...(maps ? { maps } : {}) },
        null,
        2
      ) + '\n'
    const three = withMergedMaps(data(), data([sheet('a', 'A')]), data([sheet('b', 'B')]))!
    const maps = three.map((t) => (JSON.parse(t) as ProjectData).maps)
    expect(maps[0]).toEqual(maps[1])
    expect(maps[1]).toEqual(maps[2])
    expect(maps[0]).toEqual([sheet('a', 'A'), sheet('b', 'B')])
    // Written as the app writes project.json.
    expect(three[1]).toBe(JSON.stringify(JSON.parse(three[1]), null, 2) + '\n')
    // No base, or a version that will not parse: left to the text merge.
    expect(withMergedMaps(null, data(), data())).toBeNull()
    expect(withMergedMaps(data(), '{ not json', data())).toBeNull()
  })
})

/* ---------- two devices, through the real sync engine ---------- */

const tmpDirs: string[] = []
async function tmp(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

/** A "GitHub" that is a bare repository on disk. */
function bareRemote(remoteGitDir: string): SyncTransport {
  return {
    async fetchMainHead(dir: string): Promise<string | null> {
      const oid = await git
        .resolveRef({ fs, gitdir: remoteGitDir, ref: 'refs/heads/main' })
        .catch(() => null)
      if (oid) {
        await fsp.cp(join(remoteGitDir, 'objects'), join(dir, '.git', 'objects'), {
          recursive: true,
          force: false,
          errorOnExist: false
        })
        await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: oid, force: true })
      }
      return oid
    },
    async push(dir: string, refs: string[]): Promise<void> {
      await fsp.cp(join(dir, '.git', 'objects'), join(remoteGitDir, 'objects'), {
        recursive: true,
        force: false,
        errorOnExist: false
      })
      for (const ref of refs) {
        const local = await git.resolveRef({ fs, dir, ref })
        await git.writeRef({
          fs,
          gitdir: remoteGitDir,
          ref: 'refs/heads/main',
          value: local,
          force: true
        })
      }
    }
  } as SyncTransport
}

async function twoDevices(): Promise<{ a: string; b: string; transport: SyncTransport }> {
  const a = join(await tmp('wyrm-maps-a-'), 'Novel.wyrm')
  await fsp.mkdir(a, { recursive: true })
  await createProject(a, 'Maps Novel')
  await commitAll(a, 'First draft')
  const remoteGitDir = join(await tmp('wyrm-maps-remote-'), 'novel.git')
  await git.init({ fs, bare: true, gitdir: remoteGitDir, defaultBranch: 'main' })
  const transport = bareRemote(remoteGitDir)
  expect((await syncProject(a, transport)).status).toBe('pushed')
  const b = join(await tmp('wyrm-maps-b-'), 'Novel B.wyrm')
  await restoreBackup(remoteGitDir, b)
  return { a, b, transport }
}

async function addMap(dir: string, map: MapSheet, also: Partial<ProjectData> = {}): Promise<void> {
  const data = JSON.parse(await fsp.readFile(join(dir, 'project.json'), 'utf8')) as ProjectData
  await saveProject(dir, { ...data, ...also, maps: [...(data.maps ?? []), map] })
  await commitAll(dir, `Add ${map.name}`)
}

const mapsAt = async (dir: string): Promise<string[]> =>
  (
    (JSON.parse(await fsp.readFile(join(dir, 'project.json'), 'utf8')) as ProjectData).maps ?? []
  ).map((m) => m.name)

describe('two devices each adding a map', () => {
  it('keeps both maps, with no conflict', async () => {
    const { a, b, transport } = await twoDevices()
    await addMap(b, sheet('fens', 'The Fens'))
    expect((await syncProject(b, transport)).status).toBe('pushed')
    await addMap(a, sheet('cray', 'Port Cray'))
    const outcome: SyncOutcome = await syncProject(a, transport)
    expect(outcome.status).toBe('merged')
    expect(await mapsAt(a)).toEqual(['Port Cray', 'The Fens'])
    // And the other device gets both.
    expect((await syncProject(b, transport)).status).toBe('pulled')
    expect(await mapsAt(b)).toEqual(['Port Cray', 'The Fens'])
  })

  it('still asks about a real conflict elsewhere in project.json', async () => {
    const { a, b, transport } = await twoDevices()
    await addMap(b, sheet('fens', 'The Fens'), { title: 'Called B' })
    expect((await syncProject(b, transport)).status).toBe('pushed')
    await addMap(a, sheet('cray', 'Port Cray'), { title: 'Called A' })
    const outcome = await syncProject(a, transport)
    expect(outcome.status).toBe('conflicts')
    if (outcome.status === 'conflicts')
      expect(outcome.conflicts.map((c) => c.path)).toEqual(['project.json'])
  })

  for (const resolution of ['mine', 'theirs'] as const) {
    it(`keeps both devices’ maps whichever side is kept for the rest (${resolution})`, async () => {
      const { a, b, transport } = await twoDevices()
      await addMap(b, sheet('fens', 'The Fens'), { title: 'Called B' })
      expect((await syncProject(b, transport)).status).toBe('pushed')
      await addMap(a, sheet('cray', 'Port Cray'), { title: 'Called A' })
      expect((await syncProject(a, transport)).status).toBe('conflicts')
      await resolveSyncConflicts(a, [{ path: 'project.json', resolution }], transport)
      const data = JSON.parse(await fsp.readFile(join(a, 'project.json'), 'utf8')) as ProjectData
      // The rest is the side chosen; the maps are both devices'.
      expect(data.title).toBe(resolution === 'mine' ? 'Called A' : 'Called B')
      expect(await mapsAt(a)).toEqual(['Port Cray', 'The Fens'])
    })
  }
})
