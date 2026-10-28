import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { BinderNode, Scrap } from '../../../shared/types'
import { docToMarkdown, markdownToDoc } from '../lib/markdown'
import { proseExtensions } from '../lib/proseKit'
import { padOrder, scrapOrigin, scrapSource, scrapWhen } from '../lib/scratchPad'
import { errorMessage } from '../lib/errors'
import { useWyrm } from '../store'

/** Typing settles this long before a scrap is written. */
const SCRAP_SAVE_MS = 600

/** Stored bodies end in a newline; the editor's Markdown may not. */
const same = (a: string, b: string): boolean => a.replace(/\n+$/, '') === b.replace(/\n+$/, '')

/**
 * F-51: the scratch pad — text the writer couldn't bear to lose and doesn't
 * want in the book. Scraps arrive by Move to Scratch Pad (⇧⌘X) and, later,
 * from the cards a merge leaves over; a note can be written here directly.
 *
 * A detour, like the stats page: the usual reason to come here is to copy
 * something back onto the page, so Esc returns to exactly what was there.
 * Every scrap is a small editor with the page's own prose kit, so copying
 * from it keeps bold, italic and highlight. Nothing here is ever part of
 * the book: Compile, the counts and the corkboard never read the pad.
 */
export function ScratchPad(): JSX.Element | null {
  const project = useWyrm((s) => s.project)
  const scraps = useWyrm((s) => s.scraps)
  const mainView = useWyrm((s) => s.mainView)
  /** A New Note not yet written in: dropped again if left empty. */
  const [fresh, setFresh] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const newNoteRef = useRef<HTMLButtonElement>(null)

  if (!project) return null
  const path = project.path
  const binder = project.data.binder
  const searched = mainView.kind === 'scratch' ? mainView.focus : undefined

  const newNote = (): void => {
    setError(null)
    // One empty note at a time: pressing again goes back to it.
    if (fresh != null && scraps.some((s) => s.id === fresh)) {
      document.querySelector<HTMLElement>(`[data-scrap="${fresh}"] .scrap-text`)?.focus()
      return
    }
    void useWyrm
      .getState()
      .addScrapAt(path, { body: '' })
      .then((scrap) => setFresh(scrap.id))
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  const back = (): void => {
    if (!useWyrm.getState().goBack()) useWyrm.getState().showDoc()
  }

  return (
    <div className="terminal scratch-pad" data-help="scratch-pad-view">
      <div className="entity-main-bar">
        <button type="button" className="btn small" onClick={back}>
          ‹ Back
        </button>
        <span className="entity-kind">SCRATCH</span>
        <span className="row-title">Scratch Pad</span>
        <span className="spacer" />
        <button
          ref={newNoteRef}
          type="button"
          className="btn small"
          data-help="scratch-new-note"
          onClick={newNote}
        >
          New Note
        </button>
      </div>
      <div className="entity-main-body scratch-body">
        <div className="dialog-hint scratch-hint">
          Never part of the book. Copy anything back onto the page.
        </div>
        {error != null && (
          <div className="error-text" role="alert">
            {error}
          </div>
        )}
        <div className="scratch-sheets">
          {scraps.length === 0 ? (
            <div className="scratch-empty">
              Nothing on the pad yet. Select a passage and choose Edit → Move to Scratch Pad (⇧⌘X)
              to keep it here instead of deleting it, or write a note with New Note.
            </div>
          ) : (
            padOrder(scraps).map((scrap) => (
              <ScrapSheet
                // By project too: a clone shares the original's ids, and a sheet
                // kept across a change of novel would write into the other one.
                key={`${path}:${scrap.id}`}
                scrap={scrap}
                path={path}
                binder={binder}
                fresh={scrap.id === fresh}
                focusNow={scrap.id === fresh || scrap.id === searched}
                onFocused={() => {
                  if (scrap.id === searched) useWyrm.getState().settleScratchFocus()
                }}
                onGone={(holdsFocus) => {
                  if (scrap.id === fresh) setFresh(null)
                  if (holdsFocus) newNoteRef.current?.focus()
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function ScrapSheet({
  scrap,
  path,
  binder,
  fresh,
  focusNow,
  onFocused,
  onGone
}: {
  scrap: Scrap
  path: string
  binder: BinderNode[]
  /** Made by New Note and not yet written in. */
  fresh: boolean
  /** Put the caret here on mount: a new note, or a search hit. */
  focusNow: boolean
  onFocused: () => void
  /** It is about to leave the pad. `holdsFocus` when focus is inside it and
   *  would go with it (Throw Away); a blur already has somewhere to go. */
  onGone: (holdsFocus: boolean) => void
}): JSX.Element {
  const selectDoc = useWyrm((s) => s.selectDoc)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The editor's text as Markdown, kept on every keystroke so a save never
  // needs the editor (which may already be destroyed on unmount).
  const latest = useRef(scrap.body)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const freshRef = useRef(fresh)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    freshRef.current = fresh
  }, [fresh])

  // The sheet is keyed by project and scrap, so `path` and `scrap.id` never
  // change under it: the editor's callbacks, made once, can keep this one.
  const save = (): Promise<void> => {
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = null
    return useWyrm
      .getState()
      .updateScrapAt(path, scrap.id, latest.current)
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  const editor = useEditor(
    {
      content: markdownToDoc(scrap.body),
      extensions: proseExtensions(),
      editorProps: {
        attributes: { class: 'scrap-text', 'aria-label': scrapOrigin(scrap) }
      },
      onUpdate: ({ editor }) => {
        latest.current = docToMarkdown(editor.getJSON())
        if (latest.current.trim() !== '') freshRef.current = false
        if (timer.current != null) clearTimeout(timer.current)
        timer.current = setTimeout(() => void save(), SCRAP_SAVE_MS)
      },
      onBlur: () => {
        // A New Note left without a word in it was never anything — but not
        // when the window itself lost focus: the writer is coming back.
        if (freshRef.current && latest.current.trim() === '' && document.hasFocus()) {
          // Focus is on its way to wherever the writer clicked; leave it there.
          onGone(false)
          void useWyrm.getState().discardEmptyScrapAt(path, scrap.id)
          return
        }
        void save()
      }
    },
    [scrap.id]
  )

  // Whatever is still waiting is written as the sheet goes — leaving the
  // pad, or another novel coming forward — to the project it was typed in.
  useEffect(
    () => () => {
      if (timer.current != null) void save()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on unmount only
    []
  )

  // A scrap changed under the pad (a sync brought the other computer's
  // version) shows that version, unless the writer is typing in it.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return
    if (same(latest.current, scrap.body)) return
    latest.current = scrap.body
    editor.commands.setContent(markdownToDoc(scrap.body), { emitUpdate: false })
  }, [editor, scrap.body])

  useEffect(() => {
    if (!focusNow || !editor || editor.isDestroyed) return
    sheetRef.current?.scrollIntoView?.({ block: 'center' })
    editor.commands.focus('end')
    onFocused()
    // Once, as the sheet arrives or the search lands on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNow, editor])

  const throwAway = (): void => {
    setError(null)
    void save()
      .then(() => {
        onGone(true)
        return useWyrm.getState().throwAwayScrapAt(path, scrap.id)
      })
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  const source = scrapSource(scrap, binder)

  return (
    <div className="scrap-sheet" data-scrap={scrap.id} ref={sheetRef}>
      <div className="scrap-head">
        <span>{scrapOrigin(scrap)}</span>
        <span>{scrapWhen(scrap)}</span>
      </div>
      <EditorContent editor={editor} />
      {error != null && (
        <div className="error-text" role="alert">
          {error}
        </div>
      )}
      <div className="scrap-foot">
        {confirming ? (
          <span className="scrap-confirm" role="group" aria-label="Throw this away?">
            <span>Throw this away? It stays in the project’s history.</span>
            <button type="button" className="btn small" onClick={throwAway}>
              Throw Away
            </button>
            <button type="button" className="btn small" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        ) : (
          <>
            {source != null && (
              <button
                type="button"
                className="btn small"
                data-help="scratch-go-to"
                onClick={() => void selectDoc(source)}
              >
                Go to {scrap.fromTitle ? `“${scrap.fromTitle}”` : 'the chapter'}
              </button>
            )}
            <button
              type="button"
              className="btn small"
              data-help="scratch-throw-away"
              onClick={() => setConfirming(true)}
            >
              Throw Away…
            </button>
          </>
        )}
      </div>
    </div>
  )
}
