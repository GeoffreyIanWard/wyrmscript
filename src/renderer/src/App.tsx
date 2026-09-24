import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import { MenuBar } from './components/MenuBar'
import { Binder } from './components/Binder'
import { Editor } from './components/Editor'
import { EntityPanel } from './components/EntityPanel'
import { EntityEditor } from './components/EntityEditor'
import { FolderView } from './components/FolderView'
import { Welcome } from './components/Welcome'
import { AboutDialog, PrefsDialog } from './components/Dialogs'
import { StatsPage } from './components/StatsPage'
import { TagBrowser } from './components/TagBrowser'
import { TimelineDialog } from './components/TimelineDialog'
import { PlotGraphDialog } from './components/PlotGraphDialog'
import { PlotlinesDialog } from './components/PlotlinesDialog'
import { CharacterGraphDialog } from './components/CharacterGraphDialog'
import { WorldMapDialog } from './components/WorldMapDialog'
import { CommitDialog, HistoryDialog, VariantsDialog } from './components/VersionDialogs'
import { CompileDialog } from './components/CompileDialog'
import { isConnected, isRemoteMissing } from './lib/syncState'
import { BackupDialog } from './components/BackupDialog'
import { SyncDialog } from './components/SyncDialog'
import { ConflictDialog } from './components/ConflictDialog'
import { CommandPalette } from './components/CommandPalette'
import { SearchDialog } from './components/SearchDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useWyrm } from './store'
import { api, isElectron } from './lib/api'
import { summarize } from './lib/stats'
import { errorMessage } from './lib/errors'
import { DEFAULT_COMPILE_OPTIONS } from './lib/compile'

import { DEFAULT_APPEARANCE } from '../../shared/types'
import type { PrinterInfo } from '../../shared/types'

const isElectronMac = /Macintosh/.test(navigator.userAgent) && /Electron/.test(navigator.userAgent)
/** F-39: Windows Electron gets a hidden title bar plus a native caption-button
 *  overlay, so the menu bar needs clearance on the right the way the macOS
 *  build already needs it on the left for the traffic lights. */
const isElectronWin = /Windows/.test(navigator.userAgent) && /Electron/.test(navigator.userAgent)

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
  // Select the stable slices and derive during render — a selector returning a
  // fresh object re-renders forever (house rule).
  const dailyStats = useWyrm((s) => s.dailyStats)
  const statsSettings = useWyrm((s) => s.statsSettings)
  const now = useNow(30000)

  const today = statsSettings ? summarize(dailyStats, statsSettings) : null

  const saveLabel = saveState === 'saved' ? 'SAVED' : saveState === 'saving' ? 'SAVING…' : 'EDITED'
  // States what is true, and stays quiet otherwise — neither an unbacked-up
  // nor a local-only project is nagged at from the status bar (F-01).
  //
  // `isConnected` rather than `mode === 'github'`: a project whose remote has
  // gone from .git/config used to report ◆ SYNCED while having nowhere to push,
  // which is the one lie this bar must never tell. It now reads as needing
  // attention, which is what it is.
  const placeLabel = !isElectron
    ? '◇ DEMO — IN MEMORY'
    : isConnected(syncStatus)
      ? syncNeedsAttention
        ? '◆ SYNC — NEEDS YOUR EYE'
        : syncStatus?.pendingSync
          ? '◆ SYNC — WAITING'
          : '◆ SYNCED'
      : isRemoteMissing(syncStatus)
        ? '◆ SYNC — NEEDS YOUR EYE'
        : backupSettings?.targets.length
          ? '◆ LOCAL + BACKUP'
          : '◆ LOCAL'
  // One switch covers every ambient counter (here and in the editor header):
  // a writer who does not want to watch a number climb does not want it in
  // two places. Writing Stats still answers on demand.
  const showCounter = statsSettings?.showCounter ?? true

  return (
    <div className="status-bar">
      {showCounter && <span>{wordCount.toLocaleString()} WORDS</span>}
      {activeDoc?.meta.status && <span>{activeDoc.meta.status.toUpperCase()}</span>}
      <span>{saveLabel}</span>
      {showCounter && today && (
        <span
          className={today.goalMet ? 'stat-goal met' : 'stat-goal'}
          title="Words today, from your checkpoint history"
        >
          {/* A sign only when it means something: an unadorned "340" reads as
              progress, "−340" as a day of cutting. */}
          {today.today > 0 ? '+' : ''}
          {today.today.toLocaleString()} TODAY
          {statsSettings && statsSettings.dailyGoal > 0 && ` / ${statsSettings.dailyGoal}`}
          {today.goalMet && ' ★'}
        </span>
      )}
      <span className="spacer" />
      <span>{agoLabel(lastCommitAt, now)}</span>
      <span title={syncStatus?.remoteUrl ?? backupSettings?.targets[0]?.path ?? project?.path}>
        {placeLabel}
      </span>
    </div>
  )
}

