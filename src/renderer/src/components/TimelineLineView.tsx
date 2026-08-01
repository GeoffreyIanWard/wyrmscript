import { useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import { snapToGrid, stackByPosition, type TimelineCard } from '../lib/timeline'

/**
 * F-29: the timeline redrawn as a literal line — scenes are markers dragged
 * along it "like birds on a wire" rather than rows in a list. Position is
 * `timelineOrder` itself (a real coordinate here, not just a sort rank);
 * dragging snaps to `TIMELINE_GRID` so a drop settles on one of a small,
 * readable set of gaps instead of an arbitrary pixel value, and two cards
 * landing on the same grid position is how a stack (simultaneous events)
 * gets made — a visual coincidence, not a stored relationship.
 */

// Kept in sync with `.timeline-line-card`'s CSS width by hand (retro.css) —
// exported so a test can assert the invariant below rather than trusting a
// comment. If you change one, change the other.
export const CARD_WIDTH_PX = 108

// Must stay >= CARD_WIDTH_PX: TIMELINE_GRID is 1, so this is also the
// smallest possible gap between two cards that land on different grid
// positions. Any smaller and a near-miss drop overlaps the card next to it
// instead of reading as a clean gap or a clean stack.
const PX_PER_UNIT = 140
const ROW_HEIGHT = 48
const TRACK_HEIGHT = 220
const BASELINE_BOTTOM = 32
const CLICK_THRESHOLD_PX = 4

interface Drag {
  id: string
  startClientX: number
  startOrder: number
  dx: number
}

export function TimelineLineView({
  cards,
  onReorder,
  onOpen,
  onDateChange
}: {
  cards: TimelineCard[]
  onReorder: (id: string, order: number) => void
  onOpen: (id: string) => void
  onDateChange: (id: string, date: string) => void
}): JSX.Element {
  // Mirrored in a ref alongside state: state drives the live drag transform,
  // but `onPointerUp` needs a synchronous read of the final dx to decide
  // click vs. drag — reading it back out of `drag` state there would race,
  // since state updates from earlier in the same gesture aren't guaranteed
  // to have committed yet.
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)

  const orders = cards.map((c) => c.order)
  const minOrder = orders.length ? Math.min(...orders) : 0
  const maxOrder = orders.length ? Math.max(...orders) : 0
  const trackWidth = (maxOrder - minOrder) * PX_PER_UNIT + PX_PER_UNIT * 2
  const xFor = (order: number): number => (order - minOrder) * PX_PER_UNIT + PX_PER_UNIT

  const stacks = stackByPosition(cards)

  const startDrag =
    (id: string, order: number) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      // Guarded: jsdom (unit tests) has no Pointer Events implementation at
      // all, and this is a nice-to-have (keeps the drag tracking outside the
      // element's bounds) rather than something the interaction depends on.
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const next: Drag = { id, startClientX: e.clientX, startOrder: order, dx: 0 }
      dragRef.current = next
      setDrag(next)
    }

  const moveDrag =
    (id: string) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (!dragRef.current || dragRef.current.id !== id) return
      const next: Drag = { ...dragRef.current, dx: e.clientX - dragRef.current.startClientX }
      dragRef.current = next
      setDrag(next)
    }

  const endDrag =
    (id: string) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
      const finished = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!finished || finished.id !== id) return
      if (Math.abs(finished.dx) > CLICK_THRESHOLD_PX) {
        onReorder(id, snapToGrid(finished.startOrder + finished.dx / PX_PER_UNIT))
      } else {
        onOpen(id)
      }
    }

  return (
    <div className="timeline-line-track" style={{ width: trackWidth, height: TRACK_HEIGHT }}>
      <div className="timeline-line-baseline" style={{ bottom: BASELINE_BOTTOM }} />
      {stacks.map((group) => (
        <div
          key={group[0].id}
          className="timeline-line-cluster"
          style={{ left: xFor(group[0].order), bottom: BASELINE_BOTTOM }}
        >
          <div className="timeline-line-tick" style={{ height: group.length * ROW_HEIGHT }} />
          {group.map((card, i) => {
            const dragging = drag?.id === card.id
            return (
              <div
                key={card.id}
                role="button"
                tabIndex={0}
                className={dragging ? 'timeline-line-card dragging' : 'timeline-line-card'}
                style={{
                  bottom: i * ROW_HEIGHT,
                  transform: dragging ? `translate(calc(-50% + ${drag.dx}px), 0)` : undefined
                }}
                onPointerDown={startDrag(card.id, card.order)}
                onPointerMove={moveDrag(card.id)}
                onPointerUp={endDrag(card.id)}
                onKeyDown={(e) => {
                  // Only react when the card itself is focused — the nested
                  // date input bubbles its own keydowns (including Space)
                  // through here, and those must not open the document.
                  if (e.target !== e.currentTarget) return
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onOpen(card.id)
                }}
              >
                <div className="timeline-line-title">{card.title}</div>
                <input
                  className="text-field timeline-line-date"
                  placeholder="+ date"
                  defaultValue={card.date ?? ''}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== (card.date ?? ''))
                      onDateChange(card.id, e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
