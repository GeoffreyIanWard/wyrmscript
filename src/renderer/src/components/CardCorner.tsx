import type { JSX } from 'react'

/**
 * F-42: the corner of an index card, bent up — the way a card is turned over
 * by hand. On the front it turns the card to its back; on the back, back to
 * the front. The corner itself is folded over along the diagonal, so where
 * it was the cork shows through, and the flap lies on the card's face with
 * its underside up: outlined in ink, hatched along the crease, and ruled
 * with a line or two when the back has writing on it, as writing shows
 * through a turned-up corner. Two inks, like every card.
 *
 * Its press is its own (stopped), so turning a card over never starts a drag.
 */
export function CardCorner({
  label,
  side,
  className = '',
  written = false,
  onTurn
}: {
  /** What the corner does, to a screen reader and as its tip. */
  label: string
  /** Which face it is the corner of. */
  side: 'front' | 'back'
  className?: string
  /** The back has writing on it. */
  written?: boolean
  onTurn: () => void
}): JSX.Element {
  const props = {
    type: 'button' as const,
    className: `card-corner${written ? ' written' : ''}${className ? ` ${className}` : ''}`,
    'aria-label': label,
    title: label,
    onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onClick: onTurn
  }
  const flap = (
    <svg className="card-corner-flap" viewBox="0 0 24 24" aria-hidden="true">
      <path className="card-corner-under" d="M 1 1 H 23 L 1 23 Z" />
      <path className="card-corner-crease" d="M 6 15.5 L 15.5 6 M 3.5 11 L 11 3.5" />
      {written && <path className="card-corner-writing" d="M 4 6 H 11 M 4 9 H 8" />}
    </svg>
  )
  // The help ids written out, not computed: guided help's drift guard reads
  // the source for literal `data-help="…"` strings.
  return side === 'front' ? (
    <button data-help="card-turn" {...props}>
      {flap}
    </button>
  ) : (
    <button data-help="card-turn-back" {...props}>
      {flap}
    </button>
  )
}
