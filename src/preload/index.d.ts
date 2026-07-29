import type { WyrmApi } from '../shared/types'

declare global {
  interface Window {
    /** Present only inside Electron; the browser dev preview runs on a mock. */
    wyrm?: WyrmApi
  }
}

export {}
