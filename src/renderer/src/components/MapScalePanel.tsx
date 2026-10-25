import { useEffect, useId, useRef, useState } from 'react'
import type { JSX, KeyboardEvent, Ref } from 'react'
import type { MapScale } from '../../../shared/types'
import { afterKeysUp } from '../lib/keys'
import { DEFAULT_SCALE, formatDistance, MODES, toUnits, validScale } from '../lib/mapScale'

/** One grid square across: the graticule's spacing, in map pixels. */
const GRID = 100

type Field = 'distance' | 'unit' | 'foot' | 'horse' | 'ship'

/**
 * Setting the map's scale. A writer does not think in map pixels, so the
 * scale is said in things they can see: a route they have just measured
 * between two places whose distance they know, or else one square of the
 * map's grid. A day's travel on foot, on horseback and by ship is in the
 * same unit, so "how long does this journey take" has an answer.
 *
 * What it measures against is fixed as it opens: a route changed under an
 * open panel would otherwise have the number typed for one length saved
 * against another.
 *
 * Esc closes it without saving (stopped here: Esc is also "back"); Return
 * saves, once the key is up. A number that will not do is said beside its
 * field, never refused silently.
 */
export function MapScalePanel({
  scale,
  routePixels,
  onSave,
  onClose
}: {
  scale: MapScale | undefined
  /** The length of the route on the map as it opens, if one is measured:
   *  the scale is then set from it. */
  routePixels: number | null
  onSave: (scale: MapScale | null) => void
  onClose: () => void
}): JSX.Element {
  const id = useId()
  const base = validScale(scale) ? scale : DEFAULT_SCALE
  const [fromRoute] = useState(() => routePixels != null && routePixels > 0)
  const [against] = useState(() => (fromRoute && routePixels ? routePixels : GRID))
  const [distance, setDistance] = useState(() =>
    String(Number(toUnits(against, base).toPrecision(3)))
  )
  const [unit, setUnit] = useState(base.unit)
  const [perDay, setPerDay] = useState({
    foot: String(base.perDay.foot),
    horse: String(base.perDay.horse),
    ship: String(base.perDay.ship)
  })
  const [problem, setProblem] = useState<{ field: Field; text: string } | null>(null)
  const first = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    first.current?.focus()
    first.current?.select()
  }, [])

  const save = (): void => {
    const d = Number(distance)
    if (!Number.isFinite(d) || d <= 0) {
      setProblem({ field: 'distance', text: 'The distance needs to be a number above nought.' })
      return
    }
    if (!unit.trim()) {
      setProblem({ field: 'unit', text: 'Say what the distance is in — miles, leagues, days.' })
      return
    }
    const days = {
      foot: Number(perDay.foot),
      horse: Number(perDay.horse),
      ship: Number(perDay.ship)
    }
    const bad = MODES.find((m) => !Number.isFinite(days[m.key]) || days[m.key] <= 0)
    if (bad) {
      setProblem({
        field: bad.key,
        text: `A day’s travel ${bad.name} needs to be a number above nought.`
      })
      return
    }
    onSave({ pixels: against, distance: d, unit: unit.trim(), perDay: days })
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter' && (e.target as Element).tagName === 'INPUT') {
      e.preventDefault()
      e.stopPropagation()
      // The Return that saved must not reach whatever takes focus after.
      afterKeysUp(save)
    }
  }

  const field = (
    key: Field,
    label: string,
    value: string,
    set: (v: string) => void,
    ref?: Ref<HTMLInputElement>
  ): JSX.Element => (
    <label className="map-scale-field" key={key}>
      <span>{label}</span>
      <input
        ref={ref}
        className="text-field"
        inputMode={key === 'unit' ? 'text' : 'decimal'}
        value={value}
        aria-invalid={problem?.field === key ? true : undefined}
        aria-describedby={problem?.field === key ? `${id}-problem` : undefined}
        onChange={(e) => {
          set(e.target.value)
          setProblem(null)
        }}
      />
    </label>
  )

  return (
    <div
      className="map-scale-panel"
      role="dialog"
      aria-label="Map scale"
      onKeyDown={onKey}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="field-name">SCALE</div>
      <div className="map-scale-row">
        {field(
          'distance',
          fromRoute ? 'The route you measured is' : 'One square of the grid across is',
          distance,
          setDistance,
          first
        )}
        {field('unit', 'in', unit, setUnit)}
      </div>
      {validScale(scale) && !fromRoute && (
        <div className="dialog-hint">
          Now: a square is {formatDistance(toUnits(GRID, scale), scale.unit)}. Measure a route
          between two places you know, then come back here, to set it from that instead.
        </div>
      )}
      <div className="field-name">A DAY’S TRAVEL, IN {(unit.trim() || 'units').toUpperCase()}</div>
      <div className="map-scale-row">
        {MODES.map((m) =>
          field(m.key, m.name, perDay[m.key], (v) => setPerDay((p) => ({ ...p, [m.key]: v })))
        )}
      </div>
      {problem && (
        <div id={`${id}-problem`} className="map-name-problem map-scale-problem" role="alert">
          {problem.text}
        </div>
      )}
      <div className="dialog-buttons">
        {validScale(scale) && (
          <button type="button" className="btn" onClick={() => onSave(null)}>
            Remove Scale
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn default" onClick={save}>
          Set Scale
        </button>
      </div>
    </div>
  )
}
