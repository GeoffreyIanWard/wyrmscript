import type { JSX } from 'react'

/**
 * F-22: a ruler bar showing real character-column numbers against the
 * actual configured line width (F-06) — the one piece of this feature that
 * can't be a decorative background image the way F-20/F-21's ruled lines
 * and grid are, because the numbers have to be *real*. `ch` is exact for
 * this on the prose font (`--font-prose` is monospace), so tick positions
 * are plain CSS rather than anything measured in JS: a tick at `Nch` sits
 * under character column N regardless of font size, the same unit `.page`'s
 * own `max-width: var(--measure)ch` already tracks.
 *
 * Rendered as the first child of `.terminal-scroll` (see `Editor.tsx`),
 * `position: sticky` there rather than a separate non-scrolling wrapper —
 * sharing that scroll container is what keeps its centering identical to
 * `.page`'s own; a wrapper outside `.terminal-scroll` would center against
 * the full pane width, while `.page` centers against the width remaining
 * after the scrollbar, drifting the ruler out of alignment the moment a
 * document is tall enough to scroll.
 */
export function HalftoneRuler({ measure }: { measure: number }): JSX.Element {
  const ticks: number[] = []
  for (let n = 0; n <= measure; n += 10) ticks.push(n)

  return (
    <div className="halftone-ruler" aria-hidden="true">
      <div className="halftone-ruler-track" style={{ width: `${measure}ch` }}>
        {ticks.map((n) => (
          <span key={n} className="halftone-ruler-tick" style={{ left: `${n}ch` }}>
            {n}
          </span>
        ))}
      </div>
    </div>
  )
}
