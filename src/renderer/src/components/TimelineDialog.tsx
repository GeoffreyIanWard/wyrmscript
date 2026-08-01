import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { DocFile } from '../../../shared/types'
import { api } from '../lib/api'
import { orderBetween, timelineCards, type TimelineCard } from '../lib/timeline'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useWyrm } from '../store'

/**
 * F-02: the story's chronology, distinct from binder order. Cards are
 * documents tagged `scene` (F-10) — no separate event-card entity — sorted
 * by `timelineOrder` with binder order as the fallback for a scene that has
 * never been dragged. One timeline per project; an optional in-world date is
 * a label only, never a sort key (see `shared/types.ts`'s `timelineDate`).
 */

const DRAG_KEY = 'text/wyrm-timeline-card'

function TimelineRow({
  card,
  onDrop,
  onOpen,
  onDateChange
}: {
  card: TimelineCard
  onDrop: (draggedId: string, before: boolean) => void
  onOpen: () => void
  onDateChange: (date: string) => void
}): JSX.Element {
  const [dragOver, setDragOver] = useState<'before' | 'after' | null>(null)
  const [date, setDate] = useState(card.date ?? '')

  return (
    <div
      className={['timeline-row', dragOver ? `drop-${dragOver}` : ''].filter(Boolean).join(' ')}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(DRAG_KEY, card.id)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_KEY)) return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        setDragOver((e.clientY - rect.top) / rect.height < 0.5 ? 'before' : 'after')
      }}
      onDragLeave={() => setDragOver(null)}
      onDrop={(e) => {
        e.preventDefault()
        const draggedId = e.dataTransfer.getData(DRAG_KEY)
        setDragOver(null)
        if (draggedId && draggedId !== card.id) onDrop(draggedId, dragOver !== 'after')
      }}
    >
      <button type="button" className="timeline-title" onClick={onOpen}>
        {card.title}
      </button>
      <input
        className="text-field timeline-date"
        placeholder="+ date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        onBlur={() => {
          if (date.trim() !== (card.date ?? '')) onDateChange(date)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
    </div>
  )
}

export function TimelineDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const project = useWyrm((s) => s.project)
  const showDoc = useWyrm((s) => s.showDoc)
  const selectDoc = useWyrm((s) => s.selectDoc)
  const setTimelineOrder = useWyrm((s) => s.setTimelineOrder)
  const setTimelineDate = useWyrm((s) => s.setTimelineDate)
  const [docs, setDocs] = useState<DocFile[] | null>(null)

  useEffect(() => {
    if (!project) return
    let live = true
    void api.readAllDocs(project.path).then((all) => live && setDocs(all))
    return () => {
      live = false
    }
  }, [project])

  const cards = docs && project ? timelineCards(docs, project.data.binder) : []

  const handleDrop = (targetIndex: number, draggedId: string, before: boolean): void => {
    const from = cards.findIndex((c) => c.id === draggedId)
    if (from === -1) return
    const withoutDragged = cards.filter((c) => c.id !== draggedId)
    // targetIndex is the position in the original (pre-removal) list — adjust
    // once the dragged card is gone so the anchor still points at the target.
    const anchor = cards[targetIndex]
    const anchorIndex = withoutDragged.findIndex((c) => c.id === anchor.id)
    const insertAt = before ? anchorIndex : anchorIndex + 1
    const beforeOrder = withoutDragged[insertAt - 1]?.order
    const afterOrder = withoutDragged[insertAt]?.order
    void setTimelineOrder(draggedId, orderBetween(beforeOrder, afterOrder))
  }

  const openCard = (id: string): void => {
    onClose()
    showDoc()
    void selectDoc(id)
  }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Timeline</span>
        </div>
        <div className="dialog-body">
          {docs === null && <div className="dialog-hint">Reading your manuscript…</div>}
          {docs !== null && cards.length === 0 && (
            <div className="dialog-hint">
              No scenes yet. Check &ldquo;Scene&rdquo; in a document&rsquo;s tags bar to add it
              here.
            </div>
          )}
          {cards.length > 0 && (
            <div className="timeline-list">
              {cards.map((card, i) => (
                <TimelineRow
                  key={card.id}
                  card={card}
                  onOpen={() => openCard(card.id)}
                  onDateChange={(date) => void setTimelineDate(card.id, date)}
                  onDrop={(draggedId, before) => handleDrop(i, draggedId, before)}
                />
              ))}
            </div>
          )}
        </div>
        <div className="dialog-buttons">
          <button type="button" className="btn default" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
