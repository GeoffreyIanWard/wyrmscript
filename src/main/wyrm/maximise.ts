/**
 * On Windows the maximise button goes full screen instead.
 *
 * Maximise keeps the taskbar on screen even when Windows is set to hide it,
 * which is not what a writer pressing it expects of a writing app. View →
 * Full Screen (F-39) already covers the taskbar, so maximise takes the same
 * route. This also catches double-clicking the menu bar and Win+Up, which
 * maximise too.
 *
 * Unmaximised first, so leaving full screen goes back to the ordinary window
 * rather than to a maximised one, which would come straight back here.
 */
export interface MaximisableWindow {
  on(event: 'maximize', listener: () => void): void
  isFullScreen(): boolean
  unmaximize(): void
  setFullScreen(flag: boolean): void
}

export function maximiseAsFullScreen(win: MaximisableWindow, platform: string): void {
  if (platform !== 'win32') return
  win.on('maximize', () => {
    if (win.isFullScreen()) return
    win.unmaximize()
    win.setFullScreen(true)
  })
}
