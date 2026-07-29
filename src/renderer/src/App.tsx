import { useState } from 'react'
import type { JSX } from 'react'
import { MenuBar } from './components/MenuBar'
import { Binder } from './components/Binder'
import { Terminal } from './components/Terminal'
import { EntityPanel } from './components/EntityPanel'
import { AboutDialog, PrefsDialog } from './components/Dialogs'

export type AccentTheme = '1bit' | '4bit'
export type TerminalTheme = 'paper' | 'green' | 'amber'

const isElectronMac = /Macintosh/.test(navigator.userAgent) && /Electron/.test(navigator.userAgent)

function App(): JSX.Element {
  const [accents, setAccents] = useState<AccentTheme>('1bit')
  const [terminal, setTerminal] = useState<TerminalTheme>('paper')
  const [panelOpen, setPanelOpen] = useState(true)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <div
      className={`screen${isElectronMac ? ' is-electron-mac' : ''}`}
      data-accents={accents}
      data-terminal={terminal}
    >
      <MenuBar onAbout={() => setAboutOpen(true)} onPreferences={() => setPrefsOpen(true)} />
      <div className="desktop">
        <div className="mac-window main-window">
          <div className="title-bar">
            <span className="close-box" />
            <span className="title">The Wyrm of Winter</span>
            <span className="zoom-box" />
          </div>
          <div className="window-body">
            <Binder />
            <Terminal onEntityClick={() => setPanelOpen(true)} />
            {panelOpen && <EntityPanel onClose={() => setPanelOpen(false)} />}
          </div>
          <div className="status-bar">
            <span>1,847 WORDS</span>
            <span>DRAFT</span>
            <span className="spacer" />
            <span>COMMITTED 2 MIN AGO</span>
            <span>◆ SYNCED</span>
          </div>
        </div>
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
      </div>
    </div>
  )
}

export default App
