import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { Relationship } from '../../shared/types'

const RELATIONSHIPS_DIR = 'relationships'

function relationshipDir(projectPath: string): string {
  return join(projectPath, RELATIONSHIPS_DIR)
}

function relationshipPath(projectPath: string, id: string): string {
  return join(relationshipDir(projectPath), `${id}.md`)
}

interface RelationshipFrontmatter {
  id: string
  fromId: string
  toId: string
  label: string
  created: string
  modified: string
}

function parseRelationshipFile(raw: string): Relationship {
  const parsed = matter(raw)
  const data = parsed.data as RelationshipFrontmatter
  return {
    id: data.id,
    fromId: data.fromId,
    toId: data.toId,
    label: data.label,
    created: data.created,
    modified: data.modified
  }
}

export async function writeRelationship(
  projectPath: string,
  relationship: Relationship
): Promise<void> {
  await fsp.mkdir(relationshipDir(projectPath), { recursive: true })
  const meta: RelationshipFrontmatter = {
    id: relationship.id,
    fromId: relationship.fromId,
    toId: relationship.toId,
    label: relationship.label,
    created: relationship.created,
    modified: new Date().toISOString()
  }
  const file = matter.stringify('', meta)
  await fsp.writeFile(relationshipPath(projectPath, relationship.id), file, 'utf8')
}

/**
 * Every relationship in the project. Projects created before F-11 simply
 * have no relationships directory yet — not an error, just an empty
 * result, same rationale as `listEntities`/`listPlotlines`.
 */
export async function listRelationships(projectPath: string): Promise<Relationship[]> {
  const dir = relationshipDir(projectPath)
  let files: string[]
  try {
    files = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const relationships: Relationship[] = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    try {
      const raw = await fsp.readFile(join(dir, file), 'utf8')
      relationships.push(parseRelationshipFile(raw))
    } catch {
      // Skip unparsable entries; see listEntities for the same rationale.
      continue
    }
  }
  return relationships
}

export async function deleteRelationship(projectPath: string, id: string): Promise<void> {
  // force: true means a missing file is not an error.
  await fsp.rm(relationshipPath(projectPath, id), { force: true })
}
