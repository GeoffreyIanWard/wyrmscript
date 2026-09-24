import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  plugins: [react()],
  // Mirrors electron.vite.config.ts, so a component reading the injected
  // version renders under test the same way it does in the app.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Stubs the DOM methods jsdom lacks; a no-op in the node-environment tests.
    setupFiles: ['tests/setup.ts']
  }
})
