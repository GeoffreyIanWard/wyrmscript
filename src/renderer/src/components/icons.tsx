import type { JSX, ReactNode } from 'react'

type IconProps = { size?: number }

function Glyph({ children, size = 14 }: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges">
      {children}
    </svg>
  )
}

export function FolderIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path
        d="M1 3h6l1 2h7v8H1z"
        fill="#fff"
        stroke="#000"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </Glyph>
  )
}

export function DocIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M3 1h7l3 3v11H3z" fill="#fff" stroke="#000" strokeWidth="1" />
      <path d="M10 1v3h3" fill="none" stroke="#000" strokeWidth="1" />
      <path d="M5 6h6M5 8h6M5 10h6M5 12h4" stroke="#000" strokeWidth="1" />
    </Glyph>
  )
}

export function CharacterIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="5" r="3" fill="#fff" stroke="#000" strokeWidth="1" />
      <path d="M2 15c0-4 3-6 6-6s6 2 6 6" fill="#fff" stroke="#000" strokeWidth="1" />
    </Glyph>
  )
}

export function WorldIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="8" r="6.5" fill="#fff" stroke="#000" strokeWidth="1" />
      <ellipse cx="8" cy="8" rx="3" ry="6.5" fill="none" stroke="#000" strokeWidth="1" />
      <path d="M1.5 8h13" stroke="#000" strokeWidth="1" />
    </Glyph>
  )
}

export function GlossaryIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M2 2h10v12H2z" fill="#fff" stroke="#000" strokeWidth="1" />
      <path d="M12 2l2 2v12l-2-2" fill="#fff" stroke="#000" strokeWidth="1" />
      <path d="M4 5h6M4 7h6M4 9h4" stroke="#000" strokeWidth="1" />
    </Glyph>
  )
}

export function TrashIcon(props: IconProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M4 5h8v10H4z" fill="#fff" stroke="#000" strokeWidth="1" />
      <path d="M2 4h12" stroke="#000" strokeWidth="1" />
      <path d="M6 2h4v2" fill="none" stroke="#000" strokeWidth="1" />
      <path d="M6 7v6M8 7v6M10 7v6" stroke="#000" strokeWidth="1" />
    </Glyph>
  )
}

export function WyrmIcon({ size = 15 }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges">
      <path
        d="M3 13c-1-3 0-6 3-7 2-1 5-1 6 1s0 4-2 4-3-1-2-3"
        fill="none"
        stroke="#000"
        strokeWidth="2"
      />
      <path d="M12 4l2-2M12 4l3 1" stroke="#000" strokeWidth="1" />
      <path d="M2 13h6" stroke="#000" strokeWidth="2" />
    </svg>
  )
}
