import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { Relationship } from '../../../shared/types'
import { clusterCharacters, orderedClusters } from '../lib/characterGraph'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useWyrm } from '../store'

/**
 * F-11: a map rather than a list — characters grouped by faction (F-10's
 * first-tag convention, see `lib/characterGraph.ts`) with typed, directional
 * relationship edges drawn between individuals. Relationships are their own
 * lightweight record (`Relationship`), the same shape of decision as F-04's
 * `Plotline` — not a field on the character entity, which would drift out
 * of sync the moment one side of a two-way relationship was edited without
 * the other.
 *
 * Layout is deterministic (columns per cluster, stacked rows within one) —
 * no manual node dragging in this pass, which was out of scope for the
 * design questions this settled.
 */

const COLUMN_WIDTH = 160
const ROW_HEIGHT = 44
const PADDING = 30

export function CharacterGraphDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const entities = useWyrm((s) => s.entities)
  const relationships = useWyrm((s) => s.relationships)
  const loadRelationships = useWyrm((s) => s.loadRelationships)
  const createRelationship = useWyrm((s) => s.createRelationship)
  const deleteRelationship = useWyrm((s) => s.deleteRelationship)
  const showEntity = useWyrm((s) => s.showEntity)

  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [label, setLabel] = useState('')

  useEffect(() => {
    void loadRelationships()
  }, [loadRelationships])

  const characters = useMemo(() => entities.filter((e) => e.type === 'character'), [entities])
  const clusters = useMemo(() => orderedClusters(clusterCharacters(characters)), [characters])

  const positions = new Map<string, { x: number; y: number }>()
  clusters.forEach(([, group], col) => {
    group.forEach((c, row) => {
      positions.set(c.id, {
        x: PADDING + col * COLUMN_WIDTH + COLUMN_WIDTH / 2,
        y: PADDING + 20 + row * ROW_HEIGHT
      })
    })
  })

  const trackWidth = Math.max(1, clusters.length) * COLUMN_WIDTH + PADDING * 2
  const maxRows = Math.max(1, ...clusters.map(([, group]) => group.length))
  const trackHeight = PADDING * 2 + 20 + maxRows * ROW_HEIGHT

  const nameOf = (id: string): string => entities.find((e) => e.id === id)?.name ?? '(deleted)'

  const openCharacter = (id: string): void => {
    onClose()
    showEntity(id)
  }

  const add = (): void => {
    if (!fromId || !toId || fromId === toId || !label.trim()) return
    void createRelationship(fromId, toId, label)
    setLabel('')
  }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div
        className="dialog character-graph-dialog"
        ref={trapRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Character Graph</span>
        </div>
        <div className="dialog-body">
          {characters.length === 0 && (
            <div className="dialog-hint">
              No characters yet. Add one from Project → New Character… to see it here.
            </div>
          )}

          {characters.length > 0 && (
            <div
              className="character-graph-track"
              style={{ width: trackWidth, height: trackHeight }}
            >
              {clusters.map(([key], col) => (
                <div
                  key={key}
                  className="character-graph-cluster-label"
                  style={{ left: PADDING + col * COLUMN_WIDTH, width: COLUMN_WIDTH }}
                >
                  {key}
                </div>
              ))}
              <svg
                className="character-graph-svg"
                width={trackWidth}
                height={trackHeight}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="character-graph-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M0,0 L10,5 L0,10 z" fill="var(--ink)" />
                  </marker>
                </defs>
                {relationships.map((r) => {
                  const from = positions.get(r.fromId)
                  const to = positions.get(r.toId)
                  if (!from || !to) return null
                  const midX = (from.x + to.x) / 2
                  const midY = (from.y + to.y) / 2
                  return (
                    <g key={r.id}>
                      <line
                        className="character-graph-edge"
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        markerEnd="url(#character-graph-arrow)"
                      />
                      <text className="character-graph-edge-label" x={midX} y={midY - 4}>
                        {r.label}
                      </text>
                    </g>
                  )
                })}
              </svg>
              {characters.map((c) => {
                const pos = positions.get(c.id)
                if (!pos) return null
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="character-graph-node"
                    style={{ left: pos.x, top: pos.y }}
                    onClick={() => openCharacter(c.id)}
                  >
                    {c.name}
                  </button>
                )
              })}
            </div>
          )}

          {characters.length > 1 && (
            <div className="character-graph-add">
              <select
                className="text-field"
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
              >
                <option value="">From…</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                className="text-field"
                placeholder="relationship, e.g. sibling of"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') add()
                }}
              />
              <select className="text-field" value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="">To…</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn small"
                disabled={!fromId || !toId || fromId === toId || !label.trim()}
                onClick={add}
              >
                + Add
              </button>
            </div>
          )}

          {relationships.length > 0 && (
            <div className="character-graph-list">
              {relationships.map((r: Relationship) => (
                <div key={r.id} className="character-graph-row">
                  <span>
                    {nameOf(r.fromId)} <strong>{r.label}</strong> {nameOf(r.toId)}
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => void deleteRelationship(r)}
                  >
                    Delete
                  </button>
                </div>
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
