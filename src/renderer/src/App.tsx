import { useEffect, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import { MenuBar } from './components/MenuBar'
import { Binder } from './components/Binder'
import { Editor } from './components/Editor'
import { EntityPanel } from './components/EntityPanel'
import { EntityEditor } from './components/EntityEditor'
import { Welcome } from './components/Welcome'
import { AboutDialog, PrefsDialog } from './components/Dialogs'
import { CommitDialog, HistoryDialog, VariantsDialog } from './components/VersionDialogs'
import { CompileDialog } from './components/CompileDialog'
import { BackupDialog } from './components/BackupDialog'
import { SyncDialog } from './components/SyncDialog'
import { ConflictDialog } from './components/ConflictDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useWyrm } from './store'
import { isElectron } from './lib/api'

import { DEFAULT_APPEARANCE } from '../../shared/types'

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
  const backupSettings = useWyrm((s) => s.backupSettings)
  const syncStatus = useWyrm((s) => s.syncStatus)
  const syncNeedsAttention = useWyrm((s) => s.syncNeedsAttention)
  const now = useNow(30000)

  const saveLabel = saveState === 'saved' ? 'SAVED' : saveState === 'saving' ? 'SAVING…' : 'EDITED'
  // States what is true, and stays quiet otherwise — neither an unbacked-up
  // nor a local-only project is nagged at from the status bar (F-01).
  const placeLabel = !isElectron
    ? '◇ DEMO — IN MEMORY'
    : syncStatus?.mode === 'github'
      ? syncNeedsAttention
        ? '◆ SYNC — NEEDS YOUR EYE'
        : syncStatus.pendingSync
          ? '◆ SYNC — WAITING'
          : '◆ SYNCED'
      : backupSettings?.path
        ? '◆ LOCAL + BACKUP'
        : '◆ LOCAL'
  return (
    <div className="status-bar">
      <span>{wordCount.toLocaleString()} WORDS</span>
      {activeDoc?.meta.status && <span>{activeDoc.meta.status.toUpperCase()}</span>}
      <span>{saveLabel}</span>
      <span className="spacer" />
      <span>{agoLabel(lastCommitAt, now)}</span>
      <span title={syncStatus?.remoteUrl ?? backupSettings?.path ?? project?.path}>
        {placeLabel}
      </span>
    </div>
  )
}

/** The writing terminal, or a story-bible entry in its place. */
function MainPane(): JSX.Element {
  const mainView = useWyrm((s) => s.mainView)
  return mainView.kind === 'entity' ? (
    <EntityEditor key={mainView.id} entityId={mainView.id} />
  ) : (
    <Editor />
  )
}

function App(): JSX.Element {
  // Falls back to the defaults for the first paint only; the stored appearance
  // arrives with boot(). Rendering nothing until then would flash an empty
  // window, which is worse than one frame in the default palette.
  const appearance = useWyrm((s) => s.appearance) ?? DEFAULT_APPEARANCE
  const setAppearance = useWyrm((s) => s.setAppearance)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [versionDialog, setVersionDialog] = useState<'commit' | 'history' | 'variants' | null>(null)
  const [compileOpen, setCompileOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const syncConflicts = useWyrm((s) => s.syncConflicts)

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
      } else if ((e.key === 'E' || (e.key === 'e' && e.shiftKey)) && state.project) {
        e.preventDefault()
        setCompileOpen(true)
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
      data-accents={appearance.accents}
      data-palette={appearance.palette}
      data-indent={appearance.firstLineIndent ? 'on' : 'off'}
      style={
        {
          // Geometry rides as inline custom properties so the page reflows
          // live while a stepper is held down (F-06).
          '--measure': `${appearance.measure}ch`,
          '--prose-size': `${appearance.fontSize}px`,
          '--prose-leading': String(appearance.lineHeight)
        } as CSSProperties
      }
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
        onCompile={() => setCompileOpen(true)}
        onBackup={() => setBackupOpen(true)}
        onSyncSettings={() => setSyncOpen(true)}
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
              <ErrorBoundary label="Story bible" onDismiss={() => useWyrm.getState().showDoc()}>
                <MainPane />
              </ErrorBoundary>
              <EntityPanel />
            </div>
            <StatusBar />
          </div>
        ) : (
          booted && <Welcome />
        )}
        {prefsOpen && (
          <PrefsDialog
            appearance={appearance}
            onChange={(patch) => void setAppearance(patch)}
            onClose={() => setPrefsOpen(false)}
          />
        )}
        {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
        {compileOpen && (
          <ErrorBoundary label="Compile" onDismiss={() => setCompileOpen(false)}>
            <CompileDialog onClose={() => setCompileOpen(false)} />
          </ErrorBoundary>
        )}
        {backupOpen && (
          <ErrorBoundary label="Backup" onDismiss={() => setBackupOpen(false)}>
            <BackupDialog onClose={() => setBackupOpen(false)} />
          </ErrorBoundary>
        )}
        {syncOpen && (
          <ErrorBoundary label="Sync" onDismiss={() => setSyncOpen(false)}>
            <SyncDialog onClose={() => setSyncOpen(false)} />
          </ErrorBoundary>
        )}
        {syncConflicts != null && (
          <ErrorBoundary label="Sync" onDismiss={() => useWyrm.getState().dismissConflicts()}>
            <ConflictDialog />
          </ErrorBoundary>
        )}
        {versionDialog !== null && (
          <ErrorBoundary
            label={
              versionDialog === 'commit'
                ? 'Checkpoint'
                : versionDialog === 'history'
                  ? 'History'
                  : 'Variants'
            }
            onDismiss={() => setVersionDialog(null)}
          >
            {versionDialog === 'commit' && <CommitDialog onClose={() => setVersionDialog(null)} />}
            {versionDialog === 'history' && (
              <HistoryDialog onClose={() => setVersionDialog(null)} />
            )}
            {versionDialog === 'variants' && (
              <VariantsDialog onClose={() => setVersionDialog(null)} />
            )}
          </ErrorBoundary>
        )}
      </div>
    </div>
  )
}

export default App
