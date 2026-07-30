// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import type { JSX } from 'react'

/**
 * Regression tests for I-01 / I-02: a failing history lookup once white-screened
 * the entire app with no way back to the manuscript, and a rejected promise left
 * the version list silently blank.
 */

const log = vi.fn()
const readDocAtRef = vi.fn()
const listVariants = vi.fn()

vi.mock('../src/renderer/src/lib/api', () => ({
  api: {
    log: (...args: unknown[]) => log(...args),
    readDocAtRef: (...args: unknown[]) => readDocAtRef(...args),
    listVariants: (...args: unknown[]) => listVariants(...args),
    deleteVariant: vi.fn()
  },
  isElectron: false
}))

const activeDoc = {
  meta: { id: 'doc1', title: 'A Knock at Night', created: '', modified: '' },
  body: 'current text'
}

vi.mock('../src/renderer/src/store', () => {
  const state = {
    project: { path: '/demo/x.wyrm', data: { version: 1, title: 'x', binder: [], trash: [] } },
    activeDoc,
    restoreActiveDoc: vi.fn(),
    createVariant: vi.fn(),
    commitNow: vi.fn(),
    lastCommitAt: null
  }
  const useWyrm = <T,>(selector: (s: typeof state) => T): T => selector(state)
  useWyrm.getState = (): typeof state => state
  return { useWyrm }
})

const { HistoryDialog, VariantsDialog } =
  await import('../src/renderer/src/components/VersionDialogs')
const { ErrorBoundary } = await import('../src/renderer/src/components/ErrorBoundary')

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('HistoryDialog failure handling', () => {
  it('shows the failure instead of a silently blank list', async () => {
    log.mockRejectedValue(
      new Error(
        "Error invoking remote method 'git:log': Error: No handler registered for 'git:log'"
      )
    )
    render(<HistoryDialog onClose={() => {}} />)

    const message = await screen.findByText(/No handler registered/)
    expect(message).toBeTruthy()
    // The IPC plumbing prefix is stripped so the cause reads plainly.
    expect(message.textContent).not.toContain('Error invoking remote method')
    // And the dialog is still dismissible.
    expect(screen.getByLabelText('Close')).toBeTruthy()
  })

  it('distinguishes "still loading" from "no history"', async () => {
    log.mockReturnValue(new Promise(() => {})) // never settles
    render(<HistoryDialog onClose={() => {}} />)
    expect(screen.getByText(/Reading history/)).toBeTruthy()
    cleanup()

    log.mockResolvedValue([])
    render(<HistoryDialog onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/No checkpoints/)).toBeTruthy())
  })

  it('lists commits when the lookup succeeds', async () => {
    log.mockResolvedValue([{ oid: 'abc123', message: 'First draft', timestamp: Date.now() }])
    render(<HistoryDialog onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('First draft')).toBeTruthy())
  })
})

describe('VariantsDialog failure handling', () => {
  it('surfaces a failed variant listing', async () => {
    listVariants.mockRejectedValue(new Error('git refs unreadable'))
    render(<VariantsDialog onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('git refs unreadable')).toBeTruthy())
  })
})

describe('ErrorBoundary', () => {
  function Boom(): JSX.Element {
    throw new Error('render exploded')
  }

  /** The reported failure: a stale IPC bridge made `api.log` undefined, so the
   *  effect threw synchronously and React tore down the whole tree. */
  function BoomInEffect(): JSX.Element {
    useEffect(() => {
      const missing = undefined as unknown as { log: () => void }
      missing.log()
    }, [])
    return <p>never seen</p>
  }

  it('contains an error thrown from an effect', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <div>
        <p>manuscript still here</p>
        <ErrorBoundary label="History" onDismiss={() => {}}>
          <BoomInEffect />
        </ErrorBoundary>
      </div>
    )
    expect(screen.getByText('History — Problem')).toBeTruthy()
    expect(screen.getByText('manuscript still here')).toBeTruthy()
    spy.mockRestore()
  })

  it('contains a crash instead of unmounting the app, and can be dismissed', async () => {
    const onDismiss = vi.fn()
    // Suppress React's expected error logging for this deliberate throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <div>
        <p>manuscript still here</p>
        <ErrorBoundary label="History" onDismiss={onDismiss}>
          <Boom />
        </ErrorBoundary>
      </div>
    )

    expect(screen.getByText('render exploded')).toBeTruthy()
    expect(screen.getByText('History — Problem')).toBeTruthy()
    // Critically: the rest of the app survived.
    expect(screen.getByText('manuscript still here')).toBeTruthy()

    screen.getByRole('button', { name: 'Close' }).click()
    await waitFor(() => expect(onDismiss).toHaveBeenCalled())
    spy.mockRestore()
  })
})
