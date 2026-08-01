import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
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
