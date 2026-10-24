/* Easy English — offline cache (service worker).
   Opens the site from the phone's cache straight away, then checks GitHub for a newer version in the
   background. When a new index.html is found it is saved and the page shows "New version · Reload".
   Firebase data (Firestore) and the beans server are never cached. */
const VERSION = 'ee-cache-v1';
const CORE = ['./', './index.html'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION && key.startsWith('ee-cache-')) await caches.delete(key);
    await self.clients.claim();
  })());
});

const sameOrigin = url => url.origin === self.location.origin;
const isPage = (req, url) => req.mode === 'navigate' || (sameOrigin(url) && /\/(index\.html)?$/.test(url.pathname));
const isStaticCdn = url => /(^|\.)gstatic\.com$/.test(url.hostname) || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'cdnjs.cloudflare.com';
const isDictionary = url => sameOrigin(url) && /\/easy-english-dictionary\//.test(url.pathname);
const stamp = res => res ? [res.headers.get('etag') || '', res.headers.get('last-modified') || '', res.headers.get('content-length') || ''].join('|') : '';

async function tellClients(msg) {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })) c.postMessage(msg);
}

/* page: answer from cache at once, refresh the cache in the background */
async function pageResponse(event, req) {
  const cache = await caches.open(VERSION);
  const key = new Request(new URL('./', self.location).href);
  const cached = await cache.match(key);
  const network = fetch(req, { cache: 'no-cache' }).then(async res => {
    if (res && res.ok && res.type === 'basic') {
      const fresh = res.clone();
      const changed = cached && stamp(cached) !== stamp(fresh);
      await cache.put(key, fresh);
      if (changed) { await cache.put(new Request(new URL('./__ee_update__', self.location).href), new Response(String(Date.now()))); tellClients({ type: 'ee-update-ready' }); }
    }
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(network); return cached; }
  return (await network) || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* files that rarely change: cache first, refresh in the background */
async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
  if (cached) { event.waitUntil(network); return cached; }
  return (await network) || Response.error();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  if (isPage(req, url) && sameOrigin(url)) { event.respondWith(pageResponse(event, req)); return; }
  if (isDictionary(url) || isStaticCdn(url) || (sameOrigin(url) && /\.(png|jpe?g|webp|svg|ico|css|js|woff2?)$/i.test(url.pathname))) {
    event.respondWith(staleWhileRevalidate(event, req));
  }
});

self.addEventListener('message', event => { if (event.data === 'ee-skip-waiting') self.skipWaiting(); });
