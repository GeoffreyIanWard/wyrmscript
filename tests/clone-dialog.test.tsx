// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'
import { CloneDialog } from '../src/renderer/src/components/CloneDialog'

/**
 * F-43's dialog. The clone itself is tested against real repositories in
 * `clone-from-github.test.ts`; what matters here is the half a writer
 * touches — that both ways in work, that not being signed in leaves the
 * address field usable rather than taking the dialog down, and that a
 * refusal is *shown* rather than swallowed.
 */

const onClose = vi.fn()

async function renderDialog(): Promise<void> {
  await act(async () => {
    render(<CloneDialog onClose={onClose} />)
  })
}

const repos = [
  {
    name: 'winter',
    fullName: 'demo/winter',
    cloneUrl: 'https://github.com/demo/winter.git',
    private: true,
    updatedAt: new Date().toISOString()
  }
]

beforeEach(() => {
  vi.restoreAllMocks()
  onClose.mockClear()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ project: null, booted: false, parked: {}, openPaths: [], editor: null })
  __disposeAll()
})

describe('bringing a project down', () => {
  it('lists the account’s spaces', async () => {
    vi.spyOn(api, 'listGithubRepos').mockResolvedValue(repos)
    await renderDialog()

    await waitFor(() => expect(document.querySelector('.version-row')).toBeTruthy())
    expect(document.querySelector('.row-title')?.textContent).toBe('demo/winter')
  })

  it('brings one down when it is picked', async () => {
    vi.spyOn(api, 'listGithubRepos').mockResolvedValue(repos)
    const clone = vi.spyOn(api, 'cloneProject').mockResolvedValue(null)
    await renderDialog()
    await waitFor(() => expect(document.querySelector('.version-row')).toBeTruthy())

    await act(async () => {
      fireEvent.click(document.querySelector('.version-row') as HTMLElement)
    })

    expect(clone).toHaveBeenCalledWith('https://github.com/demo/winter.git')
  })

  it('takes a pasted address, for a novel that is not on this account', async () => {
    // The list can only ever show the signed-in account's own spaces, so
    // this is what covers a collaborator's repository.
    vi.spyOn(api, 'listGithubRepos').mockResolvedValue([])
    const clone = vi.spyOn(api, 'cloneProject').mockResolvedValue(null)
    await renderDialog()

    const field = document.querySelector('.text-field') as HTMLInputElement
    await act(async () => {
      fireEvent.change(field, { target: { value: 'https://github.com/someone/theirs.git' } })
    })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(clone).toHaveBeenCalledWith('https://github.com/someone/theirs.git')
  })

  it('stays usable when the account cannot be read', async () => {
    // Not being signed in is the ordinary case here, not a failure: the
    // address field still works, so the dialog must not die with the list.
    vi.spyOn(api, 'listGithubRepos').mockRejectedValue(new Error('Sign in with GitHub first.'))
    await renderDialog()

    await waitFor(() => expect(document.body.textContent).toContain('Sign in with GitHub first.'))
    expect(document.querySelector('.text-field')).toBeTruthy()
  })

  it('shows a refusal rather than closing on it', async () => {
    // "That GitHub copy does not contain a WyrmStar project" is something
    // the writer has to read and act on.
    vi.spyOn(api, 'listGithubRepos').mockResolvedValue([])
    vi.spyOn(api, 'cloneProject').mockRejectedValue(
      new Error('That GitHub copy does not contain a WyrmStar project.')
    )
    await renderDialog()

    const field = document.querySelector('.text-field') as HTMLInputElement
    await act(async () => {
      fireEvent.change(field, { target: { value: 'https://github.com/someone/notes.git' } })
    })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    await waitFor(() =>
      expect(document.querySelector('.dialog-error')?.textContent).toContain(
        'does not contain a WyrmStar project'
      )
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open when the folder picker is cancelled', async () => {
    // Cancelling is not a failure and not a success — the dialog should be
    // exactly as it was, ready for another go.
    vi.spyOn(api, 'listGithubRepos').mockResolvedValue(repos)
    vi.spyOn(api, 'cloneProject').mockResolvedValue(null)
    await renderDialog()
    await waitFor(() => expect(document.querySelector('.version-row')).toBeTruthy())

    await act(async () => {
      fireEvent.click(document.querySelector('.version-row') as HTMLElement)
    })

    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('.dialog-error')).toBeNull()
  })

  it('closes once the project is open', async () => {
    vi.spyOn(api, 'listGithubRepos').mockResolvedValue(repos)
    // A real ProjectInfo from the mock backend rather than a fabricated one:
    // the dialog closes on the *project opening*, so the open has to be able
    // to succeed — a made-up path fails in `loadProject`, which is a fault in
    // the test, not in the dialog.
    const path = (await api.getLastProjectPath()) as string
    const info = (await api.openProjectPath(path))!
    vi.spyOn(api, 'cloneProject').mockResolvedValue(info)
    await renderDialog()
    await waitFor(() => expect(document.querySelector('.version-row')).toBeTruthy())

    await act(async () => {
      fireEvent.click(document.querySelector('.version-row') as HTMLElement)
    })

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useWyrm.getState().project?.path).toBe(path)
  })
})
