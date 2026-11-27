const scope = self.registration.scope;
const config = new URL('config.js', scope).href;
const cacheName = 'baba-club-shell-v5-' + scope;
const assets = ['./','./index.html','./app.js','./manifest.json','./icon192.png','./icon512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(assets.map(path => new Request(new URL(path, scope), {cache:'reload'})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for(const key of await caches.keys()) if((key.startsWith('baba-test-shell-') || key.startsWith('baba-club-shell-')) && key.endsWith(scope) && key !== cacheName) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.href.startsWith(scope) || url.search || url.pathname.includes('/share/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    if (url.href === config || event.request.mode === 'navigate' || url.href === scope || url.href === new URL('index.html', scope).href) {
      try {
        const response = await fetch(event.request, {cache:'no-store'});
        if (!response.ok) throw new Error('App resource unavailable');
        await cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        const saved = await cache.match(event.request);
        if (saved) return saved;
        throw error;
      }
    }
    return await cache.match(event.request) || fetch(event.request);
  })());
});
