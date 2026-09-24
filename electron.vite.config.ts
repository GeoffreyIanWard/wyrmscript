import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // The About box reads this rather than carrying a hardcoded string. The
    // literal drifted silently before — it still said 0.1.0 through the whole
    // of v0.2.0, because bumping package.json for a release has no reason to
    // make anyone open Dialogs.tsx.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
