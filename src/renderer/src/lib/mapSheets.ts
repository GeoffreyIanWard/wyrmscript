import type { MapSheet, ProjectData } from '../../../shared/types'
import { mapOf, WORLD_MAP } from '../../../shared/types'

/**
 * F-12: the project's maps, as tabs. Pure, like the rest of the map's maths.
 *
 * The first map, World, is the map there was before there were several: its
 * extent and scale stay in `ProjectData.mapBounds` and `mapScale`, so a
 * project from before reads unchanged and nothing on disk is rewritten. An
 * entry in `maps` with World's id carries only what those fields do not —
 * a new name, its card on the board. Every other map is an entry in `maps`,
 * in tab order. Read and write them only through here, so World's two homes
 * never drift apart.
 */

export const WORLD_NAME = 'World'

/** The longest a map's name can be: it is a tab, not a title page. */
export const MAP_NAME_MAX = 40

/** Every map, World first, then the rest in tab order. */
export function sheetsOf(data: ProjectData): MapSheet[] {
  const entry = data.maps?.find((m) => m.id === WORLD_MAP)
  const world: MapSheet = {
    ...entry,
    id: WORLD_MAP,
    name: entry?.name || WORLD_NAME
  }
  if (data.mapBounds) world.bounds = data.mapBounds
  else delete world.bounds
  if (data.mapScale) world.scale = data.mapScale
  else delete world.scale
  return [world, ...(data.maps ?? []).filter((m) => m.id !== WORLD_MAP && m.name)]
}

/** One map by id; World for an id no map has (a map deleted on another
 *  device, a stale tab) — the map view always has a map to show. */
export function sheetOf(data: ProjectData, id: string): MapSheet {
  const sheets = sheetsOf(data)
  return sheets.find((m) => m.id === id) ?? sheets[0]
}

/** Whether a map by this id exists. */
export function hasSheet(data: ProjectData, id: string): boolean {
  return sheetsOf(data).some((m) => m.id === id)
}

/** A key cleared on a sheet is deleted, never kept as undefined: project.json
 *  is JSON, and a key that says nothing should not be there to merge. */
function tidy(sheet: MapSheet): MapSheet {
  const out = { ...sheet }
  for (const k of Object.keys(out) as (keyof MapSheet)[]) if (out[k] === undefined) delete out[k]
  return out
}

/**
 * The project with one map changed. For World, the extent and scale go to
 * their own fields and anything else to its entry in `maps` (made only when
 * there is something to keep there). Unknown ids change nothing.
 */
export function withSheet(
  data: ProjectData,
  id: string,
  patch: Partial<Omit<MapSheet, 'id'>>
): ProjectData {
  if (!hasSheet(data, id)) return data
  const next: ProjectData = { ...data }
  const maps = [...(data.maps ?? [])]
  if (id === WORLD_MAP) {
    const { bounds, scale, ...rest } = patch
    if ('bounds' in patch) {
      if (bounds) next.mapBounds = bounds
      else delete next.mapBounds
    }
    if ('scale' in patch) {
      if (scale) next.mapScale = scale
      else delete next.mapScale
    }
    if (Object.keys(rest).length > 0) {
      const i = maps.findIndex((m) => m.id === WORLD_MAP)
      const entry = tidy({
        name: WORLD_NAME,
        ...(i >= 0 ? maps[i] : {}),
        ...rest,
        id: WORLD_MAP
      })
      // An entry that would say only "World" is no entry at all.
      const keep = entry.name !== WORLD_NAME || Object.keys(entry).length > 2
      if (i >= 0) {
        if (keep) maps[i] = entry
        else maps.splice(i, 1)
      } else if (keep) maps.unshift(entry)
    }
  } else {
    const i = maps.findIndex((m) => m.id === id)
    maps[i] = tidy({ ...maps[i], ...patch, id })
  }
  if (maps.length > 0) next.maps = maps
  else delete next.maps
  return next
}

/** The project with a new map at the end of the tabs. */
export function withNewSheet(data: ProjectData, sheet: MapSheet): ProjectData {
  return { ...data, maps: [...(data.maps ?? []), tidy(sheet)] }
}

/** The project without a map. World cannot be removed — it is cleared. */
export function withoutSheet(data: ProjectData, id: string): ProjectData {
  if (id === WORLD_MAP) return data
  const maps = (data.maps ?? []).filter((m) => m.id !== id)
  const next: ProjectData = { ...data }
  if (maps.length > 0) next.maps = maps
  else delete next.maps
  return next
}

/** What is wrong with a name for a map, or null: it needs words, a tab's
 *  length at most, and no other map of the same name. */
export function mapNameProblem(data: ProjectData, name: string, except?: string): string | null {
  const n = name.trim()
  if (!n) return 'A map needs a name.'
  if (n.length > MAP_NAME_MAX) return `A map’s name can be ${MAP_NAME_MAX} letters at most.`
  const same = sheetsOf(data).find(
    (m) => m.id !== except && m.name.toLowerCase() === n.toLowerCase()
  )
  return same ? `There is already a map called “${same.name}”.` : null
}

/** The records on one map. */
export function onMap<T extends { map?: string }>(records: T[], id: string): T[] {
  return records.filter((r) => mapOf(r) === id)
}

/**
 * The records a map shows. World also shows any whose map is gone — deleted
 * on another device while this one drew on it, or its entry lost in a
 * project.json conflict — so nothing drawn is ever on no tab at all: it
 * can be seen, moved, and cleared from World.
 */
export function recordsOn<T extends { map?: string }>(
  records: T[],
  id: string,
  data: ProjectData
): T[] {
  if (id !== WORLD_MAP) return onMap(records, id)
  const known = new Set(sheetsOf(data).map((m) => m.id))
  return records.filter((r) => {
    const map = mapOf(r)
    return map === WORLD_MAP || !known.has(map)
  })
}

/** The next unused "Map 2", "Map 3"… for a new map's first name. */
export function freshMapName(data: ProjectData): string {
  const taken = new Set(sheetsOf(data).map((m) => m.name.toLowerCase()))
  for (let n = 2; ; n++) if (!taken.has(`map ${n}`)) return `Map ${n}`
}

/** What a map has on it, said as a writer would: "3 shapes, 12 marks and 2
 *  places", or null for nothing at all. */
export function contentsOf(counts: {
  shapes: number
  marks: number
  places: number
}): string | null {
  const parts = [
    counts.shapes ? `${counts.shapes} ${counts.shapes === 1 ? 'shape' : 'shapes'}` : null,
    counts.marks ? `${counts.marks} ${counts.marks === 1 ? 'mark' : 'marks'}` : null,
    counts.places ? `${counts.places} ${counts.places === 1 ? 'place' : 'places'}` : null
  ].filter((p): p is string => p != null)
  if (parts.length === 0) return null
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}
