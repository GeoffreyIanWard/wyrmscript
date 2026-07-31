import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Stubs the DOM methods jsdom lacks; a no-op in the node-environment tests.
    setupFiles: ['tests/setup.ts']
  }
})
