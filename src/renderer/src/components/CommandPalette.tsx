import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { quickOpen, type PaletteItem } from '../lib/search'
import { useWyrm } from '../store'
import { useFocusTrap } from '../lib/useFocusTrap'

/** Rendering thousands of rows for an untyped query would crawl for no
 *  reader benefit — nobody scans past the first screenful anyway. */
const MAX_ROWS = 50

/** Right-hand label: folder path for docs, entry type for entities, a fixed
 *  tag for actions — the same three kinds `quickOpen` can return. */
function whenLabel(item: PaletteItem): string {
  return item.kind === 'action' ? 'ACTION' : item.subtitle
}

/** Title with matched characters wrapped in <strong>, driven by `positions`
 *  from the fuzzy matcher — contiguous runs become one <strong> so the
 *  emphasis doesn't fragment into a character per tag. */
function MatchedTitle({ item }: { item: PaletteItem }): JSX.Element {
  if (item.positions.length === 0) return <>{item.title}</>
  const marks = new Set(item.positions)
  const parts: JSX.Element[] = []
  let i = 0
  let key = 0
  while (i < item.title.length) {
    const on = marks.has(i)
    let j = i
    while (j < item.title.length && marks.has(j) === on) j++
    const chunk = item.title.slice(i, j)
    parts.push(on ? <strong key={key++}>{chunk}</strong> : <span key={key++}>{chunk}</span>)
    i = j
  }
  return <>{parts}</>
}

export function CommandPalette({
  actions,
  onClose
}: {
  actions: { id: string; title: string; subtitle: string; run: () => void }[]
  onClose: () => void
}): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const project = useWyrm((s) => s.project)
  const entities = useWyrm((s) => s.entities)
  const selectDoc = useWyrm((s) => s.selectDoc)
  const showEntity = useWyrm((s) => s.showEntity)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // quickOpen's own inputs (binder, entities, actions) are all stable
  // references — only the query changes what this needs to recompute.
  const actionSummaries = useMemo(
    () => actions.map(({ id, title, subtitle }) => ({ id, title, subtitle })),
    [actions]
  )

  const results = useMemo(
    () =>
      quickOpen(query, project?.data.binder ?? [], entities, actionSummaries).slice(0, MAX_ROWS),
    [query, project, entities, actionSummaries]
  )

  // A fresh query invalidates whatever row was highlighted under the old
  // one. Adjusted during render (not an effect) per the React-recommended
  // pattern for resetting state when a prop/derived value changes.
  const [queryAtSelection, setQueryAtSelection] = useState(query)
  if (query !== queryAtSelection) {
    setQueryAtSelection(query)
    setSelected(0)
  }

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const activate = (item: PaletteItem): void => {
    if (item.kind === 'doc') {
      void selectDoc(item.id)
    } else if (item.kind === 'entity') {
      showEntity(item.id)
    } else {
      actions.find((a) => a.id === item.id)?.run()
    }
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (results.length > 0) setSelected((n) => (n + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length > 0) setSelected((n) => (n - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = results[selected]
      if (item) activate(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Go To</span>
        </div>
        <div className="dialog-body">
          <input
            ref={inputRef}
            className="text-field"
            placeholder="Jump to a document, entry, or command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {results.length === 0 ? (
            <div className="dialog-hint">Nothing here matches that.</div>
          ) : (
            <div className="version-list">
              {results.map((item, i) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  ref={i === selected ? selectedRef : null}
                  type="button"
                  className={`version-row${i === selected ? ' selected' : ''}`}
                  onClick={() => activate(item)}
                >
                  <span className="row-title">
                    <MatchedTitle item={item} />
                  </span>
                  <span className="version-when">{whenLabel(item)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
