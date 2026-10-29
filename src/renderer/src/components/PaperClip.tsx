import type { JSX } from 'react'

/**
 * A paper clip, drawn in whole pixels: on the Save To drawer's default card,
 * and on the merge screen's stacks (F-51), where it is the handle that moves
 * a whole stack. Four wires two pixels thick with two pixels of paper
 * between any that run side by side, and a one-pixel paper outline so the
 * clip stays clear of the card's border.
 */
const CLIP_WIRES: [number, number, number, number][] = [
  [4, 14, 2, 22],
  [6, 35, 2, 2],
  [8, 4, 2, 31],
  [2, 2, 6, 2],
  [0, 4, 2, 39],
  [2, 42, 10, 2],
  [12, 12, 2, 30]
]

export function PaperClip(): JSX.Element {
  return (
    <svg
      className="paper-clip"
      width="16"
      height="46"
      viewBox="-1 -1 16 46"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {CLIP_WIRES.map(([x, y, w, h], i) => (
        <rect key={`h${i}`} x={x - 1} y={y - 1} width={w + 2} height={h + 2} fill="var(--paper)" />
      ))}
      {CLIP_WIRES.map(([x, y, w, h], i) => (
        <rect key={`w${i}`} x={x} y={y} width={w} height={h} fill="var(--ink)" />
      ))}
    </svg>
  )
}
