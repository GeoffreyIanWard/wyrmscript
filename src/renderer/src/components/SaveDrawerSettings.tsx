import { useState } from 'react'
import type { JSX } from 'react'
import type { SaveSettingsPatch } from '../../../shared/types'
import { DEFAULT_SAVE_EVERY, SAVE_EVERY_CHOICES } from '../../../shared/types'
import { errorMessage } from '../lib/errors'
import { isConnected } from '../lib/syncState'
import { useWyrm } from '../store'

function Check({
  label,
  on,
  disabled,
  onToggle
}: {
  label: string
  on: boolean
  disabled?: boolean
  onToggle: (value: boolean) => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      className="control-row"
      onClick={() => onToggle(!on)}
    >
      <span className={`check${on ? ' on' : ''}`} />
      <span>{label}</span>
    </button>
  )
}

/**
 * F-50 step 3: saving on its own — how often a save point is made while the
 * writer works, and whether each one is copied to the drives and sent to
 * GitHub. Per project, like the locations themselves. Save Now on the Save
 * to tab always goes everywhere, whatever is set here.
 */
export function SaveDrawerSettings(): JSX.Element {
  const backupSettings = useWyrm((s) => s.backupSettings)
  const syncStatus = useWyrm((s) => s.syncStatus)
  const [error, setError] = useState<string | null>(null)

  if (backupSettings == null) {
    return <div className="drawer-hint drawer-paper">Reading settings…</div>
  }

  const every = backupSettings.everyMinutes ?? DEFAULT_SAVE_EVERY
  const hasDrives = backupSettings.targets.length > 0
  const hasGithub = isConnected(syncStatus)

  const change = (patch: SaveSettingsPatch): void => {
    setError(null)
    void useWyrm
      .getState()
      .setSaveSettings(patch)
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  return (
    <fieldset className="fieldset drawer-paper drawer-wide">
      <legend>SAVING ON ITS OWN</legend>
      {error != null && (
        <div className="error-text" role="alert">
          {error}
        </div>
      )}
      <label className="control-row">
        <span>Make a save point every</span>
        <select
          className="text-field drawer-select"
          aria-label="Minutes between save points"
          value={every}
          onChange={(e) => change({ everyMinutes: Number(e.target.value) })}
        >
          {SAVE_EVERY_CHOICES.map((m) => (
            <option key={m} value={m}>
              {m === 1 ? '1 minute' : `${m} minutes`}
            </option>
          ))}
        </select>
        <span>while you write.</span>
      </label>
      <Check
        label="Copy each save point to your drives and cards"
        on={backupSettings.auto}
        onToggle={(auto) => change({ auto })}
      />
      {!hasDrives && (
        <div className="dialog-hint" style={{ marginTop: 0 }}>
          There is no drive or card yet. Add one on the Save to tab.
        </div>
      )}
      {hasGithub && (
        <Check
          label="Send each save point to GitHub"
          on={backupSettings.sendToGithub !== false}
          onToggle={(sendToGithub) => change({ sendToGithub })}
        />
      )}
      <div className="dialog-hint">
        Create Save Point (⌘S) follows these too. Save Now, on the Save to tab, always saves
        everywhere.
      </div>
    </fieldset>
  )
}