/** The writing terminal, or a bible entry or folder listing in its place. */
function MainPane(): JSX.Element {
  const mainView = useWyrm((s) => s.mainView)
  if (mainView.kind === 'entity') return <EntityEditor key={mainView.id} entityId={mainView.id} />
  if (mainView.kind === 'folder') return <FolderView key={mainView.id} folderId={mainView.id} />
  if (mainView.kind === 'stats') return <StatsPage />
  if (mainView.kind === 'tags') return <TagBrowser />
  return <Editor />
}

function App(): JSX.Element {
  // Falls back to the defaults for the first paint only; the stored appearance
  // arrives with boot(). Rendering nothing until then would flash an empty
  // window, which is worse than one frame in the default palette.
  const appearance = useWyrm((s) => s.appearance) ?? DEFAULT_APPEARANCE
  const setAppearance = useWyrm((s) => s.setAppearance)
  const screenRef = useRef<HTMLDivElement>(null)
  const typewriterMode = useWyrm((s) => s.typewriterMode)
  const printSettings = useWyrm((s) => s.printSettings)
  // F-38: fetched when Preferences opens rather than at boot — the printer
  // list is an OS query whose answer changes while the app runs (a printer
  // added, a laptop leaving a network), and nothing outside this dialog
  // needs it.
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const statsSettings = useWyrm((s) => s.statsSettings)
  const setStatsSettings = useWyrm((s) => s.setStatsSettings)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [plotGraphOpen, setPlotGraphOpen] = useState(false)
  const [plotlinesOpen, setPlotlinesOpen] = useState(false)
  const [characterGraphOpen, setCharacterGraphOpen] = useState(false)
  const [worldMapOpen, setWorldMapOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [versionDialog, setVersionDialog] = useState<'commit' | 'history' | 'variants' | null>(null)
  const [compileOpen, setCompileOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  /** F-38: printing happens without a dialog, so a failure needs somewhere
   *  to land — silence would read as "nothing happened". */
  const [printError, setPrintError] = useState<string | null>(null)
  // Distraction-free writing (F-09): binder, side panel and status bar hide;
  // the page keeps its own measure and centres in the space that's left.
  // Deliberately not persisted — a fresh launch always starts in the normal
  // view.
  const [focusMode, setFocusMode] = useState(false)
  // Set by MenuBar so ⌥F / F10 can move focus into the bar without App
  // reaching into its DOM (F-07).
  const focusMenusRef = useRef<(() => void) | null>(null)
  const syncConflicts = useWyrm((s) => s.syncConflicts)

  const project = useWyrm((s) => s.project)
  const booted = useWyrm((s) => s.booted)
  const boot = useWyrm((s) => s.boot)

  useEffect(() => {
    void boot()
  }, [boot])

  // F-38. Uses the compile dialog's defaults rather than opening it first:
  // "print the manuscript" is a single intent, and anyone wanting to choose
  // scenes or separators is already reaching for Compile Manuscript instead.
  const runPrint = (): void => {
    void useWyrm
      .getState()
      .printManuscript(DEFAULT_COMPILE_OPTIONS)
      .catch((err) => setPrintError(errorMessage(err)))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Enter the menu bar. Checked by e.code (the physical key), not e.key:
      // macOS remaps Option+letter to an accented/special character at the
      // .key layer — Option+F reports as 'ƒ', never 'f' — so an e.key check
      // here silently never fires. F10 stays too, for the Windows convention
      // and because it needs no modifier at all, but it needs Fn on most Mac
      // keyboards, which was the actual complaint (F-07).
      if (e.key === 'F10' || (e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyF')) {
        e.preventDefault()
        focusMenusRef.current?.()
        return
      }
      // F11 — real OS fullscreen (F-39), the only thing that covers the
      // Windows taskbar; maximize never does. Deliberately left alone outside
      // Electron: the browser's own F11 already does this, and swallowing it
      // would take a working shortcut away in the preview.
      if (e.key === 'F11' && isElectron) {
        e.preventDefault()
        void api.toggleFullScreen()
        return
      }
      // Esc, in priority order (F-14, then F-36): a dialog wins first —
      // `useFocusTrap` stops propagation for Esc, so a dialog with focus
      // inside never reaches this handler, but focus can go loose (a click
      // on the overlay's own backdrop), so the open-dialog check is a real
      // guard rather than a belt-and-braces one. Every dialog in the app
      // renders `.dialog-overlay`, which makes this one query cover all of
      // them — including any added later — instead of a list of booleans
      // that would silently fall out of date. Next, unwind one story-bible
      // detour. Only once neither applies does Esc exit Focus Mode — last in
      // the chain, so a writer deep in a bible detour inside Focus Mode
      // steps back through their trail before the mode itself closes,
      // rather than Esc changing what's on screen twice in one keypress.
      if (e.key === 'Escape') {
        if (document.querySelector('.dialog-overlay')) return
        if (useWyrm.getState().goBack()) {
          e.preventDefault()
          return
        }
        if (focusMode) {
          e.preventDefault()
          setFocusMode(false)
        }
        return
      }
      if (!(e.metaKey || e.ctrlKey)) return
      const state = useWyrm.getState()
      if (e.key === 's' && !e.shiftKey) {
        e.preventDefault()
        if (state.project) {
          void state.flushSave().then(() => setVersionDialog('commit'))
        }
      } else if ((e.key === 'S' || (e.key === 's' && e.shiftKey)) && state.project) {
        // ⇧⌘S — Writing Stats page (F-26).
        e.preventDefault()
        state.showStats()
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
      } else if (e.key === 'p' && !e.shiftKey && !e.altKey && state.project) {
        // ⌘P — print (F-38). Overrides the browser's own print in the
        // preview deliberately: printing the app's chrome is never what a
        // writer means here.
        e.preventDefault()
        runPrint()
      } else if (e.key === 'k' && !e.altKey && state.project) {
        e.preventDefault()
        setPaletteOpen(true)
      } else if ((e.key === 'F' || (e.key === 'f' && e.shiftKey)) && !e.altKey && state.project) {
        e.preventDefault()
        setSearchOpen(true)
      } else if (e.altKey && e.metaKey && !e.shiftKey && e.code === 'KeyF' && state.project) {
        // ⌥⌘F — Focus mode (F-09). Same e.code reasoning as the menu-bar
        // entry above: Option remaps e.key, so this must not check 'f'.
        e.preventDefault()
        setFocusMode((v) => !v)
      } else if (e.altKey && e.metaKey && !e.shiftKey && e.code === 'KeyT' && state.project) {
        // ⌥⌘T — Typewriter scrolling (F-37). Same e.code reasoning as ⌥⌘F.
        e.preventDefault()
        state.setTypewriterMode(!state.typewriterMode)
      } else if (e.key === ',') {
        e.preventDefault()
        setPrefsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // focusMode must be a real dependency, not read via a stale closure —
    // this effect only ever ran once before, so Esc always saw the Focus
    // Mode value from first mount (false) no matter how many times it was
    // actually toggled since (F-36).
  }, [focusMode])

  // F-39, Windows: keep the native caption buttons in the palette's colours.
  // The values are read back out of the live DOM rather than mapped in TS,
  // so `retro.css` stays the only place a palette's ink/paper is defined —
  // a second copy here would silently drift the first time a palette is
  // retuned. Runs after paint, so `data-palette` is already applied.
  useEffect(() => {
    if (!prefsOpen) return
    let live = true
    void api.listPrinters().then((list) => live && setPrinters(list))
    return () => {
      live = false
    }
  }, [prefsOpen])

  useEffect(() => {
    if (!isElectronWin || !screenRef.current) return
    const styles = getComputedStyle(screenRef.current)
    const paper = styles.getPropertyValue('--paper').trim()
    const ink = styles.getPropertyValue('--ink').trim()
    if (paper && ink) void api.setTitleBarOverlay(paper, ink)
  }, [appearance.palette, appearance.accents])

  return (
    <div
      ref={screenRef}
      className={`screen${isElectronMac ? ' is-electron-mac' : ''}${
        isElectronWin ? ' is-electron-win' : ''
      }`}
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
        onPrint={runPrint}
        onBackup={() => setBackupOpen(true)}
        onStats={() => useWyrm.getState().showStats()}
        onBrowseTags={() => useWyrm.getState().showTags()}
        onTimeline={() => setTimelineOpen(true)}
        onPlotGraph={() => setPlotGraphOpen(true)}
        onPlotlines={() => setPlotlinesOpen(true)}
        onCharacterGraph={() => setCharacterGraphOpen(true)}
        onWorldMap={() => setWorldMapOpen(true)}
        onSyncSettings={() => setSyncOpen(true)}
        onSearch={() => setSearchOpen(true)}
        onPalette={() => setPaletteOpen(true)}
        focusMode={focusMode}
        onFocusMode={() => setFocusMode((v) => !v)}
        onFullScreen={() => void api.toggleFullScreen()}
        registerFocusMenus={(focus) => {
          focusMenusRef.current = focus
        }}
      />
      <div className="desktop">
        {project ? (
          <div className="mac-window main-window">
            <div className="title-bar">
              <button
                type="button"
                aria-label="Close Project"
                className="close-box"
                onClick={() => void useWyrm.getState().closeProject()}
              />
              <span className="title">{project.data.title}</span>
              {/* The zoom box is the period-correct glyph for "fill the
                  screen" — reusing it beats inventing a modern expand icon. */}
              <button
                type="button"
                className="zoom-box"
                aria-label={focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'}
                aria-pressed={focusMode}
                onClick={() => setFocusMode((v) => !v)}
              />
            </div>
            <div className="window-body">
              {!focusMode && <Binder />}
              <ErrorBoundary label="Story bible" onDismiss={() => useWyrm.getState().showDoc()}>
                <MainPane />
              </ErrorBoundary>
              {!focusMode && <EntityPanel />}
            </div>
            {!focusMode && <StatusBar />}
          </div>
        ) : (
          booted && <Welcome />
        )}
        {prefsOpen && statsSettings && (
          <PrefsDialog
            appearance={appearance}
            stats={statsSettings}
            typewriterMode={typewriterMode}
            print={printSettings}
            printers={printers}
            onPrintChange={(patch) => void useWyrm.getState().setPrintSettings(patch)}
            onChange={(patch) => void setAppearance(patch)}
            onStatsChange={(patch) => void setStatsSettings(patch)}
            onTypewriterModeChange={(enabled) => useWyrm.getState().setTypewriterMode(enabled)}
            onClose={() => setPrefsOpen(false)}
          />
        )}
        {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
        {printError !== null && (
          <div className="dialog-overlay" onMouseDown={() => setPrintError(null)}>
            <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
              <div className="title-bar">
                <button
                  type="button"
                  aria-label="Close"
                  className="close-box"
                  onClick={() => setPrintError(null)}
                />
                <span className="title">Print</span>
              </div>
              <div className="dialog-body">
                <div className="error-text">{printError}</div>
              </div>
              <div className="dialog-buttons">
                <button type="button" className="btn default" onClick={() => setPrintError(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        {timelineOpen && (
          <ErrorBoundary label="Timeline" onDismiss={() => setTimelineOpen(false)}>
            <TimelineDialog onClose={() => setTimelineOpen(false)} />
          </ErrorBoundary>
        )}
        {plotGraphOpen && (
          <ErrorBoundary label="Plot graph" onDismiss={() => setPlotGraphOpen(false)}>
            <PlotGraphDialog onClose={() => setPlotGraphOpen(false)} />
          </ErrorBoundary>
        )}
        {plotlinesOpen && (
          <ErrorBoundary label="Plotlines" onDismiss={() => setPlotlinesOpen(false)}>
            <PlotlinesDialog onClose={() => setPlotlinesOpen(false)} />
          </ErrorBoundary>
        )}
        {characterGraphOpen && (
          <ErrorBoundary label="Character graph" onDismiss={() => setCharacterGraphOpen(false)}>
            <CharacterGraphDialog onClose={() => setCharacterGraphOpen(false)} />
          </ErrorBoundary>
        )}
        {worldMapOpen && (
          <ErrorBoundary label="World map" onDismiss={() => setWorldMapOpen(false)}>
            <WorldMapDialog onClose={() => setWorldMapOpen(false)} />
          </ErrorBoundary>
        )}
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
            <SyncDialog
              onClose={() => setSyncOpen(false)}
              // Hands the writer straight to Backup from the local-only panel,
              // rather than naming a menu item and leaving them to find it.
              onOpenBackup={() => {
                setSyncOpen(false)
                setBackupOpen(true)
              }}
            />
          </ErrorBoundary>
        )}
        {paletteOpen && (
          <ErrorBoundary label="Go To" onDismiss={() => setPaletteOpen(false)}>
            <CommandPalette
              onClose={() => setPaletteOpen(false)}
              actions={[
                {
                  id: 'compile',
                  title: 'Compile Manuscript…',
                  subtitle: 'File',
                  run: () => setCompileOpen(true)
                },
                {
                  id: 'search',
                  title: 'Find in Project…',
                  subtitle: 'Project',
                  run: () => setSearchOpen(true)
                },
                {
                  id: 'timeline',
                  title: 'Timeline…',
                  subtitle: 'Project',
                  run: () => setTimelineOpen(true)
                },
                {
                  id: 'plot-graph',
                  title: 'Plot Graph…',
                  subtitle: 'Project',
                  run: () => setPlotGraphOpen(true)
                },
                {
                  id: 'plotlines',
                  title: 'Plotlines…',
                  subtitle: 'Project',
                  run: () => setPlotlinesOpen(true)
                },
                {
                  id: 'character-graph',
                  title: 'Character Graph…',
                  subtitle: 'Project',
                  run: () => setCharacterGraphOpen(true)
                },
                {
                  id: 'world-map',
                  title: 'World Map…',
                  subtitle: 'Project',
                  run: () => setWorldMapOpen(true)
                },
                {
                  id: 'checkpoint',
                  title: 'Commit Checkpoint…',
                  subtitle: 'File',
                  run: () => setVersionDialog('commit')
                },
                {
                  id: 'history',
                  title: 'History',
                  subtitle: 'File',
                  run: () => setVersionDialog('history')
                },
                {
                  id: 'backup',
                  title: 'Backup…',
                  subtitle: 'Project',
                  run: () => setBackupOpen(true)
                },
                {
                  id: 'sync',
                  title: 'Sync Settings…',
                  subtitle: 'Project',
                  run: () => setSyncOpen(true)
                },
                {
                  id: 'prefs',
                  title: 'Preferences…',
                  subtitle: 'WyrmStar',
                  run: () => setPrefsOpen(true)
                },
                {
                  id: 'new-doc',
                  title: 'New Document',
                  subtitle: 'File',
                  run: () => void useWyrm.getState().addDoc(null)
                },
                {
                  id: 'new-folder',
                  title: 'New Folder',
                  subtitle: 'File',
                  run: () => void useWyrm.getState().addFolder(null)
                }
              ]}
            />
          </ErrorBoundary>
        )}
        {searchOpen && (
          <ErrorBoundary label="Find in Project" onDismiss={() => setSearchOpen(false)}>
            <SearchDialog onClose={() => setSearchOpen(false)} />
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
