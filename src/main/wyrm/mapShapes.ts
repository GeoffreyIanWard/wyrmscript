import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { MapShape, MapShapeKind } from '../../shared/types'

/** Their own folder, not `map/`: that is the pins', and a pin reader that
 *  met a shape there would make a pin of it. */
const MAP_DIR = 'map-shapes'

const KINDS: readonly MapShapeKind[] = ['land', 'area', 'border']

/** A closed outline needs three corners; an open line needs two ends. */
export function minPointsFor(kind: MapShapeKind): number {
  return kind === 'border' ? 2 : 3
}

function mapDir(projectPath: string): string {
  return join(projectPath, MAP_DIR)
}

function mapShapePath(projectPath: string, id: string): string {
  return join(mapDir(projectPath), `${id}.md`)
}

interface MapShapeFrontmatter {
  id: string
  kind: MapShapeKind
  points: { x: number; y: number }[]
  created: string
  modified: string
}

function isKind(value: unknown): value is MapShapeKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value)
}

/** Keeps only entries with finite numeric x and y, rounded to whole pixels. */
function cleanPoints(value: unknown): { x: number; y: number }[] {
  if (!Array.isArray(value)) return []
  const out: { x: number; y: number }[] = []
  for (const p of value) {
    if (!p || typeof p !== 'object') continue
    const { x, y } = p as { x?: unknown; y?: unknown }
    if (typeof x !== 'number' || typeof y !== 'number') continue
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out.push({ x: Math.round(x), y: Math.round(y) })
  }
  return out
}

/** Null for anything that isn't a usable shape (a stray pin file has no
 *  `kind`, for one). */
function parseMapShapeFile(raw: string): MapShape | null {
  const data = matter(raw).data as Partial<Record<keyof MapShapeFrontmatter, unknown>>
  if (typeof data.id !== 'string' || !isKind(data.kind)) return null
  const points = cleanPoints(data.points)
  if (points.length < minPointsFor(data.kind)) return null
  return {
    id: data.id,
    kind: data.kind,
    points,
    created: typeof data.created === 'string' ? data.created : '',
    modified: typeof data.modified === 'string' ? data.modified : ''
  }
}

export async function writeMapShape(projectPath: string, shape: MapShape): Promise<void> {
  await fsp.mkdir(mapDir(projectPath), { recursive: true })
  const meta: MapShapeFrontmatter = {
    id: shape.id,
    kind: shape.kind,
    points: shape.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    created: shape.created,
    modified: new Date().toISOString()
  }
  const file = matter.stringify('', meta)
  await fsp.writeFile(mapShapePath(projectPath, shape.id), file, 'utf8')
}

/**
 * Every drawn shape in the project. A project with no map directory yet has
 * none — not an error, same rationale as `listMapPins`. Files that don't
 * parse as a shape (pins, bad kinds, too few points) are skipped.
 */
export async function listMapShapes(projectPath: string): Promise<MapShape[]> {
  const dir = mapDir(projectPath)
  let files: string[]
  try {
    files = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const shapes: MapShape[] = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    try {
      const raw = await fsp.readFile(join(dir, file), 'utf8')
      const shape = parseMapShapeFile(raw)
      if (shape) shapes.push(shape)
    } catch {
      // Skip unparsable entries; see listEntities for the same rationale.
      continue
    }
  }
  return shapes
}

export async function deleteMapShape(projectPath: string, id: string): Promise<void> {
  // force: true means a missing file is not an error.
  await fsp.rm(mapShapePath(projectPath, id), { force: true })
}
