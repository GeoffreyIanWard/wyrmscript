import type { JSX } from 'react'
import { WyrmIcon } from './icons'
import type { AccentTheme, TerminalTheme } from '../App'

type PrefsDialogProps = {
  accents: AccentTheme
  terminal: TerminalTheme
  onAccents: (value: AccentTheme) => void
  onTerminal: (value: TerminalTheme) => void
  onClose: () => void
}

function Radio({
  label,
  on,
  onPick
}: {
  label: string
  on: boolean
  onPick: () => void
}): JSX.Element {
  return (
    <div className="control-row" onClick={onPick}>
      <span className={`radio${on ? ' on' : ''}`} />
      <span>{label}</span>
    </div>
  )
}

function Check({ label, on }: { label: string; on?: boolean }): JSX.Element {
  return (
    <div className="control-row">
      <span className={`check${on ? ' on' : ''}`} />
      <span>{label}</span>
    </div>
  )
}

export function PrefsDialog({
  accents,
  terminal,
  onAccents,
  onTerminal,
  onClose
}: PrefsDialogProps): JSX.Element {
  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <span className="close-box" onClick={onClose} />
          <span className="title">Preferences</span>
        </div>
        <div className="dialog-body">
          <fieldset className="fieldset">
            <legend>PALETTE</legend>
            <Radio
              label="1-bit black & white"
              on={accents === '1bit'}
              onPick={() => onAccents('1bit')}
            />
            <Radio
              label="4-bit accents (labels & entity links)"
              on={accents === '4bit'}
              onPick={() => onAccents('4bit')}
            />
          </fieldset>
          <fieldset className="fieldset">
            <legend>WRITING TERMINAL</legend>
            <Radio label="Paper" on={terminal === 'paper'} onPick={() => onTerminal('paper')} />
            <Radio
              label="Green phosphor"
              on={terminal === 'green'}
              onPick={() => onTerminal('green')}
            />
            <Radio
              label="Amber phosphor"
              on={terminal === 'amber'}
              onPick={() => onTerminal('amber')}
            />
          </fieldset>
          <fieldset className="fieldset">
            <legend>WRITING</legend>
            <Check label="Typewriter scrolling" on />
            <Check label="WordStar key diamond (Ctrl-S/D/E/X)" />
            <Check label="UI sounds" />
          </fieldset>
        </div>
        <div className="dialog-buttons">
          <button className="btn default" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

export function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <span className="close-box" onClick={onClose} />
          <span className="title">About Wyrmscript</span>
        </div>
        <div className="dialog-body">
          <div className="about-art">
            <WyrmIcon size={48} />
          </div>
          <div className="about-small">
            <div>WYRMSCRIPT 0.1.0</div>
            <div>A retro word processor for novel writing.</div>
            <div>Nothing is ever truly lost.</div>
          </div>
        </div>
        <div className="dialog-buttons">
          <button className="btn default" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
