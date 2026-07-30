import type {
  BinderNode,
  CommitInfo,
  DocFile,
  Entity,
  EntityType,
  ProjectData,
  ProjectInfo,
  VariantInfo,
  WyrmApi
} from '../../../shared/types'

/**
 * In Electron the preload script exposes the real filesystem/git API on
 * window.wyrm. In a plain browser (the dev preview pane) we substitute an
 * in-memory mock seeded with a demo project — including fake history and
 * variants — so the full UI stays exercisable. Nothing here touches disk.
 */

function id(): string {
  return Math.random().toString(36).slice(2, 10)
}

const cloneDoc = (doc: DocFile): DocFile => ({ meta: { ...doc.meta }, body: doc.body })
const cloneEntity = (entity: Entity): Entity => ({ ...entity, aliases: [...entity.aliases] })

interface MockCommit extends CommitInfo {
  snapshot: Map<string, DocFile>
}

interface MockProject {
  info: ProjectInfo
  docs: Map<string, DocFile>
  commits: MockCommit[] // newest last
  variants: Map<string, (VariantInfo & { doc: DocFile })[]>
  entities: Map<string, Entity>
}

function snapshotOf(docs: Map<string, DocFile>): Map<string, DocFile> {
  return new Map([...docs].map(([k, v]) => [k, cloneDoc(v)]))
}

function commitInto(project: MockProject, message: string, timestamp = Date.now()): boolean {
  const last = project.commits[project.commits.length - 1]
  const same =
    last &&
    last.snapshot.size === project.docs.size &&
    [...project.docs].every(([k, v]) => last.snapshot.get(k)?.body === v.body)
  if (same) return false
  project.commits.push({
    oid: id() + id(),
    message,
    timestamp,
    snapshot: snapshotOf(project.docs)
  })
  return true
}

function starterProject(title: string): MockProject {
  const now = new Date().toISOString()
  const docId = id()
  const docs = new Map<string, DocFile>([
    [
      docId,
      {
        meta: { id: docId, title: 'First Scene', status: 'draft', created: now, modified: now },
        body: ''
      }
    ]
  ])
  const info: ProjectInfo = {
    path: `/demo/${title}.wyrm`,
    data: {
      version: 1,
      title,
      binder: [
        {
          id: id(),
          type: 'folder',
          title: 'Manuscript',
          children: [{ id: docId, type: 'doc', title: 'First Scene' }]
        },
        { id: id(), type: 'folder', title: 'Notes', children: [] }
      ],
      trash: []
    }
  }
  const project: MockProject = { info, docs, commits: [], variants: new Map(), entities: new Map() }
  commitInto(project, `Create project “${title}”`)
  return project
}

