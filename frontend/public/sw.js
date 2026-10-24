// Credential Vault - Service Worker
// Cache-first for hashed static assets, network-only for HTML navigation.
// API responses are never cached: they carry encrypted vault material and
// key blobs that must not persist in Cache Storage on the device.
//
// HTML documents are never cached either. A cached document is replayed with
// the headers it was stored with, so after a deploy it would keep running the
// old Content-Security-Policy (an old CSP without 'wasm-unsafe-eval' blocks
// vault setup and unlock). The app cannot work offline anyway: every vault
// operation needs the API.

// Bumped from static-v2: activate deletes the old cache and the index.html
// precached in it.
const STATIC_CACHE = 'static-v3'

// Static assets to precache
const PRECACHE_URLS = [
  '/vault.svg',
  '/manifest.json',
]

// Install event - precache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS)
    }).then(() => self.skipWaiting())
  )
})

// Activate event - drop every other cache, including the old api-v1 cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE)
          .map((name) => caches.delete(name))
      )
    }).then(() => self.clients.claim())
  )
})

// Fetch event - routing strategy
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== 'GET') return

  // API requests - network only, never stored
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(request))
    return
  }

  // Static assets (JS, CSS, images) - cache first
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // HTML navigation - network only, never stored or replayed
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkOnlyDocument(request))
    return
  }

  // Default - network first
  event.respondWith(networkFirst(request, STATIC_CACHE))
})

// Network-only strategy (for API): no cache read, no cache write
async function networkOnly(request) {
  try {
    return await fetch(request)
  } catch {
    return new Response(
      JSON.stringify({ error: 'You are offline' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

// Network-only strategy for HTML documents: always the deployed document and
// its current headers; offline gets a plain page without scripts.
async function networkOnlyDocument(request) {
  try {
    return await fetch(request)
  } catch {
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
        '<p>Credential Vault needs a connection to your tailnet.</p>',
      {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    )
  }
}

// Cache-first strategy (for static assets with hashes)
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

// Network-first strategy (for other same-origin assets, never HTML documents)
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    return new Response('Offline', { status: 503 })
  }
}

// Check if URL is a static asset
function isStaticAsset(pathname) {
  return /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/.test(pathname)
}

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting()
  }
})
