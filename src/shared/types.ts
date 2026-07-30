export type BinderNodeType = 'folder' | 'doc'

export interface BinderNode {
  id: string
  type: BinderNodeType
  title: string
  children?: BinderNode[]
}

export type DocStatus = 'draft' | 'revised' | 'final'

export interface DocMeta {
  id: string
  title: string
  label?: string
  status?: DocStatus
  created: string
  modified: string
}

export interface ProjectData {
  version: 1
  title: string
  binder: BinderNode[]
  trash: BinderNode[]
}

export interface ProjectInfo {
  path: string
  data: ProjectData
}

export interface DocFile {
  meta: DocMeta
  body: string
}

export interface CommitInfo {
  oid: string
  message: string
  /** ms since epoch */
  timestamp: number
}

export interface VariantInfo {
  branch: string
  name: string
  /** ms since epoch */
  createdAt: number
  oid: string
}

/** API exposed to the renderer over the context bridge. */
export interface WyrmApi {
  /** Show a save dialog and create a fresh .wyrm project. Null if cancelled. */
  createProject(title: string): Promise<ProjectInfo | null>
  /** Show an open dialog and open an existing .wyrm project. Null if cancelled. */
  openProject(): Promise<ProjectInfo | null>
  /** Open a project by path (e.g. the last-used project). Null if missing/invalid. */
  openProjectPath(path: string): Promise<ProjectInfo | null>
  saveProject(path: string, data: ProjectData): Promise<void>
  readDoc(path: string, id: string): Promise<DocFile>
  writeDoc(path: string, doc: DocFile): Promise<void>
  /** Stage everything and commit if anything changed. Returns true if a commit was made. */
  commit(path: string, message: string): Promise<boolean>
  getLastProjectPath(): Promise<string | null>

  /** Commit history, newest first; docId scopes it to one document's file. */
  log(path: string, docId?: string): Promise<CommitInfo[]>
  /** A document as it existed at a commit oid or branch ref. Null if absent. */
  readDocAtRef(path: string, id: string, ref: string): Promise<DocFile | null>
  /** Restore a doc to its state at a ref, as a new commit (safety commit first). */
  restoreDocToRef(path: string, id: string, ref: string, label: string): Promise<DocFile>
  createVariant(path: string, docId: string, name: string): Promise<VariantInfo>
  listVariants(path: string, docId: string): Promise<VariantInfo[]>
  deleteVariant(path: string, branch: string): Promise<void>
}
