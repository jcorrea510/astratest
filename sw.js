/* Meridian Afterglow service worker. Cache-first for hashed bundles and game assets, network-first for the page.
 * The build id below is stamped at build time (vite.config.ts), so every deploy gets a fresh cache and old ones are deleted. */
const VERSION = 'mwyzbl30';
const CACHE = 'ma-cache-' + VERSION;
const BASE = new URL('./', self.location).pathname; // e.g. /astratest/

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // best effort: the shell and icons so a first offline launch still opens
    await Promise.all([BASE, BASE + 'manifest.webmanifest', BASE + 'icons/icon-192.png', BASE + 'icons/apple-touch-icon.png']
      .map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('ma-cache-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function put(req, res) {
  if (res && res.status === 200 && res.type !== 'opaque') { try { const c = await caches.open(CACHE); await c.put(req, res.clone()); } catch { /* quota */ } }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (req.mode === 'navigate' || url.pathname === BASE + 'sw.js' || url.pathname === BASE + 'manifest.webmanifest') {
    // network-first so a new deploy is picked up on the next launch; cached copy when offline
    e.respondWith((async () => {
      try { return await put(req, await fetch(req)); }
      catch { return (await caches.match(req, { ignoreSearch: true })) || (await caches.match(BASE)) || Response.error(); }
    })());
    return;
  }
  // hashed bundles, public/assets models/textures/audio, icons: cache-first (cache is versioned per build)
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try { return await put(req, await fetch(req)); } catch { return Response.error(); }
  })());
});
