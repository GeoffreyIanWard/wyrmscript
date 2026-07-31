import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { BinderNode, CompileFormat, CompileOptions, DocFile } from '../../../shared/types'
import { DEFAULT_COMPILE_OPTIONS, allDocIds, compile } from '../lib/compile'
import { errorMessage } from '../lib/errors'
import { useWyrm } from '../store'
import { useFocusTrap } from '../lib/useFocusTrap'

/** Longest preview we render — a whole novel in one <pre> would crawl. */
const PREVIEW_LIMIT = 8000

const FORMATS: { value: CompileFormat; label: string }[] = [
  { value: 'txt', label: 'Plain text (.txt)' },
  { value: 'md', label: 'Markdown (.md)' },
  { value: 'docx', label: 'Word (.docx)' }
]

type SeparatorMode = 'hash' | 'stars' | 'blank' | 'custom'

const SEPARATORS: { mode: SeparatorMode; label: string; text: string }[] = [
  { mode: 'hash', label: 'Hash  #', text: '#' },
  { mode: 'stars', label: 'Asterisks  * * *', text: '* * *' },
  { mode: 'blank', label: 'Blank line', text: '' }
]

function docIdsUnder(node: BinderNode): string[] {
  return node.type === 'doc' ? [node.id] : (node.children ?? []).flatMap(docIdsUnder)
}

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

