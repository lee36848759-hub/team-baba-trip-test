const cache='baba-test-shell-v1-'+self.registration.scope;
self.addEventListener('install',e=>e.waitUntil(caches.open(cache).then(c=>c.addAll(['./','./index.html','./config.js','./app.js','./manifest.json','./icon192.png','./icon512.png']))));
self.addEventListener('fetch',e=>{if(e.request.method==='GET'&&e.request.url.startsWith(self.registration.scope)&&!new URL(e.request.url).search)e.respondWith(caches.open(cache).then(async c=>(await c.match(e.request))||fetch(e.request)))});
