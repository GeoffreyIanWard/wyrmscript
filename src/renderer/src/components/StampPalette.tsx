import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
 * The stamps, grouped, in a drop-down from the map's toolbar: forty-five
 * stamps were too many to keep as buttons along it, and the bar is meant to
 * leave room for the map. Each choice shows its own art, so a writer looks
 * for a castle by looking for a castle.
 *
 * A non-modal dialog, from the keyboard: it opens on the chosen stamp (or
 * the first) and is one Tab stop — a roving tabindex, so Tab leaves it
 * rather than walking all forty-five; Left and Right step through the list, Up
 * and Down move by row within the grid, Return chooses, and Esc closes it,
 * stopped here because Esc is also "back". Focus leaving it closes it too:
 * a palette left open over the map with focus elsewhere was a trap for the
 * next Esc.
 */
export function StampPalette({
  id,
  label = 'Stamps',
  current,
  allowPin = false,
  sizes,
  toggle = '.stamp-palette-toggle',
  closeOnPick = true,
  onPick,
  onClose
}: {
  id: string
  /** The dialog's name: "Stamps", or what a place is shown as. */
  label?: string
  /** The choice now: a stamp, or 'pin' for a place drawn as a pin. */
  current: MapStampKind | 'pin' | null
  /** Offer "Pin" first, for a place: a place can always go back to one. */
  allowPin?: boolean
  /** A size row under the stamps, for a place already on the map. */
  sizes?: {
    current: number
    names: string[]
    labels: string[]
    values: readonly number[]
    onSize: (size: number) => void
  }
  /** What opened it, which a press on closes it rather than the
   *  click-away: a selector. */
  toggle?: string
  /** Close once a choice is made — the map's palette does; a place's stays
   *  open so its size can be chosen next. */
  closeOnPick?: boolean
  onPick: (kind: MapStampKind | 'pin') => void
  /** Where the keyboard goes as it closes: back to its toggle (Esc), onto
   *  the map to stamp (a choice), or nowhere (a press or focus elsewhere). */
  onClose: (focus: 'toggle' | 'map' | 'none') => void
}): JSX.Element {
  const root = useRef<HTMLDivElement | null>(null)
  const groups: { name: string; kinds: (MapStampKind | 'pin')[] }[] = allowPin
    ? [{ name: 'Place', kinds: ['pin'] }, ...STAMP_GROUPS]
    : STAMP_GROUPS
  const flat = groups.flatMap((g) => g.kinds)
  const [active, setActive] = useState<MapStampKind | 'pin'>(current ?? flat[0])

  // Kept inside the map's window, across and down — measured afresh
  // whenever it changes height (a place's size row appears once it is a
  // stamp), from a clean slate, or the first fit outlives the content it was
  // for. A toggle far to the right (it names the stamp in hand, so it grows)
  // pushed it past the window's edge; a place's row low in the window, past
  // its foot.
  const hasSizes = sizes != null
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    el.style.left = ''
    el.style.marginTop = ''
    el.style.maxHeight = ''
    el.style.overflowY = ''
    const frame = el.closest('.world-map')?.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    if (!frame) return
    const over = box.right - (frame.right - 8)
    if (over > 0) el.style.left = `${-Math.min(over, box.left - frame.left - 8)}px`
    const under = box.bottom - (frame.bottom - 8)
    if (under <= 0) return
    // Up as far as the window's top, then it scrolls.
    const up = Math.max(0, Math.min(under, box.top - frame.top - 8))
    if (up > 0) el.style.marginTop = `${-up}px`
    const room = frame.bottom - 8 - (box.top - up)
    if (box.height > room) {
      el.style.maxHeight = `${room}px`
      el.style.overflowY = 'auto'
    }
  }, [hasSizes])

  useEffect(() => {
    root.current?.querySelector<HTMLElement>(`[data-stamp="${active}"]`)?.focus()
    // A press anywhere else closes it — but not the press on its own toggle,
    // which closes it itself.
    const away = (e: PointerEvent): void => {
      const t = e.target as Element
      if (root.current?.contains(t) || t.closest?.(toggle)) return
      onClose('none')
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const focusStamp = (kind: MapStampKind | 'pin'): void => {
    setActive(kind)
    root.current?.querySelector<HTMLElement>(`[data-stamp="${kind}"]`)?.focus()
  }

  /** The stamp a row up or down from `kind`, keeping its column, across
   *  groups; none past the first or last row. */
  const rowStep = (kind: MapStampKind | 'pin', dir: 1 | -1): MapStampKind | 'pin' | null => {
    const g = groups.findIndex((group) => group.kinds.includes(kind))
    const i = groups[g].kinds.indexOf(kind)
    const col = i % COLUMNS
    // The next row in its own group first, at the nearest column it has: a
    // short last row is still a row, not something to skip over.
    const kinds = groups[g].kinds
    const r = Math.floor(i / COLUMNS) + dir
    if (r >= 0 && r < Math.ceil(kinds.length / COLUMNS)) {
      const row = kinds.slice(r * COLUMNS, r * COLUMNS + COLUMNS)
      return row[Math.min(col, row.length - 1)]
    }
    const next = groups[g + dir]
    if (!next) return null
    // Into the neighbouring group's nearest row, at the same column or as
    // near it as that row goes.
    const rowStart = dir === 1 ? 0 : Math.floor((next.kinds.length - 1) / COLUMNS) * COLUMNS
    const row = next.kinds.slice(rowStart, rowStart + COLUMNS)
    return row[Math.min(col, row.length - 1)]
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Tab past either end goes back to what opened it, not to whatever comes
    // next in the window (for a place, the next one's controls, or the top of
    // the list): the writer was working on that row.
    if (e.key === 'Tab') {
      const stops = [
        ...(root.current?.querySelectorAll<HTMLElement>('button:not([tabindex="-1"])') ?? [])
      ]
      const edge = e.shiftKey ? stops[0] : stops[stops.length - 1]
      if (document.activeElement === edge) {
        e.preventDefault()
        onClose('toggle')
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose('toggle')
      return
    }
    const at = flat.indexOf(active)
    let next: MapStampKind | 'pin' | null = null
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
      aria-label={label}
      onKeyDown={onKey}
      onBlur={(e) => {
        const to = e.relatedTarget as Element | null
        if (to && (root.current?.contains(to) || to.closest?.(toggle))) return
        // No relatedTarget is the window losing focus (⌘Tab): not a choice
        // to leave, so the palette stays.
        if (to == null) return
        onClose('none')
      }}
      // Its own presses: none of them is a click on the map underneath.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {groups.map((group, g) => (
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
                  if (!closeOnPick) return
                  // From the keyboard, the Return that chose it must not
                  // reach whatever takes focus next.
                  if (e.detail === 0) afterKeysUp(() => onClose('map'))
                  else onClose('map')
                }}
              >
                {kind === 'pin' ? (
                  <span className="stamp-glyph pin-glyph" aria-hidden="true">
                    <span className="world-map-pin-glyph" />
                  </span>
                ) : (
                  <StampGlyph kind={kind} />
                )}
                <span>{kind === 'pin' ? 'Pin' : MARK_NAME[kind]}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {sizes && (
        <div className="stamp-palette-group">
          <div className="field-name" id={`${id}-size`}>
            SIZE
          </div>
          <div className="map-size" role="group" aria-labelledby={`${id}-size`}>
            {sizes.values.map((size, i) => (
              <button
                key={size}
                type="button"
                className={`map-size-step${size === sizes.current ? ' on' : ''}`}
                aria-pressed={size === sizes.current}
                aria-label={`${sizes.names[i]} (${sizes.labels[i]})`}
                onClick={() => sizes.onSize(size)}
              >
                {sizes.labels[i]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
