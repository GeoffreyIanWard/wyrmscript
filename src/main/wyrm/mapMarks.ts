import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { assertPlainId, isPlainId } from './plainId'
import { MAP_MARK_KINDS } from '../../shared/types'
import type { MapMark, MapMarkKind } from '../../shared/types'

/** Their own folder: `map/` is the pins', `map-shapes/` the drawn shapes'. */
const MARKS_DIR = 'map-marks'

function marksDir(projectPath: string): string {
  return join(projectPath, MARKS_DIR)
}

function markPath(projectPath: string, id: string): string {
  return join(marksDir(projectPath), `${id}.md`)
}

interface MapMarkFrontmatter {
  id: string
  kind: MapMarkKind
  x: number
  y: number
  name?: string
  created: string
  modified: string
}

function isKind(value: unknown): value is MapMarkKind {
  return typeof value === 'string' && (MAP_MARK_KINDS as readonly string[]).includes(value)
}

function isCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Null for anything that isn't a usable mark: no usable id, an unknown kind,
 *  a position that isn't a finite number, or a label with no text. */
function parseMapMarkFile(raw: string): MapMark | null {
  const data = matter(raw).data as Partial<Record<keyof MapMarkFrontmatter, unknown>>
  if (!isPlainId(data.id) || !isKind(data.kind)) return null
  if (!isCoord(data.x) || !isCoord(data.y)) return null
  const name = typeof data.name === 'string' && data.name !== '' ? data.name : undefined
  if (data.kind === 'label' && name === undefined) return null
  const mark: MapMark = {
    id: data.id,
    kind: data.kind,
    x: Math.round(data.x),
    y: Math.round(data.y),
    created: typeof data.created === 'string' ? data.created : '',
    modified: typeof data.modified === 'string' ? data.modified : ''
  }
  if (name !== undefined) mark.name = name
  return mark
}

export async function writeMapMark(projectPath: string, mark: MapMark): Promise<void> {
  assertPlainId(mark.id, 'mark')
  await fsp.mkdir(marksDir(projectPath), { recursive: true })
  const meta: MapMarkFrontmatter = {
    id: mark.id,
    kind: mark.kind,
    x: Math.round(mark.x),
    y: Math.round(mark.y),
    created: mark.created,
    modified: new Date().toISOString()
  }
  // Written only when set: gray-matter throws on an undefined value.
  if (typeof mark.name === 'string' && mark.name !== '') meta.name = mark.name
  const file = matter.stringify('', meta)
  await fsp.writeFile(markPath(projectPath, mark.id), file, 'utf8')
}

/**
 * Every mark in the project. A project with no marks folder yet has none —
 * not an error, same rationale as `listMapShapes`. Files that don't parse as
 * a mark are skipped, never returned half-formed.
 */
export async function listMapMarks(projectPath: string): Promise<MapMark[]> {
  const dir = marksDir(projectPath)
  let files: string[]
  try {
    files = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const marks: MapMark[] = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    try {
      const raw = await fsp.readFile(join(dir, file), 'utf8')
      const mark = parseMapMarkFile(raw)
      if (mark) marks.push(mark)
    } catch {
      // Skip unparsable entries; see listEntities for the same rationale.
      continue
    }
  }
  return marks
}

export async function deleteMapMark(projectPath: string, id: string): Promise<void> {
  assertPlainId(id, 'mark')
  // force: true means a missing file is not an error.
  await fsp.rm(markPath(projectPath, id), { force: true })
}
