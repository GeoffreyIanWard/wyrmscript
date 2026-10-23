import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { MapStampKind } from '../../../shared/types'
import { afterKeysUp } from '../lib/keys'
import { MARK_NAME, STAMP_ART, STAMP_GROUPS } from '../lib/mapMarks'

/** One stamp's art at a given size, in the palette's own small boxes. */
export function StampGlyph({
  kind,
  scale = 1.25
}: {
  kind: MapStampKind
  scale?: number
}): JSX.Element {
  const art = STAMP_ART[kind]
  return (
    <svg
      className="stamp-glyph"
      width={24 * scale}
      height={20 * scale}
      viewBox="0 0 24 20"
      aria-hidden="true"
    >
      {art.body && <path className="map-stamp-body" d={art.body} />}
      <path className="map-stamp-lines" d={art.lines} />
      {art.solid && <path className="map-stamp-solid" d={art.solid} />}
    </svg>
  )
}

/** How many stamps sit in a row of the palette's grid (`.stamp-palette-grid`). */
const COLUMNS = 4

/**
 * The stamps, grouped, in a drop-down from the map's toolbar: nineteen
 * stamps were too many to keep as buttons along it, and the bar is meant to
 * leave room for the map. Each choice shows its own art, so a writer looks
 * for a castle by looking for a castle.
 *
 * A non-modal dialog, from the keyboard: it opens on the chosen stamp (or
 * the first) and is one Tab stop — a roving tabindex, so Tab leaves it
 * rather than walking all nineteen; Left and Right step through the list, Up
 * and Down move by row within the grid, Return chooses, and Esc closes it,
 * stopped here because Esc is also "back". Focus leaving it closes it too:
 * a palette left open over the map with focus elsewhere was a trap for the
 * next Esc.
 */
export function StampPalette({
  id,
  current,
  onPick,
  onClose
}: {
  id: string
  current: MapStampKind | null
  onPick: (kind: MapStampKind) => void
  /** Where the keyboard goes as it closes: back to its toggle (Esc), onto
   *  the map to stamp (a choice), or nowhere (a press or focus elsewhere). */
  onClose: (focus: 'toggle' | 'map' | 'none') => void
}): JSX.Element {
  const root = useRef<HTMLDivElement | null>(null)
  const flat = STAMP_GROUPS.flatMap((g) => g.kinds)
  const [active, setActive] = useState<MapStampKind>(current ?? flat[0])

  useEffect(() => {
    // Kept inside the map's window: it opens under its toggle, and a toggle
    // far to the right (it names the stamp in hand, so it grows) pushed it
    // past the window's edge, where the window clipped it.
    const el = root.current
    const frame = el?.closest('.world-map')?.getBoundingClientRect()
    const box = el?.getBoundingClientRect()
    if (el && frame && box) {
      const over = box.right - (frame.right - 8)
      if (over > 0) el.style.left = `${-Math.min(over, box.left - frame.left - 8)}px`
    }
    root.current?.querySelector<HTMLElement>(`[data-stamp="${active}"]`)?.focus()
    // A press anywhere else closes it — but not the press on its own toggle,
    // which closes it itself.
    const away = (e: PointerEvent): void => {
      const t = e.target as Element
      if (root.current?.contains(t) || t.closest?.('.stamp-palette-toggle')) return
      onClose('none')
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const focusStamp = (kind: MapStampKind): void => {
    setActive(kind)
    root.current?.querySelector<HTMLElement>(`[data-stamp="${kind}"]`)?.focus()
  }

  /** The stamp a row up or down from `kind`, keeping its column, across
   *  groups; none past the first or last row. */
  const rowStep = (kind: MapStampKind, dir: 1 | -1): MapStampKind | null => {
    const g = STAMP_GROUPS.findIndex((group) => group.kinds.includes(kind))
    const i = STAMP_GROUPS[g].kinds.indexOf(kind)
    const col = i % COLUMNS
    const within = STAMP_GROUPS[g].kinds[i + dir * COLUMNS]
    if (within) return within
    const next = STAMP_GROUPS[g + dir]
    if (!next) return null
    // Into the neighbouring group's nearest row, at the same column or as
    // near it as that row goes.
    const rowStart = dir === 1 ? 0 : Math.floor((next.kinds.length - 1) / COLUMNS) * COLUMNS
    const row = next.kinds.slice(rowStart, rowStart + COLUMNS)
    return row[Math.min(col, row.length - 1)]
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose('toggle')
      return
    }
    const at = flat.indexOf(active)
    let next: MapStampKind | null = null
    if (e.key === 'ArrowRight') next = flat[(at + 1) % flat.length]
    else if (e.key === 'ArrowLeft') next = flat[(at - 1 + flat.length) % flat.length]
    else if (e.key === 'ArrowDown') next = rowStep(active, 1)
    else if (e.key === 'ArrowUp') next = rowStep(active, -1)
    else if (e.key === 'Home') next = flat[0]
    else if (e.key === 'End') next = flat[flat.length - 1]
    else return
    e.preventDefault()
    if (next) focusStamp(next)
  }

  return (
    <div
      id={id}
      className="stamp-palette"
      ref={root}
      role="dialog"
      aria-label="Stamps"
      onKeyDown={onKey}
      onBlur={(e) => {
        const to = e.relatedTarget as Element | null
        if (to && (root.current?.contains(to) || to.closest?.('.stamp-palette-toggle'))) return
        // No relatedTarget is the window losing focus (⌘Tab): not a choice
        // to leave, so the palette stays.
        if (to == null) return
        onClose('none')
      }}
      // Its own presses: none of them is a click on the map underneath.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {STAMP_GROUPS.map((group, g) => (
        <div key={group.name} className="stamp-palette-group">
          <div className="field-name" id={`${id}-group-${g}`}>
            {group.name.toUpperCase()}
          </div>
          <div className="stamp-palette-grid" role="group" aria-labelledby={`${id}-group-${g}`}>
            {group.kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                data-stamp={kind}
                className={`stamp-palette-item${kind === current ? ' on' : ''}`}
                aria-pressed={kind === current}
                tabIndex={kind === active ? 0 : -1}
                onFocus={() => setActive(kind)}
                onClick={(e) => {
                  onPick(kind)
                  // From the keyboard, the Return that chose it must not
                  // reach whatever takes focus next.
                  if (e.detail === 0) afterKeysUp(() => onClose('map'))
                  else onClose('map')
                }}
              >
                <StampGlyph kind={kind} />
                <span>{MARK_NAME[kind]}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
