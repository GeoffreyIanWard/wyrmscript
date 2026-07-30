import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Shown in the panel title, e.g. "History". Defaults to the whole app. */
  label?: string
  /** Rendered instead of unmounting everything when the subtree fails. */
  onDismiss?: () => void
}

interface State {
  error: Error | null
}

/**
 * Without this, a single uncaught error — including one thrown from an effect,
 * such as a failing IPC call — unmounts the entire React tree, leaving a blank
 * unresponsive window with the user's work seemingly gone. For a writing app
 * that is the worst possible failure mode, so every risky subtree gets wrapped
 * and the user always keeps a way back to their manuscript.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[wyrmscript] ${this.props.label ?? 'app'} failed:`, error, info.componentStack)
  }

  private dismiss = (): void => {
    this.setState({ error: null })
    this.props.onDismiss?.()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const isPanel = Boolean(this.props.onDismiss)
    return (
      <div className="dialog-overlay">
        <div className="dialog">
          <div className="title-bar">
            <span className="title">
              {this.props.label ? `${this.props.label} — Problem` : 'Something Went Wrong'}
            </span>
          </div>
          <div className="dialog-body">
            <div className="about-art">☹</div>
            <p className="error-text">{error.message || String(error)}</p>
            <div className="dialog-hint">
              {isPanel
                ? 'Your manuscript is untouched — close this panel and keep writing.'
                : 'Your work is saved on disk and in version history. Reloading the window is safe.'}
            </div>
          </div>
          <div className="dialog-buttons">
            {isPanel ? (
              <button type="button" className="btn default" onClick={this.dismiss}>
                Close
              </button>
            ) : (
              <button
                type="button"
                className="btn default"
                onClick={() => window.location.reload()}
              >
                Reload Window
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }
}
