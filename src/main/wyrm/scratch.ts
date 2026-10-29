import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { Scrap, ScrapHow } from '../../shared/types'
import { SCRAP_HOWS } from '../../shared/types'
import { assertPlainId, isPlainId } from './plainId'

/**
 * F-51: the scratch pad on disk. One file per scrap, never one pad file:
 * two computers each adding a scrap then add two files, which a sync merges
 * without asking, where one shared file would have made the pad itself the
 * next conflict. The body is Markdown, written and read exactly as a
 * document body is, so a scrap's text goes back into a chapter unchanged.
 *
 * Nothing that builds the book reads this folder — Compile and the
 * corkboard work from the binder, stats from `documents/` — which is what
 * keeps the pad out of it.
 */
const SCRATCH_DIR = 'scratch'

function scratchDir(projectPath: string): string {
  return join(projectPath, SCRATCH_DIR)
}

/** Refuses an id that is not plain (see `plainId.ts`), so neither a write
 *  nor a delete can reach outside the folder. */
function scrapPath(projectPath: string, id: string): string {
  assertPlainId(id, 'scrap')
  return join(scratchDir(projectPath), `${id}.md`)
}

interface ScrapFrontmatter {
  id: string
  created: string
  modified: string
  how?: ScrapHow
  fromDoc?: string
  fromTitle?: string
}

/** A time as written. YAML reads an unquoted ISO stamp (a hand edit) as a
 *  date, which would not survive the trip back over IPC as one; a missing or
 *  empty one is no time at all, never the word "undefined" (which would sort
 *  the scrap above every real one, and be written back on its first edit). */
function stamp(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  return typeof v === 'string' ? v : ''
}

const isHow = (v: unknown): v is ScrapHow => SCRAP_HOWS.includes(v as ScrapHow)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

function parseScrapFile(raw: string): Scrap {
  const parsed = matter(raw)
  const data = parsed.data as ScrapFrontmatter
  // Throws, and the list skips it: an id that isn't plain could never be
  // written back or thrown away safely.
  if (!isPlainId(data.id)) throw new Error('Not a scrap')
  return {
    id: data.id,
    body: parsed.content.replace(/^\n/, ''),
    created: stamp(data.created),
    modified: stamp(data.modified),
    // Read only when they are what they say: a hand-edited or synced file
    // could carry anything under the keys.
    ...(isHow(data.how) ? { how: data.how } : {}),
    ...(isPlainId(data.fromDoc) ? { fromDoc: data.fromDoc } : {}),
    ...(isText(data.fromTitle) ? { fromTitle: data.fromTitle } : {})
  }
}

/**
 * A scrap's file, exactly as written to `scratch/<id>.md`: the one place
 * that says what a scrap looks like on disk, for the pad and for a merge
 * that keeps cards on the pad (F-51 step 3) alike. Refuses anything that is
 * not a scrap — it arrives over IPC, so the shape is not a given.
 */
export function scrapFileText(scrap: Scrap): string {
  assertPlainId(scrap.id, 'scrap')
  if (typeof scrap.body !== 'string' || typeof scrap.created !== 'string') {
    throw new Error('Not a scrap')
  }
  const meta: ScrapFrontmatter = {
    id: scrap.id,
    created: scrap.created,
    modified: new Date().toISOString(),
    // Omitted rather than written empty: gray-matter refuses undefined, and
    // an empty key is noise in every diff and sync merge.
    ...(isHow(scrap.how) ? { how: scrap.how } : {}),
    ...(isPlainId(scrap.fromDoc) ? { fromDoc: scrap.fromDoc } : {}),
    ...(isText(scrap.fromTitle) ? { fromTitle: scrap.fromTitle } : {})
  }
  const body = scrap.body.endsWith('\n') ? scrap.body : scrap.body + '\n'
  return matter.stringify(body, meta)
}

/** Where a scrap lives in the project, as the repository names it. */
export function scrapRepoPath(id: string): string {
  assertPlainId(id, 'scrap')
  return `${SCRATCH_DIR}/${id}.md`
}

export async function writeScrap(projectPath: string, scrap: Scrap): Promise<void> {
  const text = scrapFileText(scrap)
  await fsp.mkdir(scratchDir(projectPath), { recursive: true })
  await fsp.writeFile(scrapPath(projectPath, scrap.id), text, 'utf8')
}

/**
 * Every scrap in the project. A project that has never used the pad has no
 * folder yet — not an error, just an empty pad.
 */
export async function listScraps(projectPath: string): Promise<Scrap[]> {
  const dir = scratchDir(projectPath)
  let files: string[]
  try {
    files = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const scraps: Scrap[] = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    try {
      scraps.push(parseScrapFile(await fsp.readFile(join(dir, file), 'utf8')))
    } catch {
      // Skip unparsable entries; see listEntities for the same rationale.
      continue
    }
  }
  return scraps
}

export async function deleteScrap(projectPath: string, id: string): Promise<void> {
  // force: true means a missing file is not an error.
  await fsp.rm(scrapPath(projectPath, id), { force: true })
}
