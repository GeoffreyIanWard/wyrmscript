import type { MapSheet, ProjectData } from '../../shared/types'

/**
 * Sync: the project's list of maps (`ProjectData.maps`), merged by map rather
 * than by line.
 *
 * project.json merges as text, and the maps list is one JSON array in it: two
 * devices each adding a map both append to it, which is the same lines
 * changed two ways — a conflict over the whole of "Binder & project
 * settings", resolved by keeping one side and losing the other's new map
 * (its name and its card on the board; its drawing survives, shown on World).
 * So before the text merge, the list is merged by map id:
 *
 * - a map added on either side is kept;
 * - a map deleted on one side is gone — unless the other side changed it in
 *   the meantime, in which case it is kept, since nothing is ever lost;
 * - a field changed on one side only takes that side's value; a field
 *   changed differently on both keeps this device's, as an entry's does, and
 *   a card's place moves as one x/y pair;
 * - the order is this device's, then the other's new maps after it.
 *
 * The merged list is then put into all three versions — base, ours and
 * theirs — so the text merge sees the same lines for it everywhere and
 * decides only the rest of the file.
 */

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Fields that are one value in two keys, merged as a pair. */
const PAIRS: (keyof MapSheet)[][] = [['boardX', 'boardY']]

function mergeSheet(base: MapSheet | undefined, ours: MapSheet, theirs: MapSheet): MapSheet {
  const out: Record<string, unknown> = {}
  const keys = new Set([...Object.keys(ours), ...Object.keys(theirs)])
  const pick = (b: unknown, o: unknown, t: unknown): unknown =>
    same(o, t) ? o : same(o, b) ? t : o
  for (const pair of PAIRS) {
    const value = pick(
      pair.map((k) => base?.[k]),
      pair.map((k) => ours[k]),
      pair.map((k) => theirs[k])
    ) as unknown[]
    pair.forEach((k, i) => {
      out[k] = value[i]
      keys.delete(k)
    })
  }
  for (const key of keys) {
    const k = key as keyof MapSheet
    out[k] = pick(base?.[k], ours[k], theirs[k])
  }
  // A cleared field is an absent key, never an undefined one.
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key]
  return out as unknown as MapSheet
}

/** The three versions' maps lists merged into one, by id. */
export function mergeMapLists(
  base: MapSheet[] | undefined,
  ours: MapSheet[] | undefined,
  theirs: MapSheet[] | undefined
): MapSheet[] {
  const b = new Map((base ?? []).map((m) => [m.id, m]))
  const o = new Map((ours ?? []).map((m) => [m.id, m]))
  const t = new Map((theirs ?? []).map((m) => [m.id, m]))
  const order = [...o.keys(), ...[...t.keys()].filter((id) => !o.has(id))]
  const out: MapSheet[] = []
  for (const id of order) {
    const was = b.get(id)
    const mine = o.get(id)
    const other = t.get(id)
    if (mine && other) out.push(mergeSheet(was, mine, other))
    // Gone on the other side: gone, unless this side changed it since.
    else if (mine) {
      if (!was || !same(mine, was)) out.push(mine)
    } else if (other) {
      if (!was || !same(other, was)) out.push(other)
    }
  }
  return out
}

/** The three project.json texts parsed, or null if any will not parse. */
function parseThree(
  base: string | null,
  ours: string | null,
  theirs: string | null
): [ProjectData, ProjectData, ProjectData] | null {
  if (base == null || ours == null || theirs == null) return null
  try {
    const parsed = [JSON.parse(base), JSON.parse(ours), JSON.parse(theirs)] as ProjectData[]
    return parsed.every((p) => p && typeof p === 'object')
      ? (parsed as [ProjectData, ProjectData, ProjectData])
      : null
  } catch {
    return null
  }
}

/** The merged maps list of three project.json texts, or null (see below). */
export function mergedMapsOf(
  base: string | null,
  ours: string | null,
  theirs: string | null
): MapSheet[] | null {
  const parsed = parseThree(base, ours, theirs)
  return parsed ? mergeMapLists(parsed[0].maps, parsed[1].maps, parsed[2].maps) : null
}

/**
 * project.json as the writer chose it in a conflict, with the merged maps
 * list put back in: whichever side they keep for the rest of the file, the
 * other device's new map is not lost with it.
 */
export function withMaps(text: string, maps: MapSheet[]): string {
  const data = JSON.parse(text) as Record<string, unknown>
  delete data.maps
  if (maps.length > 0) data.maps = maps
  return JSON.stringify(data, null, 2) + '\n'
}

/**
 * The three versions of project.json with their maps lists replaced by the
 * merged one — at the end of each object, the same place in all three — so
 * a text merge of them decides everything but the maps. Null when any
 * version will not parse, or there is no base to merge from: the text merge
 * then stands as it would have.
 */
export function withMergedMaps(
  base: string | null,
  ours: string | null,
  theirs: string | null
): [string, string, string] | null {
  const parsed = parseThree(base, ours, theirs)
  if (!parsed) return null
  const maps = mergeMapLists(parsed[0].maps, parsed[1].maps, parsed[2].maps)
  const write = (data: ProjectData): string => {
    const next: Record<string, unknown> = { ...data }
    delete next.maps
    if (maps.length > 0) next.maps = maps
    return JSON.stringify(next, null, 2) + '\n'
  }
  return [write(parsed[0]), write(parsed[1]), write(parsed[2])]
}
