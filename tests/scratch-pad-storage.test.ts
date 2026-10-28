import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import matter from 'gray-matter'
import { deleteScrap, listScraps, writeScrap } from '../src/main/wyrm/scratch'
import { createProject, readDoc, writeDoc } from '../src/main/wyrm/project'
import type { Scrap } from '../src/shared/types'

/**
 * F-51: the scratch pad on disk — one file per scrap in `scratch/`, the
 * body stored exactly as a document body is, so a scrap's text goes back
 * into a chapter unchanged.
 */

const tmpDirs: string[] = []

async function makeProject(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'wyrm-scratch-test-'))
  tmpDirs.push(dir)
  await createProject(dir, 'Pad Novel')
  return dir
}

function makeScrap(overrides: Partial<Scrap> = {}): Scrap {
  const now = new Date().toISOString()
  return {
    id: Math.random().toString(36).slice(2, 10),
    body: 'She watched the lights of Callow **shrink** behind them.\n',
    created: now,
    modified: now,
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('writeScrap / listScraps', () => {
  it('round-trips a scrap at <project>/scratch/<id>.md, with where it came from', async () => {
    const dir = await makeProject()
    const s = makeScrap({ how: 'cut', fromDoc: 'ch3', fromTitle: 'The Ferry' })
    await writeScrap(dir, s)
    const raw = await fsp.readFile(join(dir, 'scratch', `${s.id}.md`), 'utf8')
    expect(matter(raw).data).toMatchObject({ how: 'cut', fromDoc: 'ch3', fromTitle: 'The Ferry' })
    const [found] = await listScraps(dir)
    expect(found).toMatchObject({
      id: s.id,
      body: s.body,
      how: 'cut',
      fromDoc: 'ch3',
      fromTitle: 'The Ferry',
      created: s.created
    })
  })

  it('stores the body byte for byte as a document stores the same text', async () => {
    const dir = await makeProject()
    const body = 'First *line*,\nwith a break.\n\n==Marked== and **bold**.\n'
    const s = makeScrap({ body })
    await writeScrap(dir, s)
    const [found] = await listScraps(dir)
    expect(found.body).toBe(body)
    // The same text through the document path reads back the same.
    const doc = await readDoc(dir, (await fsp.readdir(join(dir, 'documents')))[0].slice(0, -3))
    await writeDoc(dir, { ...doc, body })
    expect((await readDoc(dir, doc.meta.id)).body).toBe(found.body)
  })

  it('adds the final newline a document body carries, so a scrap reads back as stored', async () => {
    const dir = await makeProject()
    const s = makeScrap({ body: 'No newline at the end.' })
    await writeScrap(dir, s)
    expect((await listScraps(dir))[0].body).toBe('No newline at the end.\n')
  })

  it('writes nothing for a note: no how, no source', async () => {
    const dir = await makeProject()
    const s = makeScrap()
    await writeScrap(dir, s)
    const raw = await fsp.readFile(join(dir, 'scratch', `${s.id}.md`), 'utf8')
    const data = matter(raw).data
    expect('how' in data).toBe(false)
    expect('fromDoc' in data).toBe(false)
    expect('fromTitle' in data).toBe(false)
  })

  it('stamps modified with the time of the write, and keeps created', async () => {
    const dir = await makeProject()
    const s = makeScrap({
      created: '2020-01-01T00:00:00.000Z',
      modified: '2020-01-01T00:00:00.000Z'
    })
    await writeScrap(dir, s)
    const [found] = await listScraps(dir)
    expect(found.created).toBe('2020-01-01T00:00:00.000Z')
    expect(found.modified > '2020-01-01T00:00:00.000Z').toBe(true)
  })

  it('reads an empty pad when the project has never used it', async () => {
    const dir = await makeProject()
    expect(await listScraps(dir)).toEqual([])
  })

  it('refuses an id that would reach outside the folder, for a write and a delete', async () => {
    const dir = await makeProject()
    await expect(writeScrap(dir, makeScrap({ id: '../documents/x' }))).rejects.toThrow(/scrap id/)
    await expect(deleteScrap(dir, '../project')).rejects.toThrow(/scrap id/)
    // project.json is still there.
    await expect(fsp.stat(join(dir, 'project.json'))).resolves.toBeTruthy()
  })

  it('refuses a scrap that is not one (it arrives over IPC)', async () => {
    const dir = await makeProject()
    await expect(
      writeScrap(dir, { ...makeScrap(), body: 12 as unknown as string })
    ).rejects.toThrow(/Not a scrap/)
  })

  it('reads what a hand-edited or synced file says only when it is what it claims', async () => {
    const dir = await makeProject()
    await fsp.mkdir(join(dir, 'scratch'), { recursive: true })
    await fsp.writeFile(
      join(dir, 'scratch', 'odd.md'),
      matter.stringify('Words.\n', {
        id: 'odd',
        created: '2026-10-28T10:00:00.000Z',
        modified: '2026-10-28T10:00:00.000Z',
        how: 'stolen',
        fromDoc: '../escape',
        fromTitle: '   '
      })
    )
    const [found] = await listScraps(dir)
    expect(found.id).toBe('odd')
    expect('how' in found).toBe(false)
    expect('fromDoc' in found).toBe(false)
    expect('fromTitle' in found).toBe(false)
  })

  it('reads an unquoted time (a hand edit, read by YAML as a date) back as text', async () => {
    const dir = await makeProject()
    await fsp.mkdir(join(dir, 'scratch'), { recursive: true })
    await fsp.writeFile(
      join(dir, 'scratch', 'dated.md'),
      '---\nid: dated\ncreated: 2026-10-28T10:00:00.000Z\nmodified: 2026-10-28T10:00:00.000Z\n---\nWords.\n'
    )
    const [found] = await listScraps(dir)
    expect(found.created).toBe('2026-10-28T10:00:00.000Z')
    expect(typeof found.modified).toBe('string')
  })

  it('reads a missing or empty time as no time, never the word "undefined"', async () => {
    const dir = await makeProject()
    await fsp.mkdir(join(dir, 'scratch'), { recursive: true })
    await fsp.writeFile(join(dir, 'scratch', 'bare.md'), '---\nid: bare\n---\nHello\n')
    await fsp.writeFile(join(dir, 'scratch', 'blank.md'), '---\nid: blank\ncreated:\n---\nHi\n')
    const found = await listScraps(dir)
    for (const s of found) {
      expect(s.created).toBe('')
      expect(s.modified).toBe('')
    }
  })

  it('skips a file with an id that is not plain, and anything that is not a scrap', async () => {
    const dir = await makeProject()
    await fsp.mkdir(join(dir, 'scratch'), { recursive: true })
    await fsp.writeFile(
      join(dir, 'scratch', 'bad.md'),
      matter.stringify('x\n', { id: '../bad', created: 'a', modified: 'b' })
    )
    await fsp.writeFile(join(dir, 'scratch', 'notes.txt'), 'not a scrap')
    const good = makeScrap()
    await writeScrap(dir, good)
    expect((await listScraps(dir)).map((s) => s.id)).toEqual([good.id])
  })
})

describe('deleteScrap', () => {
  it('takes the file away, and a missing one is not an error', async () => {
    const dir = await makeProject()
    const s = makeScrap()
    await writeScrap(dir, s)
    await deleteScrap(dir, s.id)
    expect(await listScraps(dir)).toEqual([])
    await expect(deleteScrap(dir, s.id)).resolves.toBeUndefined()
  })
})

describe('the pad in every palette', () => {
  it('draws highlight and selection in the palette’s inks, as the page does', async () => {
    const css = await fsp.readFile(join(__dirname, '../src/renderer/src/styles/retro.css'), 'utf8')
    expect(css).toMatch(/^\.scrap-text mark \{/m)
    expect(css).toMatch(/\.scrap-text ::selection/)
    // Every palette that redraws the page's highlight redraws the pad's.
    const palettes = [...css.matchAll(/\[data-palette='([a-z-]+)'\] \.page mark/g)].map((m) => m[1])
    expect(palettes.length).toBeGreaterThan(0)
    for (const name of palettes) expect(css).toContain(`[data-palette='${name}'] .scrap-text mark`)
  })
})
