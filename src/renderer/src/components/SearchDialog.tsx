import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DocFile } from '../../../shared/types'
import { searchProject } from '../lib/search'
import type { SearchHit } from '../lib/search'
import { errorMessage } from '../lib/errors'
import { useWyrm } from '../store'
import { useFocusTrap } from '../lib/useFocusTrap'

/** Keystrokes wait this long before re-running the search — the corpus can
 *  be a whole novel, so searching on every keystroke would be wasteful. */
const DEBOUNCE_MS = 150

export function SearchDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const project = useWyrm((s) => s.project)
  const entities = useWyrm((s) => s.entities)
  const loadAllDocs = useWyrm((s) => s.loadAllDocs)
  const selectDoc = useWyrm((s) => s.selectDoc)
  const showEntity = useWyrm((s) => s.showEntity)

  const [docs, setDocs] = useState<Map<string, DocFile> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [selected, setSelected] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => inputRef.current?.focus(), [])

  // Read every document from disk once, up front — searching should never
  // re-hit the filesystem per keystroke.
  useEffect(() => {
    let live = true
    void loadAllDocs()
      .then((loaded) => live && setDocs(loaded))
      .catch((e: unknown) => live && setLoadError(errorMessage(e)))
    return () => {
      live = false
    }
  }, [loadAllDocs])

  useEffect(() => {
    if (debounceRef.current != null) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const found =
        docs != null && project
          ? searchProject(query, [...docs.values()], entities, project.data.binder)
          : []
      setHits(found)
      setSelected(0)
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current != null) clearTimeout(debounceRef.current)
    }
  }, [query, docs, entities, project])

  const open = (hit: SearchHit): void => {
    if (hit.kind === 'doc') void selectDoc(hit.id)
    else showEntity(hit.id)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (hits.length > 0) setSelected((i) => Math.min(i + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (hits.length > 0) setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[selected]
      if (hit) open(hit)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const current = hits[selected]

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog wide" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Find in Project</span>
        </div>
        <div className="dialog-body">
          <div className="control-row">
            <input
              ref={inputRef}
              className="text-field"
              placeholder="Search documents and story bible…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          {loadError != null && <div className="error-text">{loadError}</div>}
          {loadError == null && docs == null && (
            <div className="dialog-hint">Reading the project…</div>
          )}
          {loadError == null && docs != null && (
            <>
              <div className="field-name" style={{ marginTop: 6, marginBottom: 6 }}>
                {hits.length} {hits.length === 1 ? 'DOCUMENT & ENTRY' : 'DOCUMENTS & ENTRIES'}
              </div>
              <div className="version-body">
                <div className="version-list">
                  {query.trim().length < 2 ? (
                    <div className="dialog-hint">Type at least two characters to search.</div>
                  ) : hits.length === 0 ? (
                    <div className="dialog-hint">Nothing matches “{query.trim()}”.</div>
                  ) : (
                    hits.map((hit, i) => (
                      <button
                        type="button"
                        key={`${hit.kind}-${hit.id}`}
                        className={`version-row${i === selected ? ' selected' : ''}`}
                        onClick={() => setSelected(i)}
                        onDoubleClick={() => open(hit)}
                      >
                        <span className="row-title">{hit.title}</span>
                        <span className="version-when">
                          {hit.subtitle} · {hit.total}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div className="version-detail">
                  {current == null ? (
                    <div className="dialog-hint">
                      Select a result to see where the phrase appears.
                    </div>
                  ) : (
                    <div className="diff-view">
                      {current.snippets.map((snippet, i) => (
                        <div key={i}>
                          {snippet.before}
                          <strong>{snippet.match}</strong>
                          {snippet.after}
                        </div>
                      ))}
                      {current.total > current.snippets.length && (
                        <div className="dialog-hint">
                          …and {current.total - current.snippets.length} more.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="dialog-buttons">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn default"
            disabled={current == null}
            onClick={() => current && open(current)}
          >
            Open
          </button>
        </div>
      </div>
    </div>
  )
}
