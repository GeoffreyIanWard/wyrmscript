import type { JSX } from 'react'
import { WyrmIcon } from './icons'
import type { AccentTheme, TerminalTheme } from '../App'

type PrefsDialogProps = {
  accents: AccentTheme
  terminal: TerminalTheme
  firstLineIndent: boolean
  onAccents: (value: AccentTheme) => void
  onTerminal: (value: TerminalTheme) => void
  onFirstLineIndent: (value: boolean) => void
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
    <button type="button" role="radio" aria-checked={on} className="control-row" onClick={onPick}>
      <span className={`radio${on ? ' on' : ''}`} />
      <span>{label}</span>
    </button>
  )
}

function Check({
  label,
  on,
  onToggle
}: {
  label: string
  on?: boolean
  /** Omit for settings whose feature does not exist yet — renders inert. */
  onToggle?: (value: boolean) => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!on}
      disabled={!onToggle}
      className="control-row"
      onClick={() => onToggle?.(!on)}
    >
      <span className={`check${on ? ' on' : ''}`} />
      <span>{label}</span>
    </button>
  )
}

export function PrefsDialog({
  accents,
  terminal,
  firstLineIndent,
  onAccents,
  onTerminal,
  onFirstLineIndent,
  onClose
}: PrefsDialogProps): JSX.Element {
  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
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
            <Check
              label="Indent first line of paragraphs"
              on={firstLineIndent}
              onToggle={onFirstLineIndent}
            />
            <Check label="Typewriter scrolling" />
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
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
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
