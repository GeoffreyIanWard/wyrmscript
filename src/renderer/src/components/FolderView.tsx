import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { BinderNode, DocFile } from '../../../shared/types'
import { countWords } from '../../../shared/words'
import { findNode } from '../lib/tree'
import { useWyrm } from '../store'
import { DocIcon, FolderIcon } from './icons'

/**
 * F-08: clicking a folder's row body (the twist stays the collapse/expand
 * control) opens a plain listing of its immediate contents in the main pane —
 * a folder's shape at a glance, not a corkboard. Word counts need every
 * document's body, which `loadAllDocs` already reads for compile/search, so
 * this reuses that loader rather than adding a second one.
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

export function FolderView({ folderId }: { folderId: string }): JSX.Element {
  const project = useWyrm((s) => s.project)
  const loadAllDocs = useWyrm((s) => s.loadAllDocs)
  const selectDoc = useWyrm((s) => s.selectDoc)
  const showFolder = useWyrm((s) => s.showFolder)
  const showDoc = useWyrm((s) => s.showDoc)

  const [docs, setDocs] = useState<Map<string, DocFile> | null>(null)

  const folder = project ? findNode(project.data.binder, folderId) : null

  useEffect(() => {
    let live = true
    void loadAllDocs().then((loaded) => {
      if (live) setDocs(loaded)
    })
    return () => {
      live = false
    }
    // Re-reads on every folder switch: word counts are the point of this view,
    // and a document edited elsewhere should not show a stale count on return.
  }, [loadAllDocs, folderId])

  if (!folder) {
    return (
      <div className="terminal folder-view">
        <div className="dialog-hint" style={{ padding: 24 }}>
          This folder no longer exists.
        </div>
      </div>
    )
  }

  const children: BinderNode[] = folder.children ?? []

  return (
    <div className="terminal folder-view">
      <div className="entity-main-bar">
        <button type="button" className="btn small" onClick={showDoc}>
          ‹ Back to Manuscript
        </button>
        <span className="entity-kind">FOLDER</span>
        <span className="row-title">{folder.title}</span>
        <span className="spacer" />
      </div>
      <div className="entity-main-body folder-view-body">
        {children.length === 0 && <div className="dialog-hint">This folder is empty.</div>}
        {children.length > 0 && (
          <>
            <div className="folder-row folder-row-head">
              <span>TITLE</span>
              <span>WORDS</span>
              <span>STATUS</span>
              <span>MODIFIED</span>
            </div>
            {children.map((child) => {
              if (child.type === 'folder') {
                return (
                  <div
                    key={child.id}
                    className="folder-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => showFolder(child.id)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      showFolder(child.id)
                    }}
                  >
                    <span className="folder-row-title">
                      <span className="glyph">
                        <FolderIcon />
                      </span>
                      {child.title}
                    </span>
                    <span>—</span>
                    <span>—</span>
                    <span>—</span>
                  </div>
                )
              }
              const doc = docs?.get(child.id)
              return (
                <div
                  key={child.id}
                  className="folder-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => void selectDoc(child.id)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    void selectDoc(child.id)
                  }}
                >
                  <span
                    className="folder-row-title"
                    title={doc ? `Created ${formatDate(doc.meta.created)}` : undefined}
                  >
                    <span className="glyph">
                      <DocIcon />
                    </span>
                    {child.title}
                  </span>
                  <span>{doc ? countWords(doc.body).toLocaleString() : '…'}</span>
                  <span>{doc?.meta.status ? doc.meta.status.toUpperCase() : '—'}</span>
                  <span>{doc ? formatDate(doc.meta.modified) : '…'}</span>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
