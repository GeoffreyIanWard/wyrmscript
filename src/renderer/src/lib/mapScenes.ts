import type { BinderNode, DocFile, Entity, MapPin } from '../../../shared/types'
import { SCENE_TAG } from '../../../shared/types'
import { flattenBinder } from './compile'
import { locationChain } from './locations'

/**
 * F-42: scenes on the map. A scene's card says where it happens (`location`,
 * a World Book place, from the back of the card); the map shows, at each
 * place's pin, how many scenes happen there. Pure, like the rest of the
 * map's maths.
 *
 * A scene set somewhere with no pin of its own on this map counts at the
 * nearest place it is inside that has one (F-13's nesting): a scene in the
 * Drowned Quarter shows at Harrowgate on the world map, and at the Drowned
 * Quarter itself on a plan of the city that pins it.
 */

export interface SceneAtPlace {
  id: string
  title: string
}

/** Every scene, in binder order, with where it happens. */
export function scenesOf(
  docs: DocFile[],
  binder: BinderNode[]
): (SceneAtPlace & { location?: string })[] {
  const byId = new Map(docs.map((d) => [d.meta.id, d]))
  return flattenBinder(binder, null).flatMap(({ node }) => {
    const doc = byId.get(node.id)
    if (!doc?.meta.tags?.includes(SCENE_TAG)) return []
    return [{ id: node.id, title: node.title, location: doc.meta.location }]
  })
}

/**
 * The scenes at each pin, by pin id, in binder order. `pins` are one map's;
 * a scene counts once, at the innermost place on its location's chain that
 * has a pin there.
 */
export function scenesByPin(
  pins: MapPin[],
  scenes: (SceneAtPlace & { location?: string })[],
  entities: Entity[]
): Map<string, SceneAtPlace[]> {
  const pinOf = new Map(pins.map((p) => [p.entityId, p]))
  const out = new Map<string, SceneAtPlace[]>()
  for (const scene of scenes) {
    if (!scene.location) continue
    // Innermost first: the place itself, then what it is inside.
    const chain = locationChain(entities, scene.location).reverse()
    // A place since deleted from the World Book still has its id.
    const ids = chain.length > 0 ? chain.map((e) => e.id) : [scene.location]
    const pin = ids.map((id) => pinOf.get(id)).find((p) => p != null)
    if (!pin) continue
    const list = out.get(pin.id) ?? []
    list.push({ id: scene.id, title: scene.title })
    out.set(pin.id, list)
  }
  return out
}

/** How the count is said: "1 scene", "3 scenes". */
export function sceneCount(n: number): string {
  return `${n} ${n === 1 ? 'scene' : 'scenes'}`
}
