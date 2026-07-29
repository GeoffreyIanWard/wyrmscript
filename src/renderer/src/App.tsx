import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { MenuBar } from './components/MenuBar'
import { Binder } from './components/Binder'
import { Editor } from './components/Editor'
import { Welcome } from './components/Welcome'
import { AboutDialog, PrefsDialog } from './components/Dialogs'
import { CommitDialog, HistoryDialog, VariantsDialog } from './components/VersionDialogs'
import { useWyrm } from './store'
import { isElectron } from './lib/api'

export type AccentTheme = '1bit' | '4bit'
export type TerminalTheme = 'paper' | 'green' | 'amber'

const isElectronMac = /Macintosh/.test(navigator.userAgent) && /Electron/.test(navigator.userAgent)

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

function agoLabel(timestamp: number | null, now: number): string {
  if (!timestamp) return 'NO CHECKPOINT YET'
  const mins = Math.floor((now - timestamp) / 60000)
  if (mins < 1) return 'COMMITTED JUST NOW'
  if (mins === 1) return 'COMMITTED 1 MIN AGO'
  return `COMMITTED ${mins} MIN AGO`
}

function StatusBar(): JSX.Element {
  const project = useWyrm((s) => s.project)
  const wordCount = useWyrm((s) => s.wordCount)
  const saveState = useWyrm((s) => s.saveState)
  const activeDoc = useWyrm((s) => s.activeDoc)
  const lastCommitAt = useWyrm((s) => s.lastCommitAt)
  const now = useNow(30000)

  const saveLabel = saveState === 'saved' ? 'SAVED' : saveState === 'saving' ? 'SAVING…' : 'EDITED'
  return (
    <div className="status-bar">
      <span>{wordCount.toLocaleString()} WORDS</span>
      {activeDoc?.meta.status && <span>{activeDoc.meta.status.toUpperCase()}</span>}
      <span>{saveLabel}</span>
      <span className="spacer" />
      <span>{agoLabel(lastCommitAt, now)}</span>
      <span title={project?.path}>{isElectron ? '◆ LOCAL' : '◇ DEMO — IN MEMORY'}</span>
    </div>
  )
}

function App(): JSX.Element {
  const [accents, setAccents] = useState<AccentTheme>('1bit')
  const [terminal, setTerminal] = useState<TerminalTheme>('paper')
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [versionDialog, setVersionDialog] = useState<'commit' | 'history' | 'variants' | null>(null)

  const project = useWyrm((s) => s.project)
  const booted = useWyrm((s) => s.booted)
  const boot = useWyrm((s) => s.boot)

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      const state = useWyrm.getState()
      if (e.key === 's') {
        e.preventDefault()
        if (state.project) {
          void state.flushSave().then(() => setVersionDialog('commit'))
        }
      } else if (e.key === 'y' && state.activeDoc) {
        e.preventDefault()
        void state.flushSave().then(() => setVersionDialog('history'))
      } else if (e.key === 'n' && !e.shiftKey && state.project) {
        e.preventDefault()
        void state.addDoc(null)
      } else if ((e.key === 'N' || (e.key === 'n' && e.shiftKey)) && state.project) {
        e.preventDefault()
        void state.addFolder(null)
      } else if (e.key === ',') {
        e.preventDefault()
        setPrefsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className={`screen${isElectronMac ? ' is-electron-mac' : ''}`}
      data-accents={accents}
      data-terminal={terminal}
    >
      <MenuBar
        onAbout={() => setAboutOpen(true)}
        onPreferences={() => setPrefsOpen(true)}
        onVersionDialog={(dialog) => {
          void useWyrm
            .getState()
            .flushSave()
            .then(() => setVersionDialog(dialog))
        }}
      />
      <div className="desktop">
        {project ? (
          <div className="mac-window main-window">
            <div className="title-bar">
              <span className="close-box" />
              <span className="title">{project.data.title}</span>
              <span className="zoom-box" />
            </div>
            <div className="window-body">
              <Binder />
              <Editor />
            </div>
            <StatusBar />
          </div>
        ) : (
          booted && <Welcome />
        )}
        {prefsOpen && (
          <PrefsDialog
            accents={accents}
            terminal={terminal}
            onAccents={setAccents}
            onTerminal={setTerminal}
            onClose={() => setPrefsOpen(false)}
          />
        )}
        {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
        {versionDialog === 'commit' && <CommitDialog onClose={() => setVersionDialog(null)} />}
        {versionDialog === 'history' && <HistoryDialog onClose={() => setVersionDialog(null)} />}
        {versionDialog === 'variants' && <VariantsDialog onClose={() => setVersionDialog(null)} />}
      </div>
    </div>
  )
}

export default App
