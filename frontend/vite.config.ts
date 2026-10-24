import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Version and commit baked into the bundle for the UI. The image build passes
// APP_VERSION / APP_REVISION as build args (its context has no VERSION file);
// a checkout reads the repository's VERSION.
function readVersionFile(): string {
  try {
    return readFileSync(path.resolve(import.meta.dirname, '../VERSION'), 'utf-8').trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

const appVersion = process.env.APP_VERSION || readVersionFile()
const appRevision = process.env.APP_REVISION || 'dev'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_REVISION__: JSON.stringify(appRevision),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
