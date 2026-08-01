import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Entity } from '../../../shared/types'
import { api } from '../lib/api'
import { ENTITY_LABELS, findBacklinks, type Backlink } from '../lib/entities'
import { locationChain } from '../lib/locations'
import { useWyrm } from '../store'

/**
 * Reference panel beside the writing terminal. Opened by clicking a linked name
 * in the prose; deliberately does not take focus, so the writer keeps their place
 * (brief §12 — a side panel rather than navigating away).
 */
export function EntityPanel(): JSX.Element | null {
  const project = useWyrm((s) => s.project)
  const entities = useWyrm((s) => s.entities)
  const panelEntityId = useWyrm((s) => s.panelEntityId)
  const openEntityPanel = useWyrm((s) => s.openEntityPanel)
  const showEntity = useWyrm((s) => s.showEntity)
  const selectDoc = useWyrm((s) => s.selectDoc)

  const entity = entities.find((e) => e.id === panelEntityId) ?? null
  const [backlinks, setBacklinks] = useState<Backlink[] | null>(null)

  useEffect(() => {
    if (!project || !entity) return
    let live = true
    void api
      .readAllDocs(project.path)
      .then((docs) => {
        if (live) setBacklinks(findBacklinks(docs, entity))
      })
      .catch(() => live && setBacklinks([]))
    return () => {
      live = false
    }
  }, [project, entity])

  if (!entity) return null

  const locatedIn = entity.type === 'world' ? locationChain(entities, entity.id).slice(0, -1) : []

  return (
    <div className="entity-panel">
      <div className="panel-title">
        <button
          type="button"
          aria-label="Close"
          className="close-box"
          onClick={() => openEntityPanel(null)}
        />
        <span className="title-text">{ENTITY_LABELS[entity.type].toUpperCase()}</span>
      </div>
      <div className="panel-body">
        <h3>{entity.name}</h3>
        {locatedIn.length > 0 && (
          <div className="panel-field">
            <div className="field-name">LOCATED IN</div>
            <div className="field-value">{locatedIn.map((a) => a.name).join(' → ')}</div>
          </div>
        )}
        {entity.aliases.length > 0 && (
          <div className="panel-field">
            <div className="field-name">ALIASES</div>
            <div className="field-value">{entity.aliases.join(' · ')}</div>
          </div>
        )}
        <div className="panel-field">
          <div className="field-name">
            {entity.type === 'glossary'
              ? 'DEFINITION'
              : entity.type === 'character'
                ? 'NOTES'
                : 'DESCRIPTION'}
          </div>
          <div className="field-value">
            {entity.body.trim() || <span className="dialog-hint">Nothing written yet.</span>}
          </div>
        </div>
        <div className="backlinks">
          <div className="field-name" style={{ marginBottom: 6 }}>
            MENTIONED IN
          </div>
          {backlinks == null && <div className="dialog-hint">Searching…</div>}
          {backlinks?.length === 0 && <div className="dialog-hint">No mentions found.</div>}
          {backlinks?.map((link) => (
            <button
              type="button"
              key={link.docId}
              className="backlink-row"
              onClick={() => void selectDoc(link.docId)}
            >
              <span>▸</span>
              <span className="row-title">{link.title}</span>
              {link.count > 1 && <span className="backlink-count">{link.count}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-footer">
        <button type="button" className="btn small" onClick={() => showEntity(entity.id)}>
          Open Entry
        </button>
      </div>
    </div>
  )
}

/** Quick-create form shown after "Add to…" from the writing terminal. */
export function NewEntityDialog({
  type,
  initialName,
  onClose
}: {
  type: Entity['type']
  initialName: string
  onClose: () => void
}): JSX.Element {
  const createEntity = useWyrm((s) => s.createEntity)
  const saveEntity = useWyrm((s) => s.saveEntity)
  const openEntityPanel = useWyrm((s) => s.openEntityPanel)
  const [name, setName] = useState(initialName)
  const [aliases, setAliases] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const save = (): void => {
    if (!name.trim() || busy) return
    setBusy(true)
    void createEntity(type, name).then(async (created) => {
      if (created) {
        await saveEntity({
          ...created,
          aliases: aliases
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean),
          body
        })
        openEntityPanel(created.id)
      }
      onClose()
    })
  }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Add to {ENTITY_LABELS[type]}</span>
        </div>
        <div className="dialog-body">
          <div className="entry-field">
            <div className="field-name">NAME</div>
            <input
              className="text-field"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') onClose()
              }}
            />
          </div>
          <div className="entry-field">
            <div className="field-name">ALIASES (COMMA-SEPARATED)</div>
            <input
              className="text-field"
              value={aliases}
              placeholder="Elara, Captain Voss, the Captain"
              onChange={(e) => setAliases(e.target.value)}
            />
          </div>
          <div className="entry-field">
            <div className="field-name">
              {type === 'glossary'
                ? 'DEFINITION'
                : type === 'character'
                  ? 'BIO / NOTES'
                  : 'DESCRIPTION'}
            </div>
            <textarea
              className="text-area"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn default" disabled={!name.trim()} onClick={save}>
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
