import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useWyrm } from '../store'
import { WyrmIcon } from './icons'

function recentDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function Welcome(): JSX.Element {
  const newProject = useWyrm((s) => s.newProject)
  const openProject = useWyrm((s) => s.openProject)
  const openRecentProject = useWyrm((s) => s.openRecentProject)
  const restoreFromBackup = useWyrm((s) => s.restoreFromBackup)
  const recentProjects = useWyrm((s) => s.recentProjects)
  const loadRecentProjects = useWyrm((s) => s.loadRecentProjects)
  const [title, setTitle] = useState('')

  // F-24: Welcome only ever renders with no project open, which is exactly
  // when the recents list can have gone stale (closing a project, or a
  // recent one having been pruned for no longer existing on disk).
  useEffect(() => {
    void loadRecentProjects()
  }, [loadRecentProjects])

  return (
    <div className="dialog-overlay">
      <div className="dialog welcome">
        <div className="title-bar">
          <span className="title">Welcome to WyrmStar</span>
        </div>
        <div className="dialog-body">
          <div className="about-art">
            <WyrmIcon size={48} />
          </div>
          <div className="about-small" style={{ marginBottom: 16 }}>
            <div>WYRMSTAR</div>
            <div>Nothing is ever truly lost.</div>
          </div>
          {recentProjects.length > 0 && (
            <fieldset className="fieldset">
              <legend>RECENT</legend>
              {recentProjects.map((p) => (
                <div
                  key={p.path}
                  className="welcome-recent-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => void openRecentProject(p.path)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    void openRecentProject(p.path)
                  }}
                >
                  <span className="row-title">{p.title}</span>
                  <span className="welcome-recent-date">{recentDate(p.openedAt)}</span>
                </div>
              ))}
            </fieldset>
          )}
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
