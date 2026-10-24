import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

// Autocomplete, spell checking and password-manager behaviour are declared
// per field (lib/inputProps.ts, autoComplete on account fields), not
// overridden globally: account fields need their username/password tokens.

// Register service worker for PWA/offline support. The query string gives the
// registration a new script URL: nginx used to serve /sw.js as immutable, so
// browsers that cached it never fetched an update for that URL. A new URL has
// no cache entry, so they install the current worker, whose activate step
// deletes the old cache. Keep the URL stable from now on; /sw.js is served
// with no-cache, so later updates arrive through the normal update check.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=4').catch(() => {
      // Service worker registration failed - app works fine without it
    })
  })
}
