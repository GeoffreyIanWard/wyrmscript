import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { diffWords } from 'diff'
import type { CommitInfo, VariantInfo } from '../../../shared/types'
import { api } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { useWyrm } from '../store'
import { useFocusTrap } from '../lib/useFocusTrap'

function timeAgo(timestamp: number): string {
  const mins = Math.floor((Date.now() - timestamp) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** Inline word-diff of two markdown bodies, old → new. Shared with the sync
 *  conflict screen (brief §7 says to reuse this viewer rather than invent). */
export function DiffView({ oldText, newText }: { oldText: string; newText: string }): JSX.Element {
  const parts = diffWords(oldText, newText)
  if (oldText === newText) {
    return <div className="diff-view identical">No differences from the current text.</div>
  }
  return (
    <div className="diff-view">
      {parts.map((part, i) =>
        part.added ? (
          <ins key={i}>{part.value}</ins>
        ) : part.removed ? (
          <del key={i}>{part.value}</del>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </div>
  )
}

/* ---------- Commit checkpoint ---------- */

export function CommitDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const commitNow = useWyrm((s) => s.commitNow)
  const lastCommitAt = useWyrm((s) => s.lastCommitAt)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const commit = (): void => {
    const message = inputRef.current?.value.trim() || 'Checkpoint'
    void commitNow(message).then(onClose)
  }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Commit Checkpoint</span>
        </div>
        <div className="dialog-body">
          <div className="field-name" style={{ marginBottom: 6 }}>
            WHAT CHANGED?
          </div>
          <div className="control-row">
            <input
              ref={inputRef}
              className="text-field"
              placeholder="Checkpoint"
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') onClose()
              }}
            />
          </div>
          <div className="dialog-hint">
            {lastCommitAt
              ? `Last checkpoint ${timeAgo(lastCommitAt)}. Every version is kept — forever.`
              : 'Every version is kept — forever.'}
          </div>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn default" onClick={commit}>
            Commit
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- History (per active document) ---------- */

export function HistoryDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const project = useWyrm((s) => s.project)
  const activeDoc = useWyrm((s) => s.activeDoc)
  const restoreActiveDoc = useWyrm((s) => s.restoreActiveDoc)

  const [commits, setCommits] = useState<CommitInfo[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [oldBody, setOldBody] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!project || !activeDoc) return
    let live = true
    void api
      .log(project.path, activeDoc.meta.id)
      .then((log) => {
        if (!live) return
        setCommits(log)
        setError(null)
      })
      .catch((e: unknown) => live && setError(errorMessage(e)))
    return () => {
      live = false
    }
  }, [project, activeDoc])

  useEffect(() => {
    if (!project || !activeDoc || !selected) return
    void api
      .readDocAtRef(project.path, activeDoc.meta.id, selected)
      .then((doc) => setOldBody(doc?.body ?? null))
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [project, activeDoc, selected])

  const restore = (): void => {
    if (!selected || !commits) return
    const commit = commits.find((c) => c.oid === selected)
    void restoreActiveDoc(
      selected,
      `Restore “${activeDoc?.meta.title}” to version from ${new Date(commit?.timestamp ?? 0).toLocaleString()}`
    )
      .then(onClose)
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog wide" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">History — {activeDoc?.meta.title}</span>
        </div>
        <div className="dialog-body version-body">
          <div className="version-list">
            {error != null && <div className="error-text">{error}</div>}
            {error == null && commits == null && (
              <div className="dialog-hint">Reading history…</div>
            )}
            {error == null && commits?.length === 0 && (
              <div className="dialog-hint">No checkpoints for this document yet.</div>
            )}
            {commits?.map((commit) => (
              <button
                type="button"
                key={commit.oid}
                className={`version-row${selected === commit.oid ? ' selected' : ''}`}
                onClick={() => setSelected(commit.oid)}
              >
                <span className="row-title">{commit.message}</span>
                <span className="version-when">{timeAgo(commit.timestamp)}</span>
              </button>
            ))}
          </div>
          <div className="version-detail">
            {selected == null ? (
              <div className="dialog-hint">
                Select a version to compare it with the current text.
                <br />
                Deleted words are struck out; added words are underlined.
              </div>
            ) : oldBody == null ? (
              <div className="dialog-hint">This document did not exist at that version.</div>
            ) : (
              <DiffView oldText={oldBody} newText={activeDoc?.body ?? ''} />
            )}
          </div>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn default"
            disabled={selected == null || oldBody == null || oldBody === activeDoc?.body}
            onClick={restore}
          >
            Restore This Version
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Variants (snapshot branches per document) ---------- */

export function VariantsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const project = useWyrm((s) => s.project)
  const activeDoc = useWyrm((s) => s.activeDoc)
  const createVariant = useWyrm((s) => s.createVariant)
  const restoreActiveDoc = useWyrm((s) => s.restoreActiveDoc)

  const [variants, setVariants] = useState<VariantInfo[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [variantBody, setVariantBody] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const refresh = (): void => {
    if (!project || !activeDoc) return
    void api
      .listVariants(project.path, activeDoc.meta.id)
      .then(setVariants)
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  useEffect(refresh, [project, activeDoc])

  useEffect(() => {
    if (!project || !activeDoc || !selected) return
    void api
      .readDocAtRef(project.path, activeDoc.meta.id, selected)
      .then((doc) => setVariantBody(doc?.body ?? null))
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [project, activeDoc, selected])

  const saveVariant = (): void => {
    const name = nameRef.current?.value.trim()
    if (!name) return
    setError(null)
    void createVariant(name)
      .then(() => {
        if (nameRef.current) nameRef.current.value = ''
        refresh()
      })
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  const adopt = (): void => {
    if (!selected || !variants) return
    const variant = variants.find((v) => v.branch === selected)
    void restoreActiveDoc(
      selected,
      `Adopt variant “${variant?.name}” of “${activeDoc?.meta.title}”`
    )
      .then(onClose)
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  const remove = (): void => {
    if (!project || !selected) return
    void api
      .deleteVariant(project.path, selected)
      .then(() => {
        setSelected(null)
        setVariantBody(null)
        refresh()
      })
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog wide" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Variants — {activeDoc?.meta.title}</span>
        </div>
        <div className="dialog-body">
          <fieldset className="fieldset">
            <legend>SAVE CURRENT TEXT AS VARIANT</legend>
            <div className="control-row">
              <input
                ref={nameRef}
                className="text-field"
                placeholder="e.g. Darker ending"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveVariant()
                }}
              />
              <button type="button" className="btn" onClick={saveVariant}>
                Save
              </button>
            </div>
          </fieldset>
          <div className="version-body">
            <div className="version-list">
              {error != null && <div className="error-text">{error}</div>}
              {error == null && variants == null && (
                <div className="dialog-hint">Reading variants…</div>
              )}
              {error == null && variants?.length === 0 && (
                <div className="dialog-hint">No variants yet.</div>
              )}
              {variants?.map((variant) => (
                <button
                  type="button"
                  key={variant.branch}
                  className={`version-row${selected === variant.branch ? ' selected' : ''}`}
                  onClick={() => setSelected(variant.branch)}
                >
                  <span className="row-title">{variant.name}</span>
                  <span className="version-when">{timeAgo(variant.createdAt)}</span>
                </button>
              ))}
            </div>
            <div className="version-detail">
              {selected == null ? (
                <div className="dialog-hint">
                  A variant is a frozen snapshot of this document, kept on its own shelf. Adopt one
                  to make it the current text (the text it replaces is committed first — nothing is
                  lost).
                </div>
              ) : variantBody == null ? (
                <div className="dialog-hint">Could not read this variant.</div>
              ) : (
                <DiffView oldText={activeDoc?.body ?? ''} newText={variantBody} />
              )}
            </div>
          </div>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="btn" disabled={selected == null} onClick={remove}>
            Delete Variant
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn default"
            disabled={selected == null || variantBody == null || variantBody === activeDoc?.body}
            onClick={adopt}
          >
            Adopt Variant
          </button>
        </div>
      </div>
    </div>
  )
}
