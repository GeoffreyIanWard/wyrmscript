// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { JSX } from 'react'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { Binder } from '../src/renderer/src/components/Binder'

/**
 * Regression tests for I-05: with a story-bible entry open in the main pane,
 * clicking a document in the binder highlighted the row but left the entry on
 * screen. Two causes stacked — `selectDoc` never reset `mainView`, and it
 * returned early when the clicked document was already active, which is
 * exactly the case a writer hits when returning to the document they left.
 */

/** Stands in for MainPane: proves a subscribed component actually re-renders. */
function Pane(): JSX.Element {
  const mainView = useWyrm((s) => s.mainView)
  return <div data-testid="pane">{mainView.kind}</div>
}

async function setup(): Promise<void> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({
    project: info,
    booted: true,
    saveState: 'saved',
    activeId: null,
    activeDoc: null,
    mainView: { kind: 'doc' }
  })
  render(
    <>
      <Binder />
      <Pane />
    </>
  )
}

/**
 * Put the app in the state the bug report describes: a bible entry on screen.
 * Wrapped in `act` so the render actually flushes — otherwise the assertions
 * below read a stale pane and pass for the wrong reason.
 */
function showAnEntity(): void {
  act(() => useWyrm.setState({ mainView: { kind: 'entity', id: 'some-glossary-entry' } }))
}

const clickRow = (title: string): boolean => fireEvent.click(screen.getByText(title))

afterEach(() => {
  cleanup()
  useWyrm.setState({ project: null, booted: false, mainView: { kind: 'doc' } })
})

describe('binder navigation from a story-bible entry', () => {
  it('returns to the manuscript when the clicked document is already active', async () => {
    await setup()
    clickRow('A Knock at Night')
    await waitFor(() => expect(useWyrm.getState().activeDoc?.meta.title).toBe('A Knock at Night'))

    showAnEntity()
    expect(screen.getByTestId('pane').textContent).toBe('entity')

    clickRow('A Knock at Night')

    await waitFor(() => expect(screen.getByTestId('pane').textContent).toBe('doc'))
    expect(useWyrm.getState().activeDoc?.meta.title).toBe('A Knock at Night')
  })

  it('returns to the manuscript and switches document when a different one is clicked', async () => {
    await setup()
    clickRow('A Knock at Night')
    await waitFor(() => expect(useWyrm.getState().activeDoc?.meta.title).toBe('A Knock at Night'))

    showAnEntity()
    clickRow('The Wyrmlight Fades')

    await waitFor(() => expect(screen.getByTestId('pane').textContent).toBe('doc'))
    expect(useWyrm.getState().activeDoc?.meta.title).toBe('The Wyrmlight Fades')
  })

  it('marks the clicked row selected in the binder', async () => {
    await setup()
    showAnEntity()
    clickRow('Timeline')

    await waitFor(() =>
      expect(document.querySelector('.binder-row.selected')?.textContent).toContain('Timeline')
    )
  })

  it('lands in the new document when one is created from the bible view', async () => {
    await setup()
    showAnEntity()

    await useWyrm.getState().addDoc(null)

    expect(useWyrm.getState().mainView.kind).toBe('doc')
    expect(useWyrm.getState().activeDoc?.meta.title).toBe('Untitled')
  })

  it('leaves a document in Trash alone — clicking it neither opens nor navigates', async () => {
    await setup()
    clickRow('Timeline')
    await waitFor(() => expect(useWyrm.getState().activeDoc?.meta.title).toBe('Timeline'))
    await useWyrm.getState().moveToTrash(useWyrm.getState().activeId!)

    fireEvent.click(screen.getByText('Trash'))
    showAnEntity()
    clickRow('Timeline')

    expect(screen.getByTestId('pane').textContent).toBe('entity')
  })
})
