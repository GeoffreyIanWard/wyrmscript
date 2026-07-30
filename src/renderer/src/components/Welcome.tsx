import { useState } from 'react'
import type { JSX } from 'react'
import { useWyrm } from '../store'
import { WyrmIcon } from './icons'

export function Welcome(): JSX.Element {
  const newProject = useWyrm((s) => s.newProject)
  const openProject = useWyrm((s) => s.openProject)
  const restoreFromBackup = useWyrm((s) => s.restoreFromBackup)
  const [title, setTitle] = useState('')

  return (
    <div className="dialog-overlay">
      <div className="dialog welcome">
        <div className="title-bar">
          <span className="title">Welcome to Wyrmscript</span>
        </div>
        <div className="dialog-body">
          <div className="about-art">
            <WyrmIcon size={48} />
          </div>
          <div className="about-small" style={{ marginBottom: 16 }}>
            <div>WYRMSCRIPT</div>
            <div>Nothing is ever truly lost.</div>
          </div>
          <fieldset className="fieldset">
            <legend>NEW PROJECT</legend>
            <div className="control-row">
              <input
                className="text-field"
                placeholder="Title of your novel"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void newProject(title)
                }}
              />
              <button type="button" className="btn" onClick={() => void newProject(title)}>
                Create…
              </button>
            </div>
          </fieldset>
        </div>
        <div className="dialog-buttons">
          {/* The moment a backup matters most is the moment there is no project
              to reach it through — so restore has to live out here too. */}
          <button type="button" className="btn" onClick={() => void restoreFromBackup()}>
            Restore from Backup…
          </button>
          <button type="button" className="btn default" onClick={() => void openProject()}>
            Open Project…
          </button>
        </div>
      </div>
    </div>
  )
}
