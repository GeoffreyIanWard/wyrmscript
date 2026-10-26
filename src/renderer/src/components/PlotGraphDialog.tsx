import { useEffect, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import type { DocFile } from '../../../shared/types'
import { api } from '../lib/api'
import { timelineCards, type TimelineCard } from '../lib/timeline'
import { allDocIds } from '../lib/compile'
import {
  actBands,
  actCounts,
  actHeading,
  clampTension,
  DEFAULT_TENSION,
  TENSION_MAX
} from '../lib/plotGraph'
import { findMasterPlot, MASTER_PLOTS, sampleMasterPlot } from '../lib/masterPlots'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useWyrm } from '../store'

/**
 * F-03: dramatic shape at a glance — the same scene-tagged, timeline-ordered
 * cards as F-02/F-29 (`timelineCards`), plotted with tension on the y-axis
 * instead of chronology. Tension is manual only, set by dragging a node up
 * or down; the x-axis reuses `timelineOrder` as-is rather than a second
 * "narrative order" field, so a scene's dramatic-shape position always
 * matches its position on the timeline.
 *
 * One curve only (design decision) — overlaying a curve per plotline needs
 * F-04's plotline model to exist first, which it doesn't yet.
 *
 * F-35 adds an optional *reference* curve on top: a preset dramatic shape
 * (`lib/masterPlots.ts`), drawn dashed so it can never be mistaken for the
 * writer's own solid line, and never written back to `DocMeta.tension`.
 */

const PX_PER_UNIT_X = 140
const PX_PER_TENSION = 24
const CLICK_THRESHOLD_PX = 4

interface Drag {
  id: string
  startClientY: number
  startTension: number
  dy: number
}

