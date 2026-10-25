import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, JSX, KeyboardEvent } from 'react'
import { DEFAULT_PICTURE_OPTIONS } from '../lib/mapPicture'
import type { MapPictureOptions } from '../lib/mapPicture'
import { errorMessage } from '../lib/errors'

type Format = 'png' | 'svg'

/**
 * F-12: the map as a picture for the book. A clean copy in two inks, black
 * on white whatever the palette — none of the screen's tools, handles or
 * routes — as a PNG drawn at print size or an SVG that stays sharp at any.
 *
 * Esc closes it (stopped here: Esc is also "back"), and so does a press
 * anywhere else or focus going elsewhere, as the stamp palette closes. Export
 * is never silently dead: with nothing drawn it says so instead.
 */
export function MapExportPanel({
  hasScale,
  empty,
  toggle,
  onExport,
  onClose
}: {
  hasScale: boolean
  /** Nothing is drawn on the map: there is no picture to make. */
  empty: boolean
  /** The button that opens it: a press there is its own, not one elsewhere. */
  toggle: string
  /** Writes the picture; resolves to where, or null if the writer cancelled. */
  onExport: (format: Format, options: MapPictureOptions) => Promise<string | null>
  /** `written` is where the picture went, when one was written; `focus`,
   *  whether focus goes back to the button — not when the writer pressed or
   *  moved somewhere else, which has its own focus. */
  onClose: (written: string | undefined, focus: boolean) => void
}): JSX.Element {
  const [format, setFormat] = useState<Format>('png')
  const [options, setOptions] = useState<MapPictureOptions>(DEFAULT_PICTURE_OPTIONS)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const first = useRef<HTMLButtonElement | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  useEffect(() => first.current?.focus(), [])

  // Closed by a press anywhere but here or its own button.
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      const t = e.target as Element
      if (root.current?.contains(t) || t.closest?.(toggle)) return
      onClose(undefined, false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [toggle, onClose])

  // And by Tab or a click taking focus somewhere else; not by the window
  // losing focus (a save dialog, ⌘Tab), which leaves it where it was.
  const onBlur = (e: FocusEvent<HTMLDivElement>): void => {
    const to = e.relatedTarget as Element | null
    if (to && (root.current?.contains(to) || to.closest?.(toggle))) return
    if (!to && !document.hasFocus()) return
    if (!busy) onClose(undefined, false)
  }

  const run = (): void => {
    if (busy) return
    if (empty) {
      setProblem('Nothing is drawn on the map yet, so there is no picture to make.')
      return
    }
    setBusy(true)
    setProblem(null)
    onExport(format, { ...options, scaleBar: options.scaleBar && hasScale })
      .then((path) => (path ? onClose(path, true) : setBusy(false)))
      .catch((e: unknown) => {
        setProblem(errorMessage(e))
        setBusy(false)
      })
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose(undefined, true)
    }
  }

  const radio = (value: Format, label: string): JSX.Element => (
    <button
      type="button"
      role="radio"
      aria-checked={format === value}
      className="control-row"
      ref={value === 'png' ? first : undefined}
      onClick={() => setFormat(value)}
    >
      <span className={`radio${format === value ? ' on' : ''}`} />
      <span>{label}</span>
    </button>
  )
  const check = (key: keyof MapPictureOptions, label: string): JSX.Element => (
    <button
      type="button"
      role="checkbox"
      aria-checked={options[key]}
      className="control-row"
      onClick={() => setOptions((o) => ({ ...o, [key]: !o[key] }))}
    >
      <span className={`check${options[key] ? ' on' : ''}`} />
      <span>{label}</span>
    </button>
  )

  return (
    <div
      className="map-scale-panel map-export-panel"
      role="dialog"
      aria-label="Export map image"
      ref={root}
      onKeyDown={onKey}
      onBlur={onBlur}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="field-name">EXPORT MAP IMAGE</div>
      <div role="radiogroup" aria-label="Format">
        {radio('png', 'PNG — a picture, drawn at print size')}
        {radio('svg', 'SVG — sharp at any size')}
      </div>
      <div className="field-name">SHOW</div>
      {check('trim', 'Only what is drawn, not the empty sea')}
      {check('grid', 'The grid')}
      {hasScale && check('scaleBar', 'The scale bar')}
      <div className="dialog-hint">
        Black on white, whatever the palette, with none of the map’s tools on it.
      </div>
      {problem && (
        <div className="map-name-problem map-scale-problem" role="alert">
          {problem}
        </div>
      )}
      <div className="dialog-buttons">
        <button type="button" className="btn" onClick={() => onClose(undefined, true)}>
          Cancel
        </button>
        <button type="button" className="btn default" onClick={run} aria-busy={busy}>
          {busy ? 'Exporting…' : 'Export'}
        </button>
      </div>
    </div>
  )
}
