import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { MapPin } from '../../shared/types'
import { assertPlainId, isPlainId } from './plainId'

const MAP_DIR = 'map'

function mapDir(projectPath: string): string {
  return join(projectPath, MAP_DIR)
}

/** Refuses an id that is not plain (see `plainId.ts`), so neither a write
 *  nor a delete can reach outside the folder. */
function mapPinPath(projectPath: string, id: string): string {
  assertPlainId(id, 'pin')
  return join(mapDir(projectPath), `${id}.md`)
}

interface MapPinFrontmatter {
  id: string
  entityId: string
  x: number
  y: number
  created: string
  modified: string
}

/** Throws on anything that is not a pin — the list skips it — rather than
 *  making a pin with no place and no position out of a stray file. */
function parseMapPinFile(raw: string): MapPin {
  const parsed = matter(raw)
  const data = parsed.data as MapPinFrontmatter
  if (
    !isPlainId(data.id) ||
    typeof data.entityId !== 'string' ||
    !Number.isFinite(data.x) ||
    !Number.isFinite(data.y)
  )
    throw new Error('Not a map pin')
  return {
    id: data.id,
    entityId: data.entityId,
    x: data.x,
    y: data.y,
    created: data.created,
    modified: data.modified
  }
}

export async function writeMapPin(projectPath: string, pin: MapPin): Promise<void> {
  const path = mapPinPath(projectPath, pin.id)
  await fsp.mkdir(mapDir(projectPath), { recursive: true })
  const meta: MapPinFrontmatter = {
    id: pin.id,
    entityId: pin.entityId,
    x: pin.x,
    y: pin.y,
    created: pin.created,
    modified: new Date().toISOString()
  }
  const file = matter.stringify('', meta)
  await fsp.writeFile(path, file, 'utf8')
}

/**
 * Every placed pin in the project. Projects created before F-12 simply have
 * no map directory yet — not an error, just an empty result, same rationale
 * as `listEntities`/`listPlotlines`/`listRelationships`.
 */
export async function listMapPins(projectPath: string): Promise<MapPin[]> {
  const dir = mapDir(projectPath)
  let files: string[]
  try {
    files = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const pins: MapPin[] = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    try {
      const raw = await fsp.readFile(join(dir, file), 'utf8')
      pins.push(parseMapPinFile(raw))
    } catch {
      // Skip unparsable entries; see listEntities for the same rationale.
      continue
    }
  }
  return pins
}

export async function deleteMapPin(projectPath: string, id: string): Promise<void> {
  // force: true means a missing file is not an error.
  await fsp.rm(mapPinPath(projectPath, id), { force: true })
}
