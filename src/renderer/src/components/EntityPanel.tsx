import type { JSX } from 'react'

type EntityPanelProps = {
  onClose: () => void
}

export function EntityPanel({ onClose }: EntityPanelProps): JSX.Element {
  return (
    <div className="entity-panel">
      <div className="panel-title">
        <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
        <span className="title-text">CHARACTER</span>
      </div>
      <div className="panel-body">
        <h3>Elara Voss</h3>
        <div className="panel-field">
          <div className="field-name">ALIASES</div>
          <div className="field-value">Elara · Captain Voss · the Captain</div>
        </div>
        <div className="panel-field">
          <div className="field-name">NOTES</div>
          <div className="field-value">
            Former harbor-guard captain of Harrowgate, cashiered after the Siege of the Narrows.
            Keeps her old commission folded in a tobacco tin she never opens. Sister to Marten
            (deceased). Sleeps badly; notices everything.
          </div>
        </div>
        <div className="backlinks">
          <div className="field-name" style={{ marginBottom: 6 }}>
            MENTIONED IN
          </div>
          <div className="backlink-row">
            <span>▸</span>
            <span>The Wyrmlight Fades</span>
          </div>
          <div className="backlink-row">
            <span>▸</span>
            <span>A Knock at Night</span>
          </div>
          <div className="backlink-row">
            <span>▸</span>
            <span>The Toll Road</span>
          </div>
        </div>
      </div>
    </div>
  )
}
