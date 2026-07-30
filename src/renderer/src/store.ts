import { create } from 'zustand'
import type { Editor } from '@tiptap/core'
import type { BinderNode, DocFile, ProjectInfo } from '../../shared/types'
import { api } from './lib/api'
import { docToMarkdown, markdownToDoc, countWords } from './lib/markdown'
import { findNode, firstDoc, moveNode, removeNode, type DropPosition } from './lib/tree'

export type SaveState = 'saved' | 'dirty' | 'saving'

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

interface WyrmState {
  project: ProjectInfo | null
  booted: boolean
  activeId: string | null
  activeDoc: DocFile | null
  editor: Editor | null
  saveState: SaveState
  wordCount: number
  lastCommitAt: number | null
  renamingId: string | null

  boot(): Promise<void>
  newProject(title: string): Promise<void>
  openProject(): Promise<void>
  selectDoc(id: string): Promise<void>
  setEditor(editor: Editor | null): void
  editorChanged(): void
  flushSave(): Promise<void>
  commitNow(message: string): Promise<void>
  /** Restore the active doc to a commit oid or variant branch, as a new commit. */
  restoreActiveDoc(ref: string, label: string): Promise<void>
  createVariant(name: string): Promise<void>

  addDoc(parentId: string | null): Promise<void>
  addFolder(parentId: string | null): Promise<void>
  startRename(id: string): void
  finishRename(id: string, title: string): Promise<void>
  moveToTrash(id: string): Promise<void>
  restoreFromTrash(id: string): Promise<void>
  moveBinderNode(dragId: string, targetId: string, position: DropPosition): Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let commitTimer: ReturnType<typeof setInterval> | null = null
let commitDirty = false

export const useWyrm = create<WyrmState>((set, get) => {
  async function persistProject(): Promise<void> {
    const { project } = get()
    if (!project) return
    await api.saveProject(project.path, project.data)
    commitDirty = true
  }

  function setProject(project: ProjectInfo | null): void {
    set({ project })
  }

  async function loadProject(info: ProjectInfo): Promise<void> {
    setProject(info)
    set({ booted: true, activeId: null, activeDoc: null, saveState: 'saved' })
    if (commitTimer) clearInterval(commitTimer)
    commitTimer = setInterval(
      () => {
        if (commitDirty) void get().commitNow('Autosave')
      },
      5 * 60 * 1000
    )
    const first = firstDoc(info.data.binder)
    if (first) await get().selectDoc(first.id)
    const log = await api.log(info.path)
    if (log.length > 0) set({ lastCommitAt: log[0].timestamp })
  }

  return {
    project: null,
    booted: false,
    activeId: null,
    activeDoc: null,
    editor: null,
    saveState: 'saved',
    wordCount: 0,
    lastCommitAt: null,
    renamingId: null,

    async boot() {
      const last = await api.getLastProjectPath()
      if (last) {
        const info = await api.openProjectPath(last)
        if (info) {
          await loadProject(info)
          return
        }
      }
      set({ booted: true })
    },

    async newProject(title) {
      const info = await api.createProject(title)
      if (info) await loadProject(info)
    },

    async openProject() {
      const info = await api.openProject()
      if (info) await loadProject(info)
    },

    async selectDoc(id) {
      const { project, activeId } = get()
      if (!project || id === activeId) return
      await get().flushSave()
      const doc = await api.readDoc(project.path, id)
      // The Editor component recreates its TipTap instance when activeId
      // changes (fresh per-document undo history) and loads the body itself.
      set({ activeId: id, activeDoc: doc, saveState: 'saved', wordCount: countWords(doc.body) })
    },

    setEditor(editor) {
      set({ editor })
    },

    editorChanged() {
      const { editor } = get()
      if (!editor) return
      set({ saveState: 'dirty', wordCount: countWords(editor.getText()) })
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void get().flushSave(), 800)
    },

    async flushSave() {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      const { project, activeDoc, editor, saveState } = get()
      if (!project || !activeDoc || !editor || saveState === 'saved') return
      set({ saveState: 'saving' })
      const body = docToMarkdown(editor.getJSON())
      const doc: DocFile = { ...activeDoc, body }
      await api.writeDoc(project.path, doc)
      commitDirty = true
      set({ saveState: 'saved', activeDoc: doc })
    },

    async commitNow(message) {
      const { project } = get()
      if (!project) return
      await get().flushSave()
      const committed = await api.commit(project.path, message)
      commitDirty = false
      if (committed) set({ lastCommitAt: Date.now() })
    },

    async restoreActiveDoc(ref, label) {
      const { project, activeId, editor } = get()
      if (!project || !activeId) return
      await get().flushSave()
      const doc = await api.restoreDocToRef(project.path, activeId, ref, label)
      set({
        activeDoc: doc,
        saveState: 'saved',
        wordCount: countWords(doc.body),
        lastCommitAt: Date.now()
      })
      // Same doc id, so the editor isn't recreated — load the restored text
      // in place. It lands on the undo stack, so even the restore is ⌘Z-able.
      editor?.commands.setContent(markdownToDoc(doc.body), { emitUpdate: false })
    },

    async createVariant(name) {
      const { project, activeId } = get()
      if (!project || !activeId) return
      await get().flushSave()
      await api.createVariant(project.path, activeId, name)
      commitDirty = false
      set({ lastCommitAt: Date.now() })
    },

    async addDoc(parentId) {
      const { project } = get()
      if (!project) return
      const now = new Date().toISOString()
      const meta = {
        id: newId(),
        title: 'Untitled',
        status: 'draft' as const,
        created: now,
        modified: now
      }
      await api.writeDoc(project.path, { meta, body: '' })
      const node: BinderNode = { id: meta.id, type: 'doc', title: meta.title }
      const parent = parentId ? findNode(project.data.binder, parentId) : null
      if (parent && parent.type === 'folder') {
        parent.children = parent.children ?? []
        parent.children.push(node)
      } else {
        project.data.binder.push(node)
      }
      setProject({ ...project })
      await persistProject()
      // Rename mode is set before the doc switch so the recreated editor
      // sees it and leaves focus on the rename field.
      get().startRename(meta.id)
      await get().selectDoc(meta.id)
    },

    async addFolder(parentId) {
      const { project } = get()
      if (!project) return
      const node: BinderNode = { id: newId(), type: 'folder', title: 'New Folder', children: [] }
      const parent = parentId ? findNode(project.data.binder, parentId) : null
      if (parent && parent.type === 'folder') {
        parent.children = parent.children ?? []
        parent.children.push(node)
      } else {
        project.data.binder.push(node)
      }
      setProject({ ...project })
      await persistProject()
      get().startRename(node.id)
    },

    startRename(id) {
      set({ renamingId: id })
    },

    async finishRename(id, title) {
      const { project, activeDoc } = get()
      set({ renamingId: null })
      if (!project) return
      const trimmed = title.trim()
      if (!trimmed) return
      const node = findNode(project.data.binder, id) ?? findNode(project.data.trash, id)
      if (!node || node.title === trimmed) return
      node.title = trimmed
      setProject({ ...project })
      await persistProject()
      if (node.type === 'doc') {
        const doc = id === activeDoc?.meta.id ? activeDoc : await api.readDoc(project.path, id)
        const renamed: DocFile = { ...doc, meta: { ...doc.meta, title: trimmed } }
        await api.writeDoc(project.path, renamed)
        if (id === activeDoc?.meta.id) set({ activeDoc: renamed })
      }
    },

    async moveToTrash(id) {
      const { project, activeId } = get()
      if (!project) return
      const node = removeNode(project.data.binder, id)
      if (!node) return
      project.data.trash.push(node)
      setProject({ ...project })
      await persistProject()
      if (activeId && (activeId === id || Boolean(findNode([node], activeId)))) {
        const next = firstDoc(project.data.binder)
        if (next) await get().selectDoc(next.id)
        else set({ activeId: null, activeDoc: null, wordCount: 0 })
      }
    },

    async restoreFromTrash(id) {
      const { project } = get()
      if (!project) return
      const node = removeNode(project.data.trash, id)
      if (!node) return
      project.data.binder.push(node)
      setProject({ ...project })
      await persistProject()
    },

    async moveBinderNode(dragId, targetId, position) {
      const { project } = get()
      if (!project) return
      if (moveNode(project.data.binder, dragId, targetId, position)) {
        setProject({ ...project })
        await persistProject()
      }
    }
  }
})

// Best-effort safety net when the window is closed mid-edit.
window.addEventListener('beforeunload', () => {
  void useWyrm.getState().flushSave()
  void useWyrm.getState().commitNow('Autosave on close')
})
