import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import matter from 'gray-matter'
import type { BinderNode, DocFile, DocMeta, ProjectData, ProjectInfo } from '../../shared/types'
import { commitAll, initRepo, readFileAtRef } from './git'

const PROJECT_FILE = 'project.json'
const DOCS_DIR = 'documents'

function docPath(projectPath: string, id: string): string {
  return join(projectPath, DOCS_DIR, `${id}.md`)
}

export function newId(): string {
  return randomUUID().slice(0, 8)
}

export async function writeDoc(projectPath: string, doc: DocFile): Promise<void> {
  const meta: DocMeta = { ...doc.meta, modified: new Date().toISOString() }
  const file = matter.stringify(doc.body.endsWith('\n') ? doc.body : doc.body + '\n', meta)
  await fsp.writeFile(docPath(projectPath, meta.id), file, 'utf8')
}

export async function readDoc(projectPath: string, id: string): Promise<DocFile> {
  const raw = await fsp.readFile(docPath(projectPath, id), 'utf8')
  return parseDocFile(raw)
}

function parseDocFile(raw: string): DocFile {
  const parsed = matter(raw)
  const meta = parsed.data as DocMeta
  return { meta, body: parsed.content.replace(/^\n/, '') }
}

/** Repo-relative path of a document file, for git log filtering. */
export function docRepoPath(id: string): string {
  return `${DOCS_DIR}/${id}.md`
}

/** A document as it existed at a commit oid or branch ref. Null if absent. */
export async function readDocAtRef(
  projectPath: string,
  id: string,
  ref: string
): Promise<DocFile | null> {
  const raw = await readFileAtRef(projectPath, ref, docRepoPath(id))
  return raw == null ? null : parseDocFile(raw)
}

/**
 * Restore a document to its exact state at a ref (commit oid or variant
 * branch), as a NEW commit — never rewriting history. A safety commit of any
 * pending changes happens first, so restore itself can always be undone.
 */
export async function restoreDocToRef(
  projectPath: string,
  id: string,
  ref: string,
  label: string
): Promise<DocFile> {
  const raw = await readFileAtRef(projectPath, ref, docRepoPath(id))
  if (raw == null) throw new Error(`Document ${id} does not exist at ${ref}`)
  await commitAll(projectPath, 'Auto: before restore')
  await fsp.writeFile(docPath(projectPath, id), raw, 'utf8')
  await commitAll(projectPath, label)
  return parseDocFile(raw)
}

export async function saveProject(projectPath: string, data: ProjectData): Promise<void> {
  await fsp.writeFile(join(projectPath, PROJECT_FILE), JSON.stringify(data, null, 2) + '\n', 'utf8')
}

export async function openProject(projectPath: string): Promise<ProjectInfo> {
  const raw = await fsp.readFile(join(projectPath, PROJECT_FILE), 'utf8')
  const data = JSON.parse(raw) as ProjectData
  return { path: projectPath, data }
}

export async function createProject(projectPath: string, title: string): Promise<ProjectInfo> {
  await fsp.mkdir(join(projectPath, DOCS_DIR), { recursive: true })

  const now = new Date().toISOString()
  const firstDoc: DocMeta = {
    id: newId(),
    title: 'First Scene',
    status: 'draft',
    created: now,
    modified: now
  }
  const binder: BinderNode[] = [
    {
      id: newId(),
      type: 'folder',
      title: 'Manuscript',
      children: [{ id: firstDoc.id, type: 'doc', title: firstDoc.title }]
    },
    { id: newId(), type: 'folder', title: 'Notes', children: [] }
  ]
  const data: ProjectData = { version: 1, title, binder, trash: [] }

  await fsp.writeFile(
    join(projectPath, '.gitignore'),
    '# WyrmStar project — everything is versioned\n.DS_Store\n',
    'utf8'
  )
  await saveProject(projectPath, data)
  await writeDoc(projectPath, { meta: firstDoc, body: '' })

  await initRepo(projectPath)
  await commitAll(projectPath, `Create project “${title}”`)

  return { path: projectPath, data }
}
