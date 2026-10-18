import { promises as fsp } from 'node:fs'
import { basename, extname, join } from 'node:path'
import matter from 'gray-matter'
import type { DocFile, Entity, EntityType } from '../../shared/types'
import { readDoc } from './project'

const DOCS_DIR = 'documents'

/** Where each entity flavour lives on disk, relative to the project root. */
const ENTITY_DIRS: Record<EntityType, string> = {
  glossary: 'glossary',
  character: 'characters',
  world: 'world'
}

function entityDir(projectPath: string, type: EntityType): string {
  return join(projectPath, ENTITY_DIRS[type])
}

function entityPath(projectPath: string, type: EntityType, id: string): string {
  return join(entityDir(projectPath, type), `${id}.md`)
}

interface EntityFrontmatter {
  id: string
  type: EntityType
  name: string
  aliases: string[]
  tags?: string[]
  pins?: string[]
  parentId?: string
  onBoard?: boolean
  boardX?: number
  boardY?: number
  portrait?: string
  created: string
  modified: string
}

function parseEntityFile(raw: string): Entity {
  const parsed = matter(raw)
  const data = parsed.data as EntityFrontmatter
  return {
    id: data.id,
    type: data.type,
    name: data.name,
    aliases: data.aliases ?? [],
    body: parsed.content.replace(/^\n/, ''),
    tags: data.tags,
    pins: data.pins,
    parentId: data.parentId,
    onBoard: data.onBoard,
    boardX: data.boardX,
    boardY: data.boardY,
    portrait: data.portrait,
    created: data.created,
    modified: data.modified
  }
}

export async function writeEntity(projectPath: string, entity: Entity): Promise<void> {
  await fsp.mkdir(entityDir(projectPath, entity.type), { recursive: true })
  const meta: EntityFrontmatter = {
    id: entity.id,
    type: entity.type,
    name: entity.name,
    aliases: entity.aliases,
    created: entity.created,
    modified: new Date().toISOString()
  }
  // Only written when set, so entities untouched by F-10/F-13 keep clean
  // frontmatter rather than gaining `tags: []` / `pins: []` / `parentId: ""`
  // on every save.
  if (entity.tags?.length) meta.tags = entity.tags
  if (entity.pins?.length) meta.pins = entity.pins
  if (entity.parentId) meta.parentId = entity.parentId
  // F-45. `onBoard` only when true; the positions on `!= null`, because 0 is
  // a real coordinate and truthiness would drop a card at the board's edge.
  if (entity.onBoard) meta.onBoard = true
  if (entity.boardX != null) meta.boardX = entity.boardX
  if (entity.boardY != null) meta.boardY = entity.boardY
  // F-47. Only when set, like the fields above: clearing a portrait deletes
  // the key on the renderer side, and the file must then say nothing about
  // one — `portrait: ''` would point the card at an image that is not there.
  if (entity.portrait) meta.portrait = entity.portrait
  const file = matter.stringify(entity.body.endsWith('\n') ? entity.body : entity.body + '\n', meta)
  await fsp.writeFile(entityPath(projectPath, entity.type, entity.id), file, 'utf8')
}

/**
 * Every story-bible entry across all three types. Projects created before
 * this feature existed simply have none of the entity directories — that's
 * not an error, just an empty result for that type.
 *
 * Files that fail to parse (hand-edited garbage, corrupted frontmatter) are
 * skipped rather than failing the whole list: a single bad entry shouldn't
 * take down the entire story bible.
 */
export async function listEntities(projectPath: string): Promise<Entity[]> {
  const entities: Entity[] = []
  for (const type of Object.keys(ENTITY_DIRS) as EntityType[]) {
    const dir = entityDir(projectPath, type)
    let files: string[]
    try {
      files = await fsp.readdir(dir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }
    for (const file of files) {
      if (!file.endsWith('.md')) continue
      try {
        const raw = await fsp.readFile(join(dir, file), 'utf8')
        entities.push(parseEntityFile(raw))
      } catch {
        // Skip unparsable entries; see doc comment above.
        continue
      }
    }
  }
  return entities
}

export async function deleteEntity(
  projectPath: string,
  type: EntityType,
  id: string
): Promise<void> {
  // force: true means a missing file is not an error.
  await fsp.rm(entityPath(projectPath, type, id), { force: true })
  // The portrait goes with the entry (F-47). It is not an entry, so nothing
  // else would ever list it or remove it — it would sit in the folder, in
  // every backup and on every synced device, for an entry that no longer
  // exists.
  await removePortrait(projectPath, type, id)
}

/* ---------- portraits (F-47) ---------- */

/**
 * The image types a portrait may be, keyed by extension, with the mime the
 * renderer needs to show one. A closed set, checked at the copy: a picker
 * filter that drifted from this list could otherwise land a file here that
 * `readPortraitDataUrl` has no mime for, and the card would show nothing
 * with no error anywhere.
 */
const PORTRAIT_MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}
const PORTRAIT_EXTS = Object.keys(PORTRAIT_MIMES)

