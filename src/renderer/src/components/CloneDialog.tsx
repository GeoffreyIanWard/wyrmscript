import { useState } from 'react'
import type { JSX } from 'react'
import { useFocusTrap } from '../lib/useFocusTrap'
import { BringDownPanel } from './BringDownPanel'

/**
 * Bring a project down from GitHub (F-43), as a dialog for the welcome
 * screen: a new computer has no project open, so no Save To drawer to hold
 * it. With a project open, the drawer's Restore from tab has the same panel.
 */
export function CloneDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const [busy, setBusy] = useState(false)
  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog wide" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Bring Down from GitHub</span>
        </div>
        <div className="dialog-body">
          <BringDownPanel onBroughtDown={onClose} onBusy={setBusy} />
        </div>
        <div className="dialog-buttons">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
