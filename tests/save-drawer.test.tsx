// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SyncStatus } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { SaveDrawer } from '../src/renderer/src/components/SaveDrawer'

/**
 * F-50 step 1: the Save To drawer, driven against the in-memory api. The
 * project's folder is always the first card's peer and never removable; the
 * other cards are the backup targets and GitHub, in the writer's order.
 */

const SYNCED: SyncStatus = {
  mode: 'github',
  remoteUrl: 'https://github.com/someone/winter.git',
  login: 'someone',
  clientIdSet: true,
  lastSyncAt: Date.now() - 5 * 60_000,
  pendingSync: false
}

let path = ''

async function openDemo(): Promise<void> {
  path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved', backupSettings: null })
}

function renderDrawer(props: Partial<Parameters<typeof SaveDrawer>[0]> = {}): void {
  render(<SaveDrawer onClose={() => {}} onAddGithub={() => {}} onBringDown={() => {}} {...props} />)
}

const cardNames = (): string[] =>
  screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label') ?? '')

beforeEach(async () => {
  vi.restoreAllMocks()
  await openDemo()
})

afterEach(async () => {
  cleanup()
  for (const target of (await api.getBackupSettings(path)).targets) {
    await api.removeBackupTarget(path, target.id)
  }
  await api.setSaveOrder(path, [])
  useWyrm.setState({ project: null, booted: false, backupSettings: null, syncStatus: null })
})

async function addDrives(n: number): Promise<string[]> {
  for (let i = 0; i < n; i++) await api.chooseBackupLocation(path)
  return (await api.getBackupSettings(path)).targets.map((t) => t.id)
}

describe('the cards', () => {
  it('always shows this computer, clipped as the default, with no way to remove it', async () => {
    renderDrawer()
    await waitFor(() => expect(cardNames()).toEqual(['This computer, default']))
    const card = screen.getAllByRole('listitem')[0]
    expect(card.querySelector('.paper-clip')).not.toBeNull()
    expect(within(card).queryByRole('button', { name: /Remove/ })).toBeNull()
  })

  it('lists the drives and GitHub after it, each removable', async () => {
    await addDrives(2)
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(SYNCED)
    renderDrawer()
    await waitFor(() =>
      expect(cardNames()).toEqual(['This computer, default', 'Backup', 'CARD', 'GitHub'])
    )
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(3)
    expect(screen.getByText('Saved 5 min ago')).toBeTruthy()
  })

  it('says why a drive cannot be reached', async () => {
    const [, card] = await addDrives(2)
    vi.spyOn(api, 'checkSaveLocations').mockResolvedValue({ unreachable: [card], behind: [] })
    renderDrawer()
    const broken = await screen.findByText(/Broken connection!/)
    expect(broken.closest('li')?.getAttribute('aria-label')).toBe('CARD')
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('Drive not connected')
  })
})

describe('the GitHub card', () => {
  it('says GitHub is unreachable after a sync that could not reach it', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(SYNCED)
    useWyrm.setState({ syncProblem: 'GitHub unreachable' })
    renderDrawer()
    const broken = await screen.findByText(/Broken connection!/)
    expect(broken.closest('li')?.getAttribute('aria-label')).toBe('GitHub')
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('GitHub unreachable')
  })

  it("asks for the writer's eye during conflicts, without calling the connection broken", async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(SYNCED)
    useWyrm.setState({ syncNeedsAttention: true, syncProblem: null })
    renderDrawer()
    const github = await screen.findByRole('listitem', { name: 'GitHub' })
    expect(within(github).getByText('Needs your eye')).toBeTruthy()
    expect(screen.queryByText(/Broken connection!/)).toBeNull()
  })
})

