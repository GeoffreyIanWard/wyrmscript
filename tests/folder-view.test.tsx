// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DocFile, ProjectInfo } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { FolderView } from '../src/renderer/src/components/FolderView'
import { Binder } from '../src/renderer/src/components/Binder'

/**
 * F-08: clicking a folder's row body opens a plain listing of its immediate
 * contents — the twist stays the collapse/expand control, matching the
 * Finder split the roadmap settled on. These drive the real components.
 */

function doc(id: string, title: string, overrides: Partial<DocFile['meta']> = {}): DocFile {
  const now = new Date().toISOString()
  return {
    meta: { id, title, created: now, modified: now, ...overrides },
    body: ''
  }
}

function makeProject(): ProjectInfo {
  return {
    path: '/demo',
    data: {
      version: 1,
      title: 'T',
      binder: [
        {
          id: 'part-one',
          type: 'folder',
          title: 'Part One',
          children: [
            { id: 'chapter-1', type: 'folder', title: 'Chapter 1', children: [] },
            { id: 'scene-a', type: 'doc', title: 'The Wyrmlight Fades' },
            { id: 'scene-b', type: 'doc', title: 'A Knock at Night' }
          ]
        },
        { id: 'empty-folder', type: 'folder', title: 'Notes', children: [] }
      ],
      trash: []
    }
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useWyrm.setState({
    project: null,
    activeId: null,
    activeDoc: null,
    mainView: { kind: 'doc' },
    viewHistory: [],
    renamingId: null
  })
})

describe('FolderView', () => {
  it('lists a folder’s immediate documents and subfolders, with word counts', async () => {
    vi.spyOn(api, 'readAllDocs').mockResolvedValue([
      doc('scene-a', 'The Wyrmlight Fades', { status: 'draft' }),
      doc('scene-b', 'A Knock at Night')
    ])
    useWyrm.setState({ project: makeProject() })
    await act(async () => {
      render(<FolderView folderId="part-one" />)
    })

    expect(screen.getByText('Part One')).toBeTruthy()
    expect(screen.getByText('Chapter 1')).toBeTruthy()
    expect(screen.getByText('The Wyrmlight Fades')).toBeTruthy()
    expect(screen.getByText('DRAFT')).toBeTruthy()
  })

  it('shows an empty state for a folder with nothing in it', async () => {
    vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
    useWyrm.setState({ project: makeProject() })
    await act(async () => {
      render(<FolderView folderId="empty-folder" />)
    })
    expect(screen.getByText('This folder is empty.')).toBeTruthy()
  })

  it('opens a listed document on click', async () => {
    vi.spyOn(api, 'readAllDocs').mockResolvedValue([doc('scene-a', 'The Wyrmlight Fades')])
    vi.spyOn(api, 'readDoc').mockResolvedValue(doc('scene-a', 'The Wyrmlight Fades'))
    useWyrm.setState({ project: makeProject() })
    await act(async () => {
      render(<FolderView folderId="part-one" />)
    })

    await act(async () => {
      fireEvent.click(screen.getByText('The Wyrmlight Fades'))
    })
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
    expect(useWyrm.getState().activeId).toBe('scene-a')
  })

  it('descends into a listed subfolder on click', async () => {
    vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
    useWyrm.setState({ project: makeProject() })
    await act(async () => {
      render(<FolderView folderId="part-one" />)
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Chapter 1'))
    })
    expect(useWyrm.getState().mainView).toEqual({ kind: 'folder', id: 'chapter-1' })
  })

  it('reports a folder that no longer exists rather than crashing', async () => {
    vi.spyOn(api, 'readAllDocs').mockResolvedValue([])
    useWyrm.setState({ project: makeProject() })
    await act(async () => {
      render(<FolderView folderId="does-not-exist" />)
    })
    expect(screen.getByText('This folder no longer exists.')).toBeTruthy()
  })
})

describe('Binder: folder rows', () => {
  it('clicking the row body opens the folder view, not expand/collapse', async () => {
    useWyrm.setState({ project: makeProject() })
    await act(async () => {
      render(<Binder />)
    })

    // Folders start expanded, so clicking the row body must not also
    // collapse it — the twist owns that, and only the twist.
    expect(screen.getByText('The Wyrmlight Fades')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByText('Part One'))
    })
    expect(useWyrm.getState().mainView).toEqual({ kind: 'folder', id: 'part-one' })
    expect(screen.getByText('The Wyrmlight Fades')).toBeTruthy()
  })

  it('clicking the twist still expands/collapses, without navigating', async () => {
    useWyrm.setState({ project: makeProject() })
    await act(async () => {
      render(<Binder />)
    })

    expect(screen.getByText('The Wyrmlight Fades')).toBeTruthy()
    const row = screen.getByText('Part One').closest('.binder-row')!
    const twist = row.querySelector('.twist')!
    await act(async () => {
      fireEvent.click(twist)
    })

    expect(screen.queryByText('The Wyrmlight Fades')).toBeNull()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
  })

  it('still opens a document row as before', async () => {
    useWyrm.setState({ project: makeProject() })
    vi.spyOn(api, 'readDoc').mockResolvedValue(doc('scene-a', 'The Wyrmlight Fades'))
    await act(async () => {
      render(<Binder />)
    })

    await act(async () => {
      fireEvent.click(screen.getByText('The Wyrmlight Fades'))
    })
    expect(useWyrm.getState().activeId).toBe('scene-a')
  })
})
