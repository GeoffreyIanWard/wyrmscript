import { useMemo } from 'react'
import type { JSX } from 'react'
import type { Entity, EntityType } from '../../../shared/types'
import { ENTITY_COLLECTIONS } from '../lib/entities'
import { entitiesWithTag, tagCounts } from '../lib/tags'
import { useWyrm } from '../store'

/**
 * F-34: browse the story bible by tag — "all 'gun' items, all 'dungeon'
 * locations". Tags are already one free-form mechanism shared by every entity
 * type (F-10), so the buttons are drawn from all three collections at once
 * rather than three separate per-type lists; results are then grouped back by
 * type so "items" and "locations" stay legible.
 *
 * Reads `entities` straight from the store rather than loading anything —
 * the whole story bible is already there, so this is a filtering view over
 * existing state, not a new data path.
 */

/** Section order matches the binder's, so the two read the same way round. */
const TYPE_ORDER: EntityType[] = ['glossary', 'character', 'world']

export function TagBrowser(): JSX.Element {
  const entities = useWyrm((s) => s.entities)
  const showDoc = useWyrm((s) => s.showDoc)
  const showEntity = useWyrm((s) => s.showEntity)
  // Store-held rather than local: opening a result unmounts this page, so
  // local state would drop the filter on every Esc back (F-34's comment in
  // the store has the reasoning).
  const selected = useWyrm((s) => s.tagFilter)
  const setSelected = useWyrm((s) => s.setTagFilter)

  // Derived during render from the stable `entities` slice — a selector
  // returning a fresh array would re-render forever (house rule).
  const counts = useMemo(() => tagCounts(entities), [entities])

  const matches = useMemo(
    () => (selected ? entitiesWithTag(entities, selected) : []),
    [entities, selected]
  )

  // A tag can be removed from the last entry carrying it while it is the one
  // on screen; falling back to "nothing selected" beats rendering an empty
  // result list under a button that no longer exists.
  const activeTag = selected && counts.some((c) => c.tag === selected) ? selected : null

  const grouped = TYPE_ORDER.map((type) => ({
    type,
    entries: matches.filter((e) => e.type === type).sort((a, b) => a.name.localeCompare(b.name))
  })).filter((group) => group.entries.length > 0)

  return (
    <div className="terminal tag-browser">
      <div className="entity-main-bar">
        <button type="button" className="btn small" onClick={showDoc}>
          ‹ Back to Manuscript
        </button>
        <span className="entity-kind">TAGS</span>
        <span className="row-title">Browse by Tag</span>
        <span className="spacer" />
      </div>
      <div className="entity-main-body tag-browser-body">
        {counts.length === 0 ? (
          <div className="dialog-hint">
            No tags yet. Add one to a glossary, character or world entry and it will show up here.
          </div>
        ) : (
          <>
            <div className="figtree-subheader">TAGS</div>
            <div className="tag-button-wall">
              {counts.map(({ tag, count }) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={activeTag === tag}
                  className={`tag-button${activeTag === tag ? ' on' : ''}`}
                  // Clicking the selected tag again clears it, so the whole
                  // wall is reachable without hunting for a separate "clear".
                  onClick={() => setSelected(activeTag === tag ? null : tag)}
                >
                  <span>{tag}</span>
                  <span className="tag-button-count">{count}</span>
                </button>
              ))}
            </div>

            {activeTag === null ? (
              <div className="dialog-hint">
                Pick a tag to see everything carrying it. Most-used tags come first.
              </div>
            ) : (
              <>
                {grouped.map((group) => (
                  <fieldset className="fieldset" key={group.type}>
                    <legend>{ENTITY_COLLECTIONS[group.type].toUpperCase()}</legend>
                    {group.entries.map((entity) => (
                      <TagResultRow key={entity.id} entity={entity} onOpen={showEntity} />
                    ))}
                  </fieldset>
                ))}
                {grouped.length === 0 && (
                  <div className="dialog-hint">Nothing carries “{activeTag}” any more.</div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function TagResultRow({
  entity,
  onOpen
}: {
  entity: Entity
  onOpen: (id: string) => void
}): JSX.Element {
  const tags = entity.tags ?? []
  return (
    <div
      className="tag-result-row"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(entity.id)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onOpen(entity.id)
      }}
    >
      <span className="tag-result-name">{entity.name}</span>
      <span className="tag-result-tags">
        {tags.map((tag) => (
          <span key={tag} className="tag-chip on-paper">
            #{tag}
          </span>
        ))}
      </span>
    </div>
  )
}
