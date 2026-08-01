import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

import { commitAll } from '../src/main/wyrm/git'
import { createProject, readDoc, writeDoc } from '../src/main/wyrm/project'
import { clearStatsCache, dailyStats } from '../src/main/wyrm/stats'
import { firstDoc } from '../src/renderer/src/lib/tree'

const tmpDirs: string[] = []

async function makeProject(): Promise<{ dir: string; docId: string }> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-stats-'))
  tmpDirs.push(dir)
  const info = await createProject(dir, 'Stats Novel')
  return { dir, docId: firstDoc(info.data.binder)!.id }
}

/** Replace the document body and checkpoint it. */
async function write(dir: string, docId: string, body: string, message: string): Promise<void> {
  const doc = await readDoc(dir, docId)
  await writeDoc(dir, { meta: doc.meta, body })
  await commitAll(dir, message)
}

const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

beforeEach(() => {
  // The blob cache is module-global and content-addressed; clearing it keeps
  // one test's temp repo from answering for another's.
  clearStatsCache()
})

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('dailyStats', () => {
  it('reports the running manuscript total at each checkpoint', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, words(100), 'First hundred')

    const days = await dailyStats(dir)

    expect(days).toHaveLength(1)
    expect(days[0].total).toBe(100)
  })

  it('counts only the body, never the YAML frontmatter', async () => {
    const { dir, docId } = await makeProject()
    // writeDoc stamps id/title/created/modified into frontmatter; if those
    // leaked into the count the total would exceed the body's word count.
    await write(dir, docId, words(40), 'Body only')

    const days = await dailyStats(dir)

    expect(days[0].total).toBe(40)
  })

  it('separates net from gross on a day that both adds and cuts', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, words(1000), 'Draft it')
    // The revision that makes the three counting modes disagree: 400 words cut
    // after 1000 written, all on the same day.
    await write(dir, docId, words(600), 'Cut the flab')

    const days = await dailyStats(dir)

    expect(days).toHaveLength(1)
    expect(days[0].total).toBe(600)
    expect(days[0].net).toBe(600) // ended 600 up on having started from nothing
    expect(days[0].added).toBe(1000) // the cut is not subtracted from gross
    expect(days[0].commits).toBe(3) // the two writes plus project creation
  })

  it('reuses the word count for an unchanged document across checkpoints', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, words(50), 'Write')
    // A checkpoint that changes nothing about the manuscript still has a full
    // tree; the total must stay put rather than double.
    await fsp.writeFile(join(dir, 'notes.txt'), 'not a manuscript document', 'utf8')
    await commitAll(dir, 'Unrelated file')

    const days = await dailyStats(dir)

    expect(days[days.length - 1].total).toBe(50)
  })

  it('lets the newest commit define the day when several share a second', async () => {
    const { dir, docId } = await makeProject()
    // Git timestamps are whole seconds, so these commits tie. Sorted only by
    // time, a stable sort leaves them in git.log's newest-first order and the
    // OLDEST commit ends up defining the day — reporting a day of real
    // writing as a total of zero.
    await write(dir, docId, words(10), 'One')
    await write(dir, docId, words(20), 'Two')
    await write(dir, docId, words(30), 'Three')

    const days = await dailyStats(dir)

    expect(days).toHaveLength(1)
    expect(days[0].total).toBe(30)
    expect(days[0].net).toBe(30)
  })

  it('returns nothing for a project with no history', async () => {
    const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-stats-empty-'))
    tmpDirs.push(dir)

    expect(await dailyStats(dir)).toEqual([])
  })

  it('ignores files outside documents/ entirely', async () => {
    const { dir, docId } = await makeProject()
    await write(dir, docId, words(25), 'Manuscript')
    await fsp.writeFile(join(dir, 'README.md'), words(9999), 'utf8')
    await commitAll(dir, 'A big non-manuscript markdown file')

    const days = await dailyStats(dir)

    expect(days[days.length - 1].total).toBe(25)
  })
})
