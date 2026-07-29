import type { JSX } from 'react'
import { CharacterIcon, DocIcon, FolderIcon, GlossaryIcon, TrashIcon, WorldIcon } from './icons'

type Row = {
  depth: number
  icon: JSX.Element
  label: string
  selected?: boolean
  labelDot?: boolean
  status?: string
}

const rows: Row[] = [
  { depth: 0, icon: <FolderIcon />, label: 'Manuscript' },
  { depth: 1, icon: <FolderIcon />, label: 'Part One — The Harbor' },
  { depth: 2, icon: <DocIcon />, label: 'The Wyrmlight Fades', labelDot: true, status: 'REV' },
  { depth: 2, icon: <DocIcon />, label: 'A Knock at Night', selected: true, labelDot: true },
  { depth: 2, icon: <DocIcon />, label: 'Ashes on the Tide', status: 'DRAFT' },
  { depth: 1, icon: <FolderIcon />, label: 'Part Two — Harrowgate' },
  { depth: 2, icon: <DocIcon />, label: 'The Toll Road' },
  { depth: 2, icon: <DocIcon />, label: 'Winter Court' },
  { depth: 0, icon: <FolderIcon />, label: 'Notes' },
  { depth: 1, icon: <DocIcon />, label: 'Timeline' },
  { depth: 1, icon: <DocIcon />, label: 'Loose Threads' }
]

const bibleRows: Row[] = [
  { depth: 0, icon: <GlossaryIcon />, label: 'Glossary' },
  { depth: 0, icon: <CharacterIcon />, label: 'Character Book' },
  { depth: 0, icon: <WorldIcon />, label: 'World Book' }
]

function BinderRow({ row }: { row: Row }): JSX.Element {
  return (
    <div
      className={`binder-row${row.selected ? ' selected' : ''}`}
      style={{ paddingLeft: 8 + row.depth * 16 }}
    >
      <span className="glyph">{row.icon}</span>
      <span>{row.label}</span>
      {row.labelDot && <span className="label-dot" />}
      {row.status && <span className="status-tag">{row.status}</span>}
    </div>
  )
}

export function Binder(): JSX.Element {
  return (
    <div className="binder">
      {rows.map((row, i) => (
        <BinderRow key={i} row={row} />
      ))}
      <div className="binder-sep" />
      {bibleRows.map((row, i) => (
        <BinderRow key={i} row={row} />
      ))}
      <div className="binder-sep" />
      <BinderRow row={{ depth: 0, icon: <TrashIcon />, label: 'Trash' }} />
    </div>
  )
}
