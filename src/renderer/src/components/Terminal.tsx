import type { JSX } from 'react'

type TerminalProps = {
  onEntityClick: () => void
}

export function Terminal({ onEntityClick }: TerminalProps): JSX.Element {
  const character = (text: string): JSX.Element => (
    <span className="entity character" onClick={onEntityClick}>
      {text}
    </span>
  )
  const world = (text: string): JSX.Element => (
    <span className="entity world" onClick={onEntityClick}>
      {text}
    </span>
  )
  const glossary = (text: string): JSX.Element => (
    <span className="entity glossary" onClick={onEntityClick}>
      {text}
    </span>
  )

  return (
    <div className="terminal">
      <div className="terminal-top">
        <span>A Knock at Night</span>
        <span>1,847 words</span>
      </div>
      <div className="terminal-scroll" spellCheck={false}>
        <div className="page">
          <p>
            The knock came an hour past midnight, three slow raps that carried through the shutters
            like stones dropped down a well. {character('Elara Voss')} was awake before the third.
            Old habits from the war did not sleep, even when she did.
          </p>
          <p>
            She lit no candle. The {glossary('wyrmlight')} in the window-glass gave enough of a glow
            to dress by — that faint green shimmer every house in {world('Harrowgate')} had learned
            to live with, the way one lives with tinnitus or a creaking stair.{' '}
            <em>Someone is standing very still out there,</em> she thought, buckling her belt.
          </p>
          <p>
            The knock came again. Not louder. <strong>Exactly</strong> as loud, which was worse — a
            patience that had rehearsed itself.
          </p>
          <p>
            On the landing she paused at the little shrine to the {glossary('Drowned Saints')} and
            did not pray, exactly, but made the old harbor-sign with two fingers.{' '}
            {character('Marten')} would have laughed at her for it. Marten laughed at everything,
            which was <mark>the first thing the sea took</mark> and the last thing she intended to
            get back.
          </p>
          <p>
            She drew the bolt. The door swung in on cold air and salt, and the man on her step
            lifted his lantern so she could see what the light did to his eyes.
          </p>
          <p>
            “{character('Captain Voss')},” he said. “The {world('Winter Court')} sends its regards.”
            <span className="caret" />
          </p>
        </div>
      </div>
    </div>
  )
}
