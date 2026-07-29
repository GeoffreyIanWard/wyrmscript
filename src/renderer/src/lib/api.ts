import type { BinderNode, DocFile, ProjectData, ProjectInfo, WyrmApi } from '../../../shared/types'

/**
 * In Electron the preload script exposes the real filesystem/git API on
 * window.wyrm. In a plain browser (the dev preview pane) we substitute an
 * in-memory mock seeded with a demo project so the full UI stays exercisable.
 */

function id(): string {
  return Math.random().toString(36).slice(2, 10)
}

function demoProject(): { info: ProjectInfo; docs: Map<string, DocFile> } {
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
  return { info, docs }
}

function createMockApi(): WyrmApi {
  const demo = demoProject()
  const projects = new Map<string, { info: ProjectInfo; docs: Map<string, DocFile> }>([
    [demo.info.path, demo]
  ])

  return {
    async createProject(title: string): Promise<ProjectInfo> {
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
      projects.set(info.path, { info, docs })
      return info
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
      const doc = projects.get(path)?.docs.get(docId)
      if (!doc) throw new Error(`No such document: ${docId}`)
      return doc
    },
    async writeDoc(path: string, doc: DocFile): Promise<void> {
      projects.get(path)?.docs.set(doc.meta.id, doc)
    },
    async commit(): Promise<boolean> {
      return true
    },
    async getLastProjectPath(): Promise<string | null> {
      return demo.info.path
    }
  }
}

export const api: WyrmApi = window.wyrm ?? createMockApi()
export const isElectron = Boolean(window.wyrm)
