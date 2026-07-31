import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { api } from '../lib/api'
import { ENTITY_LABELS, findBacklinks, type Backlink } from '../lib/entities'
import { useWyrm } from '../store'

/**
 * Full entry editor for one story-bible entry, shown in the main pane in place of
 * the writing terminal. Deliberately light: name, aliases, one free-form body —
 * not a rigid character sheet (brief §5, and Geoffrey's free-form decision).
 */
export function EntityEditor({ entityId }: { entityId: string }): JSX.Element {
  const project = useWyrm((s) => s.project)
  const entity = useWyrm((s) => s.entities.find((e) => e.id === entityId) ?? null)
  const saveEntity = useWyrm((s) => s.saveEntity)
  const deleteEntity = useWyrm((s) => s.deleteEntity)
  const showDoc = useWyrm((s) => s.showDoc)
  const selectDoc = useWyrm((s) => s.selectDoc)

  // Seeded from the entry once. App keys this component by entity id, so opening
  // a different entry remounts it with fresh fields rather than syncing state in
  // an effect (which would fight the user's in-progress edits).
  const [name, setName] = useState(entity?.name ?? '')
  const [aliases, setAliases] = useState(entity?.aliases.join(', ') ?? '')
  const [body, setBody] = useState(entity?.body ?? '')
  const [dirty, setDirty] = useState(false)
  const [backlinks, setBacklinks] = useState<Backlink[] | null>(null)

  useEffect(() => {
    if (!project || !entity) return
    let live = true
    void api
      .readAllDocs(project.path)
      .then((docs) => live && setBacklinks(findBacklinks(docs, entity)))
      .catch(() => live && setBacklinks([]))
    return () => {
      live = false
    }
  }, [project, entity])

  if (!entity) {
    return (
      <div className="terminal entity-main">
        <div className="dialog-hint" style={{ padding: 24 }}>
          This entry no longer exists.
        </div>
      </div>
    )
  }

  const save = (): void => {
    void saveEntity({
      ...entity,
      name: name.trim() || entity.name,
      aliases: aliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      body
    })
    setDirty(false)
  }

  const bodyLabel =
    entity.type === 'glossary'
      ? 'DEFINITION'
      : entity.type === 'character'
        ? 'BIO / NOTES'
        : 'DESCRIPTION'

  return (
    <div className="terminal entity-main">
      <div className="entity-main-bar">
        <button type="button" className="btn small" onClick={showDoc}>
          ‹ Back to Manuscript
        </button>
        <span className="entity-kind">{ENTITY_LABELS[entity.type].toUpperCase()}</span>
        <span className="spacer" />
        {dirty && <span className="entity-dirty">UNSAVED</span>}
        <button type="button" className="btn small" disabled={!dirty} onClick={save}>
          Save Entry
        </button>
      </div>

      <div className="entity-main-body">
        <div className="entry-field">
          <div className="field-name">NAME</div>
          <input
            className="text-field"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setDirty(true)
            }}
          />
        </div>
        <div className="entry-field">
          <div className="field-name">ALIASES (COMMA-SEPARATED)</div>
          <input
            className="text-field"
            value={aliases}
            placeholder="nicknames, titles, alternate spellings"
            onChange={(e) => {
              setAliases(e.target.value)
              setDirty(true)
            }}
          />
          <div className="dialog-hint">
            Every alias auto-links in your manuscript, just like the name.
          </div>
        </div>
        <div className="entry-field">
          <div className="field-name">{bodyLabel}</div>
          <textarea
            className="text-area tall"
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              setDirty(true)
            }}
          />
        </div>

        <div className="entry-field">
          <div className="field-name">MENTIONED IN</div>
          {backlinks == null && <div className="dialog-hint">Searching…</div>}
          {backlinks?.length === 0 && (
            <div className="dialog-hint">No mentions in the manuscript yet.</div>
          )}
          {backlinks?.map((link) => (
            <button
              type="button"
              key={link.docId}
              className="backlink-row"
              onClick={() => {
                showDoc()
                void selectDoc(link.docId)
              }}
            >
              <span>▸</span>
              <span className="row-title">{link.title}</span>
              {link.count > 1 && <span className="backlink-count">{link.count}</span>}
            </button>
          ))}
        </div>

        <div className="entry-danger">
          <button
            type="button"
            className="btn small"
            onClick={() => {
              void deleteEntity(entity)
              showDoc()
            }}
          >
            Delete Entry
          </button>
          <span className="dialog-hint">
            Removes it from the bible and stops auto-linking. Your manuscript is untouched.
          </span>
        </div>
      </div>
    </div>
  )
}