function demoProject(): MockProject {
  const now = new Date().toISOString()
  const docs = new Map<string, DocFile>()
  const mkDoc = (title: string, body: string): BinderNode => {
    const docId = id()
    docs.set(docId, {
      meta: { id: docId, title, status: 'draft', created: now, modified: now },
      body
    })
    return { id: docId, type: 'doc', title }
  }

  const scene1 = mkDoc(
    'The Wyrmlight Fades',
    'The last of the wyrmlight was going out of the harbor glass, pane by pane, the way the tide leaves a flat.\n'
  )
  const scene2 = mkDoc(
    'A Knock at Night',
    'The knock came an hour past midnight, three slow raps that carried through the shutters like stones dropped down a well. Elara Voss was awake before the third. Old habits from the war did not sleep, even when she did.\n\nShe lit no candle. The wyrmlight in the window-glass gave enough of a glow to dress by — that faint green shimmer every house in Harrowgate had learned to live with, the way one lives with tinnitus or a creaking stair. *Someone is standing very still out there,* she thought, buckling her belt.\n\nThe knock came again. Not louder. **Exactly** as loud, which was worse — a patience that had rehearsed itself.\n\nOn the landing she paused at the little shrine to the Drowned Saints and did not pray, exactly, but made the old harbor-sign with two fingers. Marten would have laughed at her for it. Marten laughed at everything, which was ==the first thing the sea took== and the last thing she intended to get back.\n'
  )
  const scene3 = mkDoc('Ashes on the Tide', '')
  const timeline = mkDoc('Timeline', 'Year 0 — the Siege of the Narrows.\n')

  const info: ProjectInfo = {
    path: '/demo/The Wyrm of Winter.wyrm',
    data: {
      version: 1,
      title: 'The Wyrm of Winter',
      binder: [
        {
          id: id(),
          type: 'folder',
          title: 'Manuscript',
          children: [
            {
              id: id(),
              type: 'folder',
              title: 'Part One — The Harbor',
              children: [scene1, scene2, scene3]
            }
          ]
        },
        { id: id(), type: 'folder', title: 'Notes', children: [timeline] }
      ],
      trash: []
    }
  }

  const entities = new Map<string, Entity>()
  const mkEntity = (type: EntityType, name: string, aliases: string[], body: string): void => {
    const entityId = id()
    entities.set(entityId, { id: entityId, type, name, aliases, body, created: now, modified: now })
  }
  mkEntity(
    'character',
    'Elara Voss',
    ['Elara', 'Captain Voss', 'the Captain'],
    'Former harbor-guard captain of Harrowgate, cashiered after the Siege of the Narrows. Keeps her old commission folded in a tobacco tin she never opens. Sister to Marten (deceased). Sleeps badly; notices everything.'
  )
  mkEntity(
    'character',
    'Marten',
    [],
    "Elara's younger brother. Laughed at everything, which is the first thing the sea took. Drowned during the Siege; she has never said his name out loud since."
  )
  mkEntity(
    'world',
    'Harrowgate',
    ['the harbor city'],
    'Salt-eaten harbor city built on the bones of an older one. Every window pane in it carries a faint green wyrmlight shimmer the residents no longer notice.'
  )
  mkEntity(
    'world',
    'Winter Court',
    ['the Court'],
    'The inland power that sends envoys rather than armies. Its regards are never only regards.'
  )
  mkEntity(
    'glossary',
    'wyrmlight',
    ['wyrm-light'],
    'The faint green luminescence that clings to glass in Harrowgate. Harmless, constant, and impossible to scrub off.'
  )
  mkEntity(
    'glossary',
    'Drowned Saints',
    ['the Saints'],
    'Harbor deities of uncertain number. Sailors make the harbor-sign with two fingers rather than pray aloud.'
  )

  const project: MockProject = { info, docs, commits: [], variants: new Map(), entities }

  // Fabricate believable history for the demo: three drafts of scene2.
  const hours = 3600_000
  const knockId = scene2.id
  const current = docs.get(knockId)!
  const draft1 =
    'The knock came after midnight. Elara Voss woke at once. Old habits from the war did not sleep.\n'
  const draft2 =
    'The knock came an hour past midnight, three slow raps. Elara Voss was awake before the third. Old habits from the war did not sleep, even when she did.\n\nShe lit no candle. The wyrmlight in the window-glass gave enough of a glow to dress by.\n'

  docs.set(knockId, { ...current, body: draft1 })
  commitInto(project, 'First pass at the opening', Date.now() - 26 * hours)
  docs.set(knockId, { ...current, body: draft2 })
  commitInto(project, 'Slower rhythm on the knocks', Date.now() - 20 * hours)
  docs.set(knockId, current)
  commitInto(project, 'Finished second draft of the confrontation scene', Date.now() - 2 * hours)

  return project
}