export function PlotGraphDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const project = useWyrm((s) => s.project)
  const showDoc = useWyrm((s) => s.showDoc)
  const selectDoc = useWyrm((s) => s.selectDoc)
  const setTension = useWyrm((s) => s.setTension)
  const [docs, setDocs] = useState<DocFile[] | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  // F-35: local state, deliberately not persisted — a reference curve is
  // something a writer holds up against their own for a moment, not a
  // setting about their manuscript.
  const [presetId, setPresetId] = useState('')

  useEffect(() => {
    if (!project) return
    let live = true
    void api.readAllDocs(project.path).then((all) => live && setDocs(all))
    return () => {
      live = false
    }
  }, [project])

  // The scenes in the binder: a trashed scene's file is still on disk, and
  // would otherwise count in an act and stretch the graph.
  const cards =
    docs && project
      ? timelineCards(docs, project.data.binder).filter((c) =>
          allDocIds(project.data.binder).includes(c.id)
        )
      : []

  const patchTension = (id: string, tension: number): void => {
    setDocs(
      (prev) =>
        prev?.map((d) => (d.meta.id === id ? { ...d, meta: { ...d.meta, tension } } : d)) ?? prev
    )
    void setTension(id, tension)
  }

  const orders = cards.map((c) => c.order)
  const minOrder = orders.length ? Math.min(...orders) : 0
  const maxOrder = orders.length ? Math.max(...orders) : 0
  const trackWidth = (maxOrder - minOrder) * PX_PER_UNIT_X + PX_PER_UNIT_X * 2
  const trackHeight = TENSION_MAX * PX_PER_TENSION + 60
  const xFor = (order: number): number => (order - minOrder) * PX_PER_UNIT_X + PX_PER_UNIT_X
  const yFor = (tension: number): number => (TENSION_MAX - tension) * PX_PER_TENSION + 20

  // Unclamped and unrounded while dragging, so the node and curve move
  // smoothly under the pointer — clampTension only applies at drop.
  const visualTension = (card: TimelineCard): number => {
    if (drag?.id === card.id) {
      return Math.min(TENSION_MAX, Math.max(0, drag.startTension - drag.dy / PX_PER_TENSION))
    }
    return card.tension ?? DEFAULT_TENSION
  }

  const sorted = [...cards].sort((a, b) => a.order - b.order)
  // F-42: the scenes grouped by act, as they fall in timeline order, and how
  // many each act has. Shown only once some scene has an act.
  const bands = actBands(sorted)
  const counts = actCounts(sorted)
  const points = sorted.map((c) => `${xFor(c.order)},${yFor(visualTension(c))}`).join(' ')

  // F-35: the preset is stretched to however many scenes exist, then plotted
  // against the same x positions as the real nodes — so the two curves are
  // always compared beat-for-beat rather than over different spans.
  const preset = presetId ? findMasterPlot(presetId) : undefined
  const presetPoints = preset
    ? sampleMasterPlot(preset, sorted.length)
        .map((tension, i) => `${xFor(sorted[i].order)},${yFor(tension)}`)
        .join(' ')
    : ''

  const startDrag =
    (id: string, tension: number) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const next: Drag = { id, startClientY: e.clientY, startTension: tension, dy: 0 }
      dragRef.current = next
      setDrag(next)
    }

  const moveDrag =
    (id: string) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (!dragRef.current || dragRef.current.id !== id) return
      const next: Drag = { ...dragRef.current, dy: e.clientY - dragRef.current.startClientY }
      dragRef.current = next
      setDrag(next)
    }

  const openCard = (id: string): void => {
    onClose()
    showDoc()
    void selectDoc(id)
  }

  const endDrag =
    (id: string) =>
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
      const finished = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!finished || finished.id !== id) return
      if (Math.abs(finished.dy) > CLICK_THRESHOLD_PX) {
        patchTension(id, clampTension(finished.startTension - finished.dy / PX_PER_TENSION))
      } else {
        openCard(id)
      }
    }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div
        className="dialog plot-graph-dialog"
        ref={trapRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Plot Graph</span>
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
            <div className="control-row plot-graph-preset-row">
              <label className="field-name" htmlFor="master-plot">
                COMPARE WITH
              </label>
              <select
                id="master-plot"
                className="text-field"
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
              >
                <option value="">None</option>
                {MASTER_PLOTS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="spacer" />
              {preset && <span className="plot-graph-preset-key">reference</span>}
            </div>
          )}
          {preset && <div className="dialog-hint">{preset.blurb}</div>}
          {bands.length > 0 && (
            <div className="plot-graph-acts" data-help="plot-graph-acts">
              {[
                ...counts.acts.map(
                  ({ act, count }) =>
                    `${actHeading(act)}: ${count} ${count === 1 ? 'scene' : 'scenes'}`
                ),
                ...(counts.none > 0 ? [`No act: ${counts.none}`] : [])
              ].join(' · ')}
            </div>
          )}
          {cards.length > 0 && (
            <div className="plot-graph-track" style={{ width: trackWidth, height: trackHeight }}>
              {/* Each run of scenes in one act, behind the curve: ruled off
                  from its neighbours and named at the top. */}
              {(() => {
                // A band overlapping the one before it (scenes stacked on one
                // place on the timeline) is named a line lower, unless that
                // one already was — so overlapping names alternate.
                const lowered: boolean[] = []
                return bands.map((band, i) => {
                  const left = xFor(sorted[band.from].order) - PX_PER_UNIT_X / 2
                  const right = xFor(sorted[band.to].order) + PX_PER_UNIT_X / 2
                  const n = band.to - band.from + 1
                  const prev = bands[i - 1]
                  const prevRight = prev
                    ? xFor(sorted[prev.to].order) + PX_PER_UNIT_X / 2
                    : -Infinity
                  // Ruled on the left unless it follows straight on from the
                  // band before (whose right rule is its left); named a line
                  // lower when it overlaps that band, so the names never sit
                  // on each other (scenes stacked on one timeline position).
                  const starts = !prev || band.from !== prev.to + 1 || left > prevRight + 0.5
                  const lower = prev != null && left < prevRight - 0.5 && !lowered[i - 1]
                  lowered[i] = lower
                  const heading = `${actHeading(band.act)} · ${n}`
                  return (
                    <div
                      key={`${band.act}-${band.from}`}
                      className={`plot-graph-act${starts ? ' starts' : ''}`}
                      style={{ left, width: right - left, height: trackHeight }}
                      aria-hidden="true"
                    >
                      <span
                        className={`plot-graph-act-name${lower ? ' lower' : ''}`}
                        style={{ maxWidth: right - left - 8 }}
                        title={heading}
                      >
                        {heading}
                      </span>
                    </div>
                  )
                })
              })()}
              <svg
                className="plot-graph-svg"
                width={trackWidth}
                height={trackHeight}
                aria-hidden="true"
              >
                {[0, 5, 10].map((t) => (
                  <line
                    key={t}
                    className="plot-graph-gridline"
                    x1={0}
                    x2={trackWidth}
                    y1={yFor(t)}
                    y2={yFor(t)}
                  />
                ))}
                {/* Under the real curve, so the writer's own line is never
                    obscured by a reference drawn on top of it. */}
                {presetPoints && (
                  <polyline className="plot-graph-preset" points={presetPoints} fill="none" />
                )}
                <polyline className="plot-graph-curve" points={points} fill="none" />
              </svg>
              {[0, 5, 10].map((t) => (
                <div key={t} className="plot-graph-axis-label" style={{ top: yFor(t) }}>
                  {t}
                </div>
              ))}
              {sorted.map((card) => {
                const dragging = drag?.id === card.id
                const y = yFor(visualTension(card))
                return (
                  <div
                    key={card.id}
                    role="button"
                    tabIndex={0}
                    className={dragging ? 'plot-graph-node dragging' : 'plot-graph-node'}
                    style={{ left: xFor(card.order), top: y }}
                    onPointerDown={startDrag(card.id, card.tension ?? DEFAULT_TENSION)}
                    onPointerMove={moveDrag(card.id)}
                    onPointerUp={endDrag(card.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      openCard(card.id)
                    }}
                  >
                    <div className="plot-graph-dot" />
                    <div className="plot-graph-title">{card.title}</div>
                  </div>
                )
              })}
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