describe('changing the default', () => {
  it('moves a card up with ⌥↑, and the clip follows it', async () => {
    const [drive] = await addDrives(1)
    const write = vi.spyOn(api, 'setSaveOrder')
    renderDrawer()
    await waitFor(() => expect(cardNames()).toHaveLength(2))
    fireEvent.keyDown(screen.getAllByRole('listitem')[1], { key: 'ArrowUp', altKey: true })
    await waitFor(() => expect(cardNames()).toEqual(['Backup, default', 'This computer']))
    expect(write).toHaveBeenCalledWith(path, [drive, 'folder'])
    expect(screen.getAllByRole('listitem')[0].querySelector('.paper-clip')).not.toBeNull()
    expect(screen.getAllByRole('listitem')[1].querySelector('.paper-clip')).toBeNull()
  })

  it('ignores an arrow without ⌥, and a move past the top', async () => {
    await addDrives(1)
    const write = vi.spyOn(api, 'setSaveOrder')
    renderDrawer()
    await waitFor(() => expect(cardNames()).toHaveLength(2))
    fireEvent.keyDown(screen.getAllByRole('listitem')[1], { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getAllByRole('listitem')[0], { key: 'ArrowUp', altKey: true })
    expect(write).not.toHaveBeenCalled()
  })

  it('drags a card down past the next one, tracked on the document', async () => {
    const [drive] = await addDrives(1)
    const write = vi.spyOn(api, 'setSaveOrder')
    renderDrawer()
    await waitFor(() => expect(cardNames()).toHaveLength(2))
    const first = screen.getAllByRole('listitem')[0]
    fireEvent.pointerDown(first, { pointerId: 1, button: 0, clientY: 10 })
    // jsdom has no layout, so the slot falls back to 80px; the move lands
    // off the card, on the document, as a fast drag does.
    act(() => {
      document.dispatchEvent(pointer('pointermove', 1, 30))
      document.dispatchEvent(pointer('pointermove', 1, 60))
    })
    expect(document.querySelector('.save-card.lifted')).not.toBeNull()
    act(() => {
      document.dispatchEvent(pointer('pointerup', 1, 60))
    })
    await waitFor(() => expect(write).toHaveBeenCalledWith(path, [drive, 'folder']))
    expect(document.querySelector('.save-card.lifted')).toBeNull()
  })

  it('treats a press that barely moves as a click, not a drag', async () => {
    await addDrives(1)
    const write = vi.spyOn(api, 'setSaveOrder')
    renderDrawer()
    await waitFor(() => expect(cardNames()).toHaveLength(2))
    fireEvent.pointerDown(screen.getAllByRole('listitem')[0], {
      pointerId: 1,
      button: 0,
      clientY: 10
    })
    act(() => {
      document.dispatchEvent(pointer('pointermove', 1, 12))
    })
    expect(document.querySelector('.save-card.lifted')).toBeNull()
    act(() => {
      document.dispatchEvent(pointer('pointerup', 1, 12))
    })
    expect(document.querySelector('.save-card.lifted')).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })
})

function pointer(type: string, pointerId: number, clientY: number): Event {
  const event = new MouseEvent(type, { bubbles: true, clientY })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  return event
}

describe('adding and removing', () => {
  it('asks before removing, and keeps the card on Keep', async () => {
    const [drive] = await addDrives(1)
    const remove = vi.spyOn(api, 'removeBackupTarget')
    renderDrawer()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Backup' }))
    expect(screen.getByRole('alertdialog').textContent).toMatch(/copy already there stays/)
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Backup' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(cardNames()).toEqual(['This computer, default']))
    expect(remove).toHaveBeenCalledWith(path, drive)
  })

  it('disconnects GitHub without deleting anything there', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(SYNCED)
    const disconnect = vi
      .spyOn(api, 'disconnectSync')
      .mockResolvedValue({ ...SYNCED, mode: 'local-only', remoteUrl: null })
    renderDrawer()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove GitHub' }))
    expect(screen.getByRole('alertdialog').textContent).toMatch(/nothing on GitHub is deleted/)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith(path))
  })

  it('says why it cannot add a fourth location, rather than going dead', async () => {
    await addDrives(2)
    renderDrawer()
    await waitFor(() => expect(cardNames()).toHaveLength(3))
    const add = screen.getByRole('button', { name: 'Add Location…' })
    expect((add as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(add)
    expect(screen.getByRole('alert').textContent).toMatch(/3 locations at most/)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers a drive or GitHub, and only a drive once GitHub is there', async () => {
    const onAddGithub = vi.fn()
    renderDrawer({ onAddGithub })
    await waitFor(() => expect(cardNames()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Add Location…' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'GitHub…' }))
    expect(onAddGithub).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add Location…' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'A Drive or Card…' }))
    await waitFor(() => expect(cardNames()).toEqual(['This computer, default', 'Backup']))
  })

  it('turning multiple off removes every card but the default, after asking', async () => {
    await addDrives(1)
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(SYNCED)
    const disconnect = vi
      .spyOn(api, 'disconnectSync')
      .mockResolvedValue({ ...SYNCED, mode: 'local-only', remoteUrl: null })
    renderDrawer()
    await waitFor(() => expect(cardNames()).toHaveLength(3))
    const multiple = screen.getByRole('checkbox', { name: 'Save to multiple locations' })
    expect(multiple.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(multiple)
    expect(screen.getByRole('alertdialog').textContent).toMatch(/Stop saving to Backup and GitHub/)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(disconnect).toHaveBeenCalled())
    await waitFor(() => expect((useWyrm.getState().backupSettings?.targets ?? []).length).toBe(0))
  })

  it('never removes this computer, even when GitHub is the default', async () => {
    await addDrives(1)
    await api.setSaveOrder(path, ['github'])
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(SYNCED)
    const disconnect = vi.spyOn(api, 'disconnectSync')
    renderDrawer()
    await waitFor(() => expect(cardNames()[0]).toBe('GitHub, default'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Save to multiple locations' }))
    expect(screen.getByRole('alertdialog').textContent).toMatch(/Stop saving to Backup\?/)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(cardNames()).toEqual(['GitHub, default', 'This computer']))
    expect(disconnect).not.toHaveBeenCalled()

    // Two places still: the switch says so, and turning it off says why the
    // folder stays rather than doing nothing.
    const multiple = screen.getByRole('checkbox', { name: 'Save to multiple locations' })
    expect(multiple.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(multiple)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('alert').textContent).toMatch(/This computer always keeps a copy/)

    // The note answers that click; the next thing the writer does clears it.
    fireEvent.click(screen.getByRole('button', { name: 'Save Now' }))
    expect(screen.queryByText(/This computer always keeps a copy/)).toBeNull()
  })
})

describe('Save Now', () => {
  it('makes a save point, then copies it to the drives and GitHub', async () => {
    await addDrives(1)
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(SYNCED)
    const commit = vi.spyOn(api, 'commit')
    const backup = vi.spyOn(api, 'backupNow')
    const sync = vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'pushed', at: Date.now() })
    renderDrawer()
    await waitFor(() => expect(cardNames()).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: 'Save Now' }))
    await waitFor(() => expect(sync).toHaveBeenCalled())
    expect(commit).toHaveBeenCalledWith(path, 'Save point')
    expect(backup).toHaveBeenCalledWith(path)
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(backup.mock.invocationCallOrder[0])
  })

  it('reports GitHub being offline on its own card, and still copies to the drive', async () => {
    await addDrives(1)
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(SYNCED)
    const backup = vi.spyOn(api, 'backupNow')
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'offline', detail: 'No connection.' })
    renderDrawer()
    await waitFor(() => expect(cardNames()).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: 'Save Now' }))
    const github = screen.getAllByRole('listitem')[2]
    await waitFor(() => expect(within(github).getByText('No connection.')).toBeTruthy())
    expect(backup).toHaveBeenCalled()
  })

  it('reports a drive that failed on its own card, and one that was missing as broken', async () => {
    const [card, archive] = await addDrives(2)
    vi.spyOn(api, 'backupNow').mockResolvedValue({
      at: Date.now(),
      results: [
        { targetId: card, status: 'failed', message: 'The drive is full.' },
        { targetId: archive, status: 'unreachable' }
      ]
    })
    // The main process agrees: the second drive is not there.
    vi.spyOn(api, 'checkSaveLocations').mockResolvedValue({
      unreachable: [archive],
      behind: [card]
    })
    renderDrawer()
    await waitFor(() => expect(cardNames()).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: 'Save Now' }))
    const [, first, second] = screen.getAllByRole('listitem')
    await waitFor(() => expect(within(first).getByText('The drive is full.')).toBeTruthy())
    expect(within(second).getByText(/Broken connection!/)).toBeTruthy()
    expect(within(first).queryByText(/Broken connection!/)).toBeNull()
  })

  it('reports a backup that could not run at all on every drive', async () => {
    await addDrives(2)
    vi.spyOn(api, 'backupNow').mockRejectedValue(new Error('Could not read the project.'))
    renderDrawer()
    await waitFor(() => expect(cardNames()).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: 'Save Now' }))
    await waitFor(() => expect(screen.getAllByText('Could not read the project.')).toHaveLength(2))
    expect(
      within(screen.getAllByRole('listitem')[0]).queryByText('Could not read the project.')
    ).toBeNull()
  })

  it('stops if another project comes to the front during the save', async () => {
    await addDrives(1)
    const backup = vi.spyOn(api, 'backupNow')
    vi.spyOn(api, 'commit').mockImplementation(async () => {
      const project = useWyrm.getState().project!
      useWyrm.setState({ project: { ...project, path: '/elsewhere/Other.wyrm' } })
      return true
    })
    renderDrawer()
    await waitFor(() => expect(cardNames()).toHaveLength(2))
    await act(async () => {
      await useWyrm.getState().saveEverywhere()
    })
    expect(backup).not.toHaveBeenCalled()
  })
})

describe('Restore from', () => {
  it('offers a backup and GitHub', async () => {
    const onBringDown = vi.fn()
    renderDrawer({ onBringDown })
    fireEvent.click(screen.getByRole('tab', { name: 'Restore from' }))
    expect(screen.getByText('From a backup')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose…' })[1])
    expect(onBringDown).toHaveBeenCalled()
  })

  it('moves between tabs with the arrow keys', () => {
    renderDrawer()
    const save = screen.getByRole('tab', { name: 'Save to' })
    fireEvent.keyDown(save, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Restore from' }).getAttribute('aria-selected')).toBe(
      'true'
    )
  })
})
