import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { BoardString, StringEnd } from '../../shared/types'

const STRINGS_DIR = 'strings'

function stringsDir(projectPath: string): string {
  return join(projectPath, STRINGS_DIR)
}

function boardStringPath(projectPath: string, id: string): string {
  return join(stringsDir(projectPath), `${id}.md`)
}

/**
 * `from`/`to` stay nested mappings on disk: gray-matter round-trips them
 * as-is, so flattening to `fromCardId`/`fromDx`/… would only be a second
 * shape to keep in step with the first.
 */
interface BoardStringFrontmatter {
  id: string
  from: StringEnd
  to: StringEnd
  label?: string
  created: string
  modified: string
}

function parseEnd(end: StringEnd): StringEnd {
  return { cardId: end.cardId, dx: end.dx, dy: end.dy }
}

function parseBoardStringFile(raw: string): BoardString {
  const parsed = matter(raw)
  const data = parsed.data as BoardStringFrontmatter
  return {
    id: data.id,
    from: parseEnd(data.from),
    to: parseEnd(data.to),
    // Read only when it is a real label: a hand-edited file could carry
    // anything under the key.
    ...(typeof data.label === 'string' && data.label.trim() ? { label: data.label } : {}),
    created: data.created,
    modified: data.modified
  }
}

export async function writeBoardString(projectPath: string, s: BoardString): Promise<void> {
  await fsp.mkdir(stringsDir(projectPath), { recursive: true })
  const meta: BoardStringFrontmatter = {
    id: s.id,
    from: parseEnd(s.from),
    to: parseEnd(s.to),
    // Omitted rather than written empty: gray-matter refuses undefined, and
    // an empty key is noise in every diff and sync merge.
    ...(s.label?.trim() ? { label: s.label.trim() } : {}),
    created: s.created,
    modified: new Date().toISOString()
  }
  const file = matter.stringify('', meta)
  await fsp.writeFile(boardStringPath(projectPath, s.id), file, 'utf8')
}

/**
 * Every string in the project. Projects created before F-46 simply have no
 * strings directory yet — not an error, just an empty result, same rationale
 * as `listMapPins`.
 */
export async function listBoardStrings(projectPath: string): Promise<BoardString[]> {
  const dir = stringsDir(projectPath)
  let files: string[]
  try {
    files = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const strings: BoardString[] = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    try {
      const raw = await fsp.readFile(join(dir, file), 'utf8')
      strings.push(parseBoardStringFile(raw))
    } catch {
      // Skip unparsable entries; see listEntities for the same rationale.
      continue
    }
  }
  return strings
}

export async function deleteBoardString(projectPath: string, id: string): Promise<void> {
  // force: true means a missing file is not an error.
  await fsp.rm(boardStringPath(projectPath, id), { force: true })
}
