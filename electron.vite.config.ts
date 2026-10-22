import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    // worker.js runs in an Electron utility process and does all ffmpeg work.
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), worker: resolve(__dirname, 'src/main/worker.ts') } } }
  },
  preload: { resolve: { alias: shared } },
  renderer: {
    resolve: { alias: shared },
    // IPv4 explicitly, so a Windows Electron reaches it through WSL's localhost forwarding.
    server: { host: '127.0.0.1' },
    plugins: [react()]
  }
})
