// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
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
  // Signed in, as these cases assume; the not-signed-in path has its own tests.
  vi.spyOn(api, 'getGithubAccount').mockResolvedValue({ clientIdSet: true, login: 'demo' })
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

describe('on a new computer, not yet signed in', () => {
  // The reported bug: the list said "Sign in with GitHub first" and the only
  // place to sign in was Sync, which needs an open project — and a new
  // computer has none.
  const signedOut = (clientIdSet: boolean): void => {
    vi.spyOn(api, 'getGithubAccount').mockResolvedValue({ clientIdSet, login: null })
  }
  const text = (): string => document.querySelector('.dialog')?.textContent ?? ''

  it('signs in right here, from the client id to the list', async () => {
    signedOut(false)
    const setClientId = vi
      .spyOn(api, 'setGithubClientId')
      .mockResolvedValue({ clientIdSet: true, login: null })
    vi.spyOn(api, 'signInStart').mockResolvedValue({
      userCode: 'WYRM-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900
    })
    vi.spyOn(api, 'signInPoll').mockResolvedValue({ state: 'ok', login: 'geoffrey' })
    const list = vi.spyOn(api, 'listGithubRepos').mockResolvedValue(repos)
    await renderDialog()

    // Nothing is asked of GitHub's list before there is an account to list.
    expect(list).not.toHaveBeenCalled()
    expect(text()).not.toContain('Sign in with GitHub first')
    const field = document.querySelector<HTMLInputElement>(
      'input[placeholder="Paste the Client ID here"]'
    )!
    await act(async () => {
      fireEvent.change(field, { target: { value: 'Iv1.test' } })
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(setClientId).toHaveBeenCalledWith('Iv1.test')

    const signIn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Sign in with GitHub'
    )!
    await act(async () => {
      fireEvent.click(signIn)
    })
    await waitFor(() => expect(text()).toContain('Signed in to GitHub as geoffrey'))
    await waitFor(() =>
      expect(document.querySelector('.row-title')?.textContent).toBe('demo/winter')
    )
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('gets past “Looking…” under StrictMode, as the app runs it', async () => {
    // StrictMode mounts, cleans up and mounts again; a "still open" flag only
    // ever cleared on cleanup dropped every answer and the dialog never moved.
    signedOut(true)
    await act(async () => {
      render(
        <StrictMode>
          <CloneDialog onClose={onClose} />
        </StrictMode>
      )
    })
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent === 'Sign in with GitHub'
        )
      ).toBe(true)
    )
    expect(text()).not.toContain('Looking…')
  })

  it('goes straight to signing in when this computer already has the client id', async () => {
    signedOut(true)
    await renderDialog()
    expect(
      [...document.querySelectorAll('button')].some((b) => b.textContent === 'Sign in with GitHub')
    ).toBe(true)
    expect(document.querySelector('input[placeholder="Paste the Client ID here"]')).toBeNull()
  })

  it('says a private address needs signing in, rather than letting it fail later', async () => {
    signedOut(true)
    await renderDialog()
    expect(text()).toContain('A private one needs you signed in above first.')
  })

  it('says why an empty client id was not saved', async () => {
    signedOut(false)
    const setClientId = vi.spyOn(api, 'setGithubClientId')
    await renderDialog()
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save')!
    await act(async () => {
      fireEvent.click(save)
    })
    expect(setClientId).not.toHaveBeenCalled()
    expect(text()).toContain('Paste the Client ID first.')
  })
})
