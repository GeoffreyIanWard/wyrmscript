import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, JSX } from 'react'
import type { DocFile } from '../../../shared/types'
import { api } from '../lib/api'
import { useWyrm } from '../store'
import { sceneCards } from '../lib/corkboard'
import type { SceneCard } from '../lib/corkboard'

/**
 * The corkboard: every scene in the project as an index card (Phase 6).
 *
 * Cards are in **binder order**, and dragging one reorders the binder. That is
 * the distinction from the timeline, which F-02 deliberately gave its own
 * ordering because narrative order and chronology are different questions.
 * Rearranging index cards is how a writer reorders their manuscript, so the
 * board writes to the binder and the timeline keeps answering the other one.
 *
 * Reordering goes through `moveBinderNode` — the same action the binder's own
 * drag uses — rather than a second implementation, so a card and a binder row
 * can never disagree about what a move means.
 */
export function Corkboard({
  onTimeline,
  onPlotGraph,
  onWorldMap
}: {
  onTimeline: () => void
  onPlotGraph: () => void
  onWorldMap: () => void
}): JSX.Element {
  const project = useWyrm((s) => s.project)
  const [docs, setDocs] = useState<DocFile[] | null>(null)
  const selectDoc = useWyrm((s) => s.selectDoc)
  const moveBinderNode = useWyrm((s) => s.moveBinderNode)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null)

  // Documents are read on demand rather than held in the store, the same as
  // the timeline and plot graph do. Re-reads when the binder changes, so a
  // card dragged to a new position redraws in its new place.
  useEffect(() => {
    if (!project) return
    let live = true
    void api.readAllDocs(project.path).then((all) => live && setDocs(all))
    return () => {
      live = false
    }
  }, [project])

  // Derived during render rather than selected, per the house rule against
  // returning fresh objects from a zustand selector.
  const cards = useMemo(
    () => (project && docs ? sceneCards(docs, project.data.binder) : []),
    [docs, project]
  )

  const tools = (
    // Pinned to the board rather than left in a menu: the timeline, the plot
    // graph and the map are the same scenes seen other ways, and the board is
    // where that is true. The binder is hidden in this view, so these are also
    // what replaces it.
    <div className="corkboard-tools">
      <button type="button" className="board-tool" onClick={onTimeline}>
        <span className="board-tool-pin" aria-hidden="true" />
        <span>Timeline</span>
      </button>
      <button type="button" className="board-tool" onClick={onPlotGraph}>
        <span className="board-tool-pin" aria-hidden="true" />
        <span>Plot Graph</span>
      </button>
      <button type="button" className="board-tool" onClick={onWorldMap}>
        <span className="board-tool-pin" aria-hidden="true" />
        <span>World Map</span>
      </button>
    </div>
  )

  if (!project) return <div className="terminal" />
  if (docs == null) return <div className="terminal corkboard" />

  if (cards.length === 0) {
    return (
      <div className="terminal corkboard">
        {tools}
        <div className="corkboard-empty">
          <div>No scenes yet.</div>
          <div className="dialog-hint">
            A scene is any document tagged <strong>scene</strong>. Tag one from its header and it
            appears here as a card.
          </div>
        </div>
      </div>
    )
  }

  const onDrop = (target: SceneCard, after: boolean): void => {
    setOver(null)
    const dragId = dragging
    setDragging(null)
    if (!dragId || dragId === target.id) return
    void moveBinderNode(dragId, target.id, after ? 'after' : 'before')
  }

  return (
    <div className="terminal corkboard">
      {tools}
      <div className="corkboard-board">
        {cards.map((card) => (
          <div
            key={card.id}
            className={`scene-card${dragging === card.id ? ' dragging' : ''}${
              over?.id === card.id ? (over.after ? ' drop-after' : ' drop-before') : ''
            }`}
            draggable
            onDragStart={(e: DragEvent<HTMLDivElement>) => {
              setDragging(card.id)
              // Chromium treats a drag with no transfer data as invalid: the
              // card follows the pointer and then snaps back, because `drop`
              // never fires. The binder's own drag sets a type for the same
              // reason; this uses its own so the two cannot be dropped into
              // each other.
              e.dataTransfer?.setData('text/wyrm-scene', card.id)
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => {
              setDragging(null)
              setOver(null)
            }}
            onDragOver={(e: DragEvent<HTMLDivElement>) => {
              // Only our own cards; a binder row dragged onto the board should
              // not look droppable here.
              if (e.dataTransfer && !e.dataTransfer.types.includes('text/wyrm-scene')) return
              e.preventDefault()
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
              // Which half of the card the pointer is over decides whether the
              // dragged scene lands before or after it — the same before/after
              // vocabulary the binder's own drop already speaks.
              const box = e.currentTarget.getBoundingClientRect()
              setOver({ id: card.id, after: e.clientX > box.left + box.width / 2 })
            }}
            onDragLeave={() => setOver((o) => (o?.id === card.id ? null : o))}
            onDrop={() => onDrop(card, over?.after ?? false)}
          >
            {/* The pin. Decorative, so it is hidden from assistive tech — the
                card's own button carries the name and the action. */}
            <span className="scene-card-pin" aria-hidden="true" />
            <button
              type="button"
              className="scene-card-face"
              onClick={() => void selectDoc(card.id)}
              aria-label={`Open ${card.title}`}
            >
              <span className="scene-card-title">{card.title}</span>
              {card.folder !== '' && <span className="scene-card-folder">{card.folder}</span>}
              <span className="scene-card-excerpt">
                {card.empty ? <em>Not written yet.</em> : card.excerpt}
              </span>
              <span className="scene-card-foot">
                <span>{card.wordCount.toLocaleString()} words</span>
                {card.status != null && <span className="scene-card-status">{card.status}</span>}
                {card.label != null && <span className="scene-card-label">{card.label}</span>}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
