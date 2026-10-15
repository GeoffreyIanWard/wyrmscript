import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useWyrm } from '../store'
import { HELP_TOPICS, tipPosition } from '../lib/help'

/**
 * Guided help (F-44): with the mode on, hovering a marked control explains it.
 *
 * Listens on `document` and finds the nearest `[data-help]` ancestor of
 * whatever the pointer is over, rather than every marked control wiring up
 * its own handlers. That keeps the feature in one file, and means marking a
 * new control is an attribute and a line of copy — nothing in the control
 * itself has to know this exists.
 *
 * **Clicks on a marked control are swallowed while the mode is on.** Someone
 * asking what a thing does has not asked to do it, and some of the marked
 * controls delete, compile or minimise. The cost is that the mode has to be
 * dismissed deliberately — Esc, or the button that turned it on — which is
 * also what stops it being a mode you end up in by accident and cannot leave.
 */
export function HelpLayer(): JSX.Element | null {
  const helpMode = useWyrm((s) => s.helpMode)
  const setHelpMode = useWyrm((s) => s.setHelpMode)
  const [at, setAt] = useState<{ id: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!helpMode) return

    const onMove = (e: MouseEvent): void => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-help]')
      const id = el?.getAttribute('data-help')
      if (!el || !id || !HELP_TOPICS[id]) {
        setAt(null)
        return
      }
      const box = el.getBoundingClientRect()
      const { x, y } = tipPosition(
        { left: box.left, top: box.top, width: box.width, height: box.height },
        { x: e.clientX, y: e.clientY },
        { width: window.innerWidth, height: window.innerHeight }
      )
      setAt({ id, x, y })
    }

    // Capture phase, so the control never sees the click at all.
    const onClick = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-help]')) return
      e.preventDefault()
      e.stopPropagation()
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // Stopped as well as handled: Esc is also "back" and "close the
      // dialog", and leaving a help mode should not also walk the writer
      // out of wherever they were reading about.
      e.preventDefault()
      e.stopPropagation()
      setHelpMode(false)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
      // Cleared on the way out rather than in the effect body — clearing
      // there is a synchronous setState that can cascade renders. This runs
      // exactly when the mode turns off, which is when the last explanation
      // stops being wanted; leaving it would flash the previous control's
      // tip the next time help is switched on.
      setAt(null)
    }
  }, [helpMode, setHelpMode])

  if (!helpMode) return null
  const topic = at ? HELP_TOPICS[at.id] : null

  return (
    <>
      <div className="help-banner" role="status">
        Hover anything to find out what it does. Esc to stop.
      </div>
      {topic && at && (
        <div className="help-tip" role="tooltip" style={{ left: at.x, top: at.y }}>
          <div className="help-tip-title">{topic.title}</div>
          <div className="help-tip-body">{topic.body}</div>
        </div>
      )}
    </>
  )
}
