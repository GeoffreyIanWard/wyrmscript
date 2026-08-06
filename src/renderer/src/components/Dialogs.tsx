import type { JSX } from 'react'
import { useFocusTrap } from '../lib/useFocusTrap'
import { WyrmIcon } from './icons'
import type {
  AppearanceSettings,
  AccentTheme,
  PaletteTheme,
  StatsSettings
} from '../../../shared/types'

const DEFAULT_GEOMETRY = { measure: 62, fontSize: 17, lineHeight: 1.7 } as const

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

/** Rounds to one decimal so repeated 0.1 steps (lineHeight) never drift off
 *  the grid from float error (0.1 + 0.1 + 0.1 !== 0.3). */
function roundToTenth(v: number): number {
  return Math.round(v * 10) / 10
}

/** A labelled +/- row for one F-06 page-geometry number. `name` feeds the
 *  button aria-labels in plain lowercase, distinct from the uppercase
 *  chrome `label` so "Increase line width" reads naturally to a screen
 *  reader without shouting. */
function Stepper({
  label,
  name,
  value,
  min,
  max,
  step,
  format,
  onChange
}: {
  label: string
  name: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}): JSX.Element {
  const clamp = (v: number): number => Math.min(max, Math.max(min, roundToTenth(v)))
  return (
    <div className="control-row">
      <span className="field-name">{label}</span>
      <span className="spacer" />
      <button
        type="button"
        className="btn"
        aria-label={`Decrease ${name}`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
      >
        −
      </button>
      <span>{format(value)}</span>
      <button
        type="button"
        className="btn"
        aria-label={`Increase ${name}`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        +
      </button>
    </div>
  )
}

export function PrefsDialog({
  appearance,
  stats,
  onChange,
  onStatsChange,
  onClose
}: {
  appearance: AppearanceSettings
  stats: StatsSettings
  onChange: (patch: Partial<AppearanceSettings>) => void
  onStatsChange: (patch: Partial<StatsSettings>) => void
  onClose: () => void
}): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const pickPalette = (palette: PaletteTheme): void => onChange({ palette })
  const pickAccents = (accents: AccentTheme): void => onChange({ accents })

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Preferences</span>
        </div>
        <div className="dialog-body">
          <fieldset className="fieldset">
            <legend>PALETTE</legend>
            <Radio
              label="Paper — 1-bit black & white"
              on={appearance.palette === 'paper'}
              onPick={() => pickPalette('paper')}
            />
            <Radio
              label="E-reader — warm grey & deep blue"
              on={appearance.palette === 'ereader'}
              onPick={() => pickPalette('ereader')}
            />
            <Radio
              label="Night — tan & brown, for after dark"
              on={appearance.palette === 'night'}
              onPick={() => pickPalette('night')}
            />
            <Radio
              label="Dark — inverse of the default"
              on={appearance.palette === 'dark'}
              onPick={() => pickPalette('dark')}
            />
            <Radio
              label="Green phosphor (CRT)"
              on={appearance.palette === 'green'}
              onPick={() => pickPalette('green')}
            />
            <Radio
              label="Amber phosphor (CRT)"
              on={appearance.palette === 'amber'}
              onPick={() => pickPalette('amber')}
            />
            <Radio
              label="Vaporwave (CRT) — magenta glow"
              on={appearance.palette === 'vaporwave'}
              onPick={() => pickPalette('vaporwave')}
            />
            <Radio
              label="Virtual Wyrm (CRT) — red glow"
              on={appearance.palette === 'virtualwyrm'}
              onPick={() => pickPalette('virtualwyrm')}
            />
            <Radio
              label="Halftone — newsprint dot screen"
              on={appearance.palette === 'halftone'}
              onPick={() => pickPalette('halftone')}
            />
            <Radio
              label="Ledger — cream stock, rust correction ink"
              on={appearance.palette === 'ledger'}
              onPick={() => pickPalette('ledger')}
            />
            <Radio
              label="Arcade — marquee stripes, hot colour"
              on={appearance.palette === 'arcade'}
              onPick={() => pickPalette('arcade')}
            />
            <Radio
              label="Blueprint — drafting navy & cyan"
              on={appearance.palette === 'blueprint'}
              onPick={() => pickPalette('blueprint')}
            />
            <Radio
              label="BIOS — classic setup-screen blue"
              on={appearance.palette === 'bios'}
              onPick={() => pickPalette('bios')}
            />
            <Radio
              label="Collegiate — hunter green & varsity gold"
              on={appearance.palette === 'collegiate'}
              onPick={() => pickPalette('collegiate')}
            />
            <Radio
              label="Famicom — full-colour NES palette"
              on={appearance.palette === 'famicom'}
              onPick={() => pickPalette('famicom')}
            />
            <Radio
              label="Windows 95 — teal desktop, silver chrome"
              on={appearance.palette === 'win95'}
              onPick={() => pickPalette('win95')}
            />
            <div className="dialog-hint">CRT variants add scanlines and glow.</div>
          </fieldset>
          <fieldset className="fieldset">
            <legend>ACCENTS</legend>
            <Radio
              label="None — pure two-colour"
              on={appearance.accents === '1bit'}
              onPick={() => pickAccents('1bit')}
            />
            <Radio
              label="4-bit accents (labels & entity links)"
              on={appearance.accents === '4bit'}
              onPick={() => pickAccents('4bit')}
            />
            <div className="dialog-hint">
              Accents only tint labels and story-bible links — never the manuscript.
            </div>
          </fieldset>
          <fieldset className="fieldset">
            <legend>THE PAGE</legend>
            <Stepper
              label="LINE WIDTH"
              name="line width"
              value={appearance.measure}
              min={40}
              max={100}
              step={4}
              format={(v) => `${v} characters`}
              onChange={(measure) => onChange({ measure })}
            />
            <Stepper
              label="TEXT SIZE"
              name="text size"
              value={appearance.fontSize}
              min={12}
              max={28}
              step={1}
              format={(v) => `${v} px`}
              onChange={(fontSize) => onChange({ fontSize })}
            />
            <Stepper
              label="LINE SPACING"
              name="line spacing"
              value={appearance.lineHeight}
              min={1.2}
              max={2.4}
              step={0.1}
              format={(v) => v.toFixed(1)}
              onChange={(lineHeight) => onChange({ lineHeight })}
            />
            <div className="control-row" style={{ marginTop: 6 }}>
              <button type="button" className="btn" onClick={() => onChange(DEFAULT_GEOMETRY)}>
                Reset to defaults
              </button>
            </div>
          </fieldset>
          <fieldset className="fieldset">
            <legend>WRITING STATS</legend>
            <Check
              label="Show word counts while writing"
              on={stats.showCounter}
              onToggle={(showCounter) => onStatsChange({ showCounter })}
            />
            <Stepper
              label="DAILY GOAL"
              name="daily goal"
              value={stats.dailyGoal}
              min={0}
              max={5000}
              step={100}
              format={(v) => (v === 0 ? 'no goal' : `${v.toLocaleString()} words`)}
              onChange={(dailyGoal) => onStatsChange({ dailyGoal })}
            />
            <Radio
              label="Net — today's total minus yesterday's"
              on={stats.mode === 'net'}
              onPick={() => onStatsChange({ mode: 'net' })}
            />
            <Radio
              label="Added — count words written, ignore cuts"
              on={stats.mode === 'added'}
              onPick={() => onStatsChange({ mode: 'added' })}
            />
            <Radio
              label="Net, never below zero"
              on={stats.mode === 'net-positive'}
              onPick={() => onStatsChange({ mode: 'net-positive' })}
            />
            <div className="dialog-hint">
              Counts come from your checkpoint history, so they survive a reinstall and follow the
              project. A day spent cutting reads as a loss under Net — that is the honest number,
              and your streak counts it as work either way.
            </div>
          </fieldset>
          <fieldset className="fieldset">
            <legend>WRITING</legend>
            <Check
              label="Indent first line of paragraphs"
              on={appearance.firstLineIndent}
              onToggle={(firstLineIndent) => onChange({ firstLineIndent })}
            />
            <Check label="Typewriter scrolling" />
            <Check label="WordStar key diamond (Ctrl-S/D/E/X)" />
            <Check label="UI sounds" />
          </fieldset>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="btn default" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">About WyrmStar</span>
        </div>
        <div className="dialog-body">
          <div className="about-art">
            <WyrmIcon size={48} />
          </div>
          <div className="about-small">
            <div>WYRMSTAR 0.1.0</div>
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