export function createMockApi(): WyrmApi {
  const demo = demoProject()
  const projects = new Map<string, MockProject>([[demo.info.path, demo]])

  const mustGet = (path: string): MockProject => {
    const project = projects.get(path)
    if (!project) throw new Error(`No such project: ${path}`)
    return project
  }

  const findAtRef = (project: MockProject, docId: string, ref: string): DocFile | null => {
    const commit = project.commits.find((c) => c.oid === ref)
    if (commit) return commit.snapshot.get(docId) ?? null
    for (const list of project.variants.values()) {
      const variant = list.find((v) => v.branch === ref)
      if (variant) return cloneDoc(variant.doc)
    }
    return null
  }

  return {
    async createProject(title: string): Promise<ProjectInfo> {
      const project = starterProject(title || 'Untitled Novel')
      projects.set(project.info.path, project)
      return project.info
    },
    async openProject(): Promise<ProjectInfo> {
      return demo.info
    },
    async openProjectPath(path: string): Promise<ProjectInfo | null> {
      return projects.get(path)?.info ?? null
    },
    async saveProject(path: string, data: ProjectData): Promise<void> {
      const project = projects.get(path)
      if (project) project.info = { path, data }
    },
    async readDoc(path: string, docId: string): Promise<DocFile> {
      const doc = mustGet(path).docs.get(docId)
      if (!doc) throw new Error(`No such document: ${docId}`)
      return doc
    },
    async writeDoc(path: string, doc: DocFile): Promise<void> {
      mustGet(path).docs.set(doc.meta.id, cloneDoc(doc))
    },
    async commit(path: string, message: string): Promise<boolean> {
      return commitInto(mustGet(path), message)
    },
    async getLastProjectPath(): Promise<string | null> {
      return demo.info.path
    },

    async log(path: string, docId?: string): Promise<CommitInfo[]> {
      const project = mustGet(path)
      const all = [...project.commits].reverse()
      if (!docId) return all.map(({ oid, message, timestamp }) => ({ oid, message, timestamp }))
      // Keep only commits where this doc changed relative to its parent.
      const result: CommitInfo[] = []
      for (let i = 0; i < project.commits.length; i++) {
        const cur = project.commits[i].snapshot.get(docId)
        const prev = i > 0 ? project.commits[i - 1].snapshot.get(docId) : undefined
        if (cur && cur.body !== prev?.body) {
          const { oid, message, timestamp } = project.commits[i]
          result.unshift({ oid, message, timestamp })
        }
      }
      return result
    },
    async readDocAtRef(path: string, docId: string, ref: string): Promise<DocFile | null> {
      return findAtRef(mustGet(path), docId, ref)
    },
    async restoreDocToRef(
      path: string,
      docId: string,
      ref: string,
      label: string
    ): Promise<DocFile> {
      const project = mustGet(path)
      const doc = findAtRef(project, docId, ref)
      if (!doc) throw new Error(`Document ${docId} does not exist at ${ref}`)
      commitInto(project, 'Auto: before restore')
      project.docs.set(docId, cloneDoc(doc))
      commitInto(project, label)
      return doc
    },
    async createVariant(path: string, docId: string, name: string): Promise<VariantInfo> {
      const project = mustGet(path)
      commitInto(project, `Snapshot for variant “${name}”`)
      const doc = project.docs.get(docId)
      if (!doc) throw new Error(`No such document: ${docId}`)
      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'variant'
      const variant = {
        branch: `variant/${docId}/${slug}-${id()}`,
        name,
        createdAt: Date.now(),
        oid: project.commits[project.commits.length - 1].oid,
        doc: cloneDoc(doc)
      }
      const list = project.variants.get(docId) ?? []
      list.push(variant)
      project.variants.set(docId, list)
      return { branch: variant.branch, name, createdAt: variant.createdAt, oid: variant.oid }
    },
    async listVariants(path: string, docId: string): Promise<VariantInfo[]> {
      const list = mustGet(path).variants.get(docId) ?? []
      return [...list]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(({ branch, name, createdAt, oid }) => ({ branch, name, createdAt, oid }))
    },
    async deleteVariant(path: string, branch: string): Promise<void> {
      const project = mustGet(path)
      for (const [docId, list] of project.variants) {
        project.variants.set(
          docId,
          list.filter((v) => v.branch !== branch)
        )
      }
    },

    async listEntities(path: string): Promise<Entity[]> {
      return [...mustGet(path).entities.values()].map(cloneEntity)
    },
    async writeEntity(path: string, entity: Entity): Promise<void> {
      mustGet(path).entities.set(entity.id, {
        ...cloneEntity(entity),
        modified: new Date().toISOString()
      })
    },
    async deleteEntity(path: string, _type: EntityType, id: string): Promise<void> {
      mustGet(path).entities.delete(id)
    },
    async readAllDocs(path: string): Promise<DocFile[]> {
      return [...mustGet(path).docs.values()].map(cloneDoc)
    }
  }
}

export const api: WyrmApi = window.wyrm ?? createMockApi()
export const isElectron = Boolean(window.wyrm)
