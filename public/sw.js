// machado service worker — makes the app shell (and the ONNX wasm runtime)
// available offline so the page loads with no network. Hand-written (no Workbox)
// to keep the dependency-light spirit of the project.
//
// Caching strategy:
//   • navigation requests → network-first, falling back to the cached index.html
//     (so the SPA always boots offline);
//   • same-origin assets (hashed JS/CSS/worker/wasm) → stale-while-revalidate,
//     so the first online visit populates the cache and later visits work offline;
//   • cross-origin ONNX Runtime wasm from cdn.jsdelivr.net → cache-first, so the
//     inference runtime is available offline too.
//
// Model weights come from HuggingFace and are cached separately by Transformers.js
// (env.useBrowserCache), so we deliberately DON'T intercept those requests.

const VERSION = 'v2';
const SHELL_CACHE = `machado-shell-${VERSION}`;
const RUNTIME_CACHE = `machado-runtime-${VERSION}`;
const CDN_CACHE = `machado-cdn-${VERSION}`;

// Minimal shell precached on install. Hashed build assets are added at runtime.
const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

// Cross-origin hosts we cache for offline (the ort-web .wasm binaries).
const CDN_HOSTS = ['cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, CDN_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Let the page trigger an immediate activation of a new worker.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1) SPA navigations: network-first, fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // 2) Same-origin assets: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request)
            .then((res) => {
              if (res && res.ok) cache.put(request, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // 3) ONNX Runtime wasm from a known CDN: cache-first (opaque responses OK).
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CDN_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((res) => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // Everything else (e.g. HuggingFace model files) is left to the browser /
  // Transformers.js cache — we don't call respondWith.
});
