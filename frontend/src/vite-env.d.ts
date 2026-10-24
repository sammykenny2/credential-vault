/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Set by vite.config.ts `define`
declare const __APP_VERSION__: string
declare const __APP_REVISION__: string