/** Binder rows with a checkbox each; a folder toggles everything beneath it. */
function SelectionRows({
  nodes,
  depth,
  selected,
  onToggle
}: {
  nodes: BinderNode[]
  depth: number
  selected: Set<string>
  onToggle: (ids: string[], on: boolean) => void
}): JSX.Element {
  return (
    <>
      {nodes.map((node) => {
        const ids = docIdsUnder(node)
        const on = ids.length > 0 && ids.every((id) => selected.has(id))
        const some = !on && ids.some((id) => selected.has(id))
        return (
          <div key={node.id}>
            <button
              type="button"
              role="checkbox"
              aria-checked={on ? true : some ? 'mixed' : false}
              className="control-row compile-row"
              style={{ paddingLeft: depth * 14 }}
              disabled={ids.length === 0}
              onClick={() => onToggle(ids, !on)}
            >
              <span className={`check${on ? ' on' : some ? ' some' : ''}`} />
              <span className="row-title">{node.title}</span>
            </button>
            {node.children && node.children.length > 0 && (
              <SelectionRows
                nodes={node.children}
                depth={depth + 1}
                selected={selected}
                onToggle={onToggle}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

export function CompileDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const project = useWyrm((s) => s.project)
  const loadAllDocs = useWyrm((s) => s.loadAllDocs)
  const compileManuscript = useWyrm((s) => s.compileManuscript)

  const [docs, setDocs] = useState<Map<string, DocFile> | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState<CompileFormat>(DEFAULT_COMPILE_OPTIONS.format)
  const [sepMode, setSepMode] = useState<SeparatorMode>('hash')
  const [customSep, setCustomSep] = useState('')
  const [titlePage, setTitlePage] = useState(false)
  const [docTitles, setDocTitles] = useState(false)
  const [folderTitles, setFolderTitles] = useState(false)
  const [pageBreaks, setPageBreaks] = useState(false)
  const [busy, setBusy] = useState(false)
  const [written, setWritten] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!project) return
    let live = true
    void loadAllDocs()
      .then((loaded) => {
        if (!live) return
        setDocs(loaded)
        // Everything is selected by default — compiling the whole novel is by
        // far the common case, and deselecting is easier than hunting.
        setSelected(new Set(allDocIds(project.data.binder)))
      })
      .catch((e: unknown) => live && setError(errorMessage(e)))
    return () => {
      live = false
    }
  }, [project, loadAllDocs])

  const options: CompileOptions = useMemo(
    () => ({
      format,
      includeIds: [...selected],
      separator:
        sepMode === 'custom' ? customSep : (SEPARATORS.find((s) => s.mode === sepMode)?.text ?? ''),
      titlePage,
      docTitles,
      folderTitles,
      pageBreakBetweenFolders: pageBreaks && format === 'docx'
    }),
    [format, selected, sepMode, customSep, titlePage, docTitles, folderTitles, pageBreaks]
  )

  const result = useMemo(
    () => (project && docs ? compile(project.data, docs, options) : null),
    [project, docs, options]
  )

  const toggle = (ids: string[], on: boolean): void => {
    setWritten(null)
    setSelected((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const run = (): void => {
    setBusy(true)
    setError(null)
    void compileManuscript(options)
      .then(({ path }) => setWritten(path))
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  const preview = result?.text ?? ''
  const empty = result != null && result.docCount === 0

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog wide" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Compile Manuscript</span>
        </div>
        <div className="dialog-body">
          {error != null && <div className="error-text">{error}</div>}
          <div className="version-body compile-body">
            <div className="version-list" aria-label="Documents to include">
              {docs == null && error == null ? (
                <div className="dialog-hint" style={{ padding: '8px 10px' }}>
                  Reading documents…
                </div>
              ) : (
                <SelectionRows
                  nodes={project?.data.binder ?? []}
                  depth={0}
                  selected={selected}
                  onToggle={toggle}
                />
              )}
            </div>
            <div className="version-detail">
              {empty ? (
                <div className="dialog-hint">
                  Nothing selected yet. Tick a folder to include everything inside it.
                </div>
              ) : (
                <pre className="compile-preview">
                  {preview.slice(0, PREVIEW_LIMIT)}
                  {preview.length > PREVIEW_LIMIT ? '\n…' : ''}
                </pre>
              )}
            </div>
          </div>

          <div className="compile-options">
            <fieldset className="fieldset">
              <legend>FORMAT</legend>
              {FORMATS.map((f) => (
                <Radio
                  key={f.value}
                  label={f.label}
                  on={format === f.value}
                  onPick={() => {
                    setFormat(f.value)
                    setWritten(null)
                  }}
                />
              ))}
            </fieldset>
            <fieldset className="fieldset">
              <legend>SCENE BREAK</legend>
              {SEPARATORS.map((s) => (
                <Radio
                  key={s.mode}
                  label={s.label}
                  on={sepMode === s.mode}
                  onPick={() => setSepMode(s.mode)}
                />
              ))}
              <Radio label="Custom" on={sepMode === 'custom'} onPick={() => setSepMode('custom')} />
              <input
                className="text-field"
                aria-label="Custom scene break"
                value={customSep}
                disabled={sepMode !== 'custom'}
                onChange={(e) => setCustomSep(e.target.value)}
              />
            </fieldset>
            <fieldset className="fieldset">
              <legend>INCLUDE</legend>
              <Check label="Title page" on={titlePage} onToggle={setTitlePage} />
              <Check label="Document titles" on={docTitles} onToggle={setDocTitles} />
              <Check label="Folder titles" on={folderTitles} onToggle={setFolderTitles} />
              <Check
                label="Page break between folders"
                on={pageBreaks && format === 'docx'}
                disabled={format !== 'docx'}
                onToggle={setPageBreaks}
              />
            </fieldset>
          </div>

          <div className="compile-tally">
            <span>{(result?.wordCount ?? 0).toLocaleString()} WORDS</span>
            <span>
              {result?.docCount ?? 0} {result?.docCount === 1 ? 'DOCUMENT' : 'DOCUMENTS'}
            </span>
            <span className="spacer" />
            {written != null && <span>WRITTEN TO {written}</span>}
          </div>
          <div className="dialog-hint">
            A checkpoint is committed before compiling, so the manuscript you export is always a
            version you can return to. Story-bible links are never part of the text.
          </div>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn default"
            disabled={busy || empty || docs == null}
            onClick={run}
          >
            {busy ? 'Compiling…' : 'Compile'}
          </button>
        </div>
      </div>
    </div>
  )
}
