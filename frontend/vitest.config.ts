import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Fixed stand-ins for the build-time constants vite.config.ts defines
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __APP_REVISION__: JSON.stringify('0123456789abcdef0123456789abcdef01234567'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
