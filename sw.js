// ─────────────────────────────────────────────────────────────────────────────
// sw.js — service worker.
//
// Cache name is keyed to the cache-bust token, so a bump makes every old cache
// unreachable and the activate handler deletes it. `scripts/bust.sh` rewrites
// the CB_TOKEN line below on every run.
//
// NOTE ON skipWaiting: the cache-busting skill's example calls skipWaiting()
// unconditionally in install. We deliberately do NOT. It swaps the controller
// mid-session, which for this app means the shader can reload underneath a
// slider drag. Instead the page shows an update toast and posts SKIP_WAITING
// on user consent. (cache-busting's reference offers this as its alternative.)
// ─────────────────────────────────────────────────────────────────────────────

const CB_TOKEN = "2b2da8de";
const CACHE = `p3dv-${CB_TOKEN}`;

// Everything needed to boot offline. three.module.js is 1.2MB and dominates
// this list, but without it the app cannot start at all, so it is shell, not
// an optimisation target. Total ~1.3MB — at the top of the skill's suggested
// precache budget, and justified because there is no second page to defer to.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',

  // Only main.mjs and style.css are referenced FROM THE HTML, so only those two
  // carry ?v=. Every other module is reached by a bare ES import inside main.mjs
  // and is requested WITHOUT a query — precaching them with ?v= would look fine
  // and miss on every runtime request.
  `./src/main.mjs?v=${CB_TOKEN}`,
  `./src/style.css?v=${CB_TOKEN}`,
  './src/effect.mjs',
  './src/registry.mjs',
  './src/shader-loader.mjs',
  './src/ui.mjs',
  './src/pwa.mjs',
  './src/permalink.mjs',
  './src/export.mjs',
  './src/bench.mjs',

  './vendor/three.module.js',

  // Shaders ARE fetched with ?v= — shader-loader.mjs appends the token itself.
  `./shaders/common.glsl?v=${CB_TOKEN}`,
  `./shaders/corona.frag?v=${CB_TOKEN}`,
  `./shaders/corona-golfed.frag?v=${CB_TOKEN}`,
  `./shaders/wormhole.frag?v=${CB_TOKEN}`,
  `./shaders/metal-grid-flow.frag?v=${CB_TOKEN}`,
  `./shaders/melting-jelly.frag?v=${CB_TOKEN}`,
  `./shaders/motion-cube.frag?v=${CB_TOKEN}`,
  `./shaders/sdf-primitives.frag?v=${CB_TOKEN}`,

  `./public/cb-badge.js?v=${CB_TOKEN}`,
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll is atomic — one 404 rejects the whole install. Shaders and modules
    // are fingerprinted, so a stale SHELL entry after a bust would silently
    // break installs. Add individually and tolerate misses instead.
    await Promise.all(SHELL.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (err) { console.warn('[sw] precache miss:', url, err.message); }
    }));
  })());
  // No skipWaiting — see header note.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_TOKEN') event.source?.postMessage({ type: 'TOKEN', token: CB_TOKEN });
});

// ── Fetch strategy ──────────────────────────────────────────────────────────
// Navigations : NetworkFirst with a 3s timeout, falling back to the cached shell.
// Fingerprinted assets (?v=) : CacheFirst — the URL changes when content does,
//   so a hit is definitionally fresh.
// Everything else same-origin : StaleWhileRevalidate.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;                        // never cache unsafe methods

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;             // don't touch cross-origin

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        const net = await withTimeout(fetch(request), 3000);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', net.clone());
        return net;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html'))
            ?? (await cache.match('./'))
            ?? new Response('Offline and no cached shell.', {
                 status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  const versioned = url.searchParams.has('v');
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);

    if (versioned && hit) return hit;                          // CacheFirst

    const net = fetch(request).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
      return res;
    }).catch(() => null);

    if (hit) { net; return hit; }                              // SWR: serve cache, refresh behind
    const res = await net;
    return res ?? new Response('', { status: 504 });
  })());
});

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}
