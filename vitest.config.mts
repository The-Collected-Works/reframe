import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests for code that runs without Electron or a browser (the playback engine's core, say).
export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' }
})
