import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { DocFile, Plotline } from '../../../shared/types'
import { PLOTLINE_COLOURS, SCENE_TAG } from '../../../shared/types'
import { api } from '../lib/api'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useWyrm } from '../store'

/**
 * F-04: plotline tracking. A plotline is its own lightweight record (name,
 * colour, status) — not a story-bible `Entity` (it never auto-links in
 * prose) and not just a tag (a tag has nowhere to hang a colour or a
 * status). A scene belongs to a plotline by carrying a tag equal to the
 * plotline's name — the same free-form tag mechanism as everywhere else, so
 * linking a scene to a plotline is just typing its name into the existing
 * "+ tag" field in the doc header. Setup/payoff beats reuse F-10's existing
 * `DOC_PINS` (`Setup` / `Resolution`) rather than a plotline-specific
 * vocabulary.
 */

function PlotlineRow({
  plotline,
  scenes,
  onRename,
  onColour,
  onToggleStatus,
  onDelete,
  onOpenScene
}: {
  plotline: Plotline
  scenes: DocFile[]
  onRename: (name: string) => void
  onColour: (colour: string) => void
  onToggleStatus: () => void
  onDelete: () => void
  onOpenScene: (id: string) => void
}): JSX.Element {
  const [name, setName] = useState(plotline.name)
  const setup = scenes.find((d) => d.meta.pins?.includes('Setup'))
  const payoff = scenes.find((d) => d.meta.pins?.includes('Resolution'))
  const resolved = plotline.status === 'resolved'

  return (
    <div className="plotline-row">
      <div className="plotline-header">
        <div className="plotline-swatches">
          {PLOTLINE_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Set colour ${c}`}
              aria-pressed={plotline.colour === c}
              className={plotline.colour === c ? 'plotline-swatch on' : 'plotline-swatch'}
              style={{ background: c }}
              onClick={() => onColour(c)}
            />
          ))}
        </div>
        <input
          className="text-field plotline-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== plotline.name) onRename(name.trim())
            else setName(plotline.name)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        <button
          type="button"
          role="checkbox"
          aria-checked={resolved}
          className={resolved ? 'plotline-status on' : 'plotline-status'}
          onClick={onToggleStatus}
        >
          {resolved ? 'RESOLVED' : 'OPEN'}
        </button>
        <button type="button" className="btn small" onClick={onDelete}>
          Delete
        </button>
      </div>
      <div className="plotline-meta">
        <span>
          {scenes.length} scene{scenes.length === 1 ? '' : 's'}
        </span>
        <span>
          Setup:{' '}
          {setup ? (
            <button
              type="button"
              className="plotline-scene-link"
              onClick={() => onOpenScene(setup.meta.id)}
            >
              {setup.meta.title}
            </button>
          ) : (
            '—'
          )}
        </span>
        <span>
          Payoff:{' '}
          {payoff ? (
            <button
              type="button"
              className="plotline-scene-link"
              onClick={() => onOpenScene(payoff.meta.id)}
            >
              {payoff.meta.title}
            </button>
          ) : (
            '—'
          )}
        </span>
      </div>
    </div>
  )
}

export function PlotlinesDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const project = useWyrm((s) => s.project)
  const plotlines = useWyrm((s) => s.plotlines)
  const loadPlotlines = useWyrm((s) => s.loadPlotlines)
  const createPlotline = useWyrm((s) => s.createPlotline)
  const savePlotline = useWyrm((s) => s.savePlotline)
  const deletePlotline = useWyrm((s) => s.deletePlotline)
  const showDoc = useWyrm((s) => s.showDoc)
  const selectDoc = useWyrm((s) => s.selectDoc)

  const [docs, setDocs] = useState<DocFile[] | null>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    void loadPlotlines()
  }, [loadPlotlines])

  useEffect(() => {
    if (!project) return
    let live = true
    void api.readAllDocs(project.path).then((all) => live && setDocs(all))
    return () => {
      live = false
    }
  }, [project])

  const scenesFor = (plotline: Plotline): DocFile[] =>
    (docs ?? []).filter(
      (d) => d.meta.tags?.includes(SCENE_TAG) && d.meta.tags.includes(plotline.name)
    )

  const openScene = (id: string): void => {
    onClose()
    showDoc()
    void selectDoc(id)
  }

  const add = (): void => {
    if (!name.trim()) return
    void createPlotline(name)
    setName('')
  }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div
        className="dialog plotlines-dialog"
        ref={trapRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Plotlines</span>
        </div>
        <div className="dialog-body">
          <div className="entry-field plotline-add">
            <input
              className="text-field"
              placeholder="New plotline name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add()
              }}
            />
            <button type="button" className="btn small" disabled={!name.trim()} onClick={add}>
              + Add
            </button>
          </div>

          {plotlines.length === 0 && (
            <div className="dialog-hint">
              No plotlines yet. Add one, then tag scenes with its name (in the doc header&rsquo;s
              &ldquo;+ tag&rdquo; field) to track them here.
            </div>
          )}

          <div className="plotline-list">
            {plotlines.map((plotline) => (
              <PlotlineRow
                key={plotline.id}
                plotline={plotline}
                scenes={scenesFor(plotline)}
                onRename={(next) => void savePlotline({ ...plotline, name: next })}
                onColour={(c) => void savePlotline({ ...plotline, colour: c })}
                onToggleStatus={() =>
                  void savePlotline({
                    ...plotline,
                    status: plotline.status === 'resolved' ? 'open' : 'resolved'
                  })
                }
                onDelete={() => void deletePlotline(plotline)}
                onOpenScene={openScene}
              />
            ))}
          </div>
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