/**
 * The id is the only thing the renderer names, and here it becomes a
 * filename inside the project — so one carrying a separator or `..` is
 * refused outright rather than resolved to wherever it points. Every id this
 * app mints is base-36, so a real one never trips this.
 */
function assertPlainId(id: string): void {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error(`Not a valid entry id: ${JSON.stringify(id)}`)
  }
}

/** The portrait on disk for this entry, if any — found by extension rather
 *  than from the entry's record, which can lag the folder after a sync. */
async function findPortraitExt(dir: string, id: string): Promise<string | null> {
  for (const ext of PORTRAIT_EXTS) {
    try {
      await fsp.access(join(dir, id + ext))
      return ext
    } catch {
      continue
    }
  }
  return null
}

/**
 * Copy an image into the project as the entry's portrait and return the
 * project-relative filename to store on the entry. `sourceAbs` is wherever
 * the native picker pointed; the destination is derived from the type and
 * id alone.
 */
export async function copyPortrait(
  projectPath: string,
  entityType: EntityType,
  entityId: string,
  sourceAbs: string
): Promise<string> {
  assertPlainId(entityId)
  // Lowercased so `face.PNG` and `face.png` are one file, not two portraits
  // for one entry with the reader finding whichever the loop reaches first.
  const ext = extname(sourceAbs).toLowerCase()
  if (!PORTRAIT_MIMES[ext]) throw new Error(`Not a supported image: ${basename(sourceAbs)}`)
  const dir = entityDir(projectPath, entityType)
  await fsp.mkdir(dir, { recursive: true })
  // The old portrait goes first, whatever its extension. A replacement with a
  // different one would otherwise leave both on disk, and the reader picks by
  // extension order, not by date — choose a new .jpg over an old .png and the
  // card would keep showing the old face.
  await removePortrait(projectPath, entityType, entityId)
  await fsp.copyFile(sourceAbs, join(dir, entityId + ext))
  // Forward slashes whatever the platform: this is the frontmatter value, and
  // a project written on Windows is opened on a Mac.
  return `${ENTITY_DIRS[entityType]}/${entityId}${ext}`
}

/** The entry's portrait as a `data:` URL the renderer can show as-is, or null
 *  when it has none. */
export async function readPortraitDataUrl(
  projectPath: string,
  entityType: EntityType,
  entityId: string
): Promise<string | null> {
  assertPlainId(entityId)
  const dir = entityDir(projectPath, entityType)
  const ext = await findPortraitExt(dir, entityId)
  if (!ext) return null
  const bytes = await fsp.readFile(join(dir, entityId + ext))
  return `data:${PORTRAIT_MIMES[ext]};base64,${bytes.toString('base64')}`
}

/** Delete the entry's portrait. A no-op when there is none. */
export async function removePortrait(
  projectPath: string,
  entityType: EntityType,
  entityId: string
): Promise<void> {
  assertPlainId(entityId)
  const dir = entityDir(projectPath, entityType)
  // Every extension, not only the one the entry records: a frontmatter out of
  // step with the folder (one side of a sync renamed the image) would
  // otherwise leave an orphan behind that no later import ever replaces.
  for (const ext of PORTRAIT_EXTS) await fsp.rm(join(dir, entityId + ext), { force: true })
}

/** All documents with metadata, for backlink computation. */
export async function readAllDocs(projectPath: string): Promise<DocFile[]> {
  const dir = join(projectPath, DOCS_DIR)
  let files: string[]
  try {
    files = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const docs: DocFile[] = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    try {
      docs.push(await readDoc(projectPath, file.slice(0, -3)))
    } catch {
      // Skip unparsable/unreadable docs, same rationale as listEntities.
      continue
    }
  }
  return docs
}
