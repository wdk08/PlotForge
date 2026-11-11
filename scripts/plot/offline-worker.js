const scope = new URL(self.registration.scope);
const prefix = `${scope.pathname}:`;
const name = prefix + CACHE;
const paths = new Set(FILES.map(file => new URL(file, scope).pathname));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(name).then(cache => cache.addAll(FILES.map(file => new Request(new URL(file, scope), { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(prefix + 'plotforge-') && key !== name) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== scope.origin || event.request.method !== 'GET') return;
  if (url.pathname === scope.pathname) url.pathname += 'index.html';
  if (!paths.has(url.pathname)) return;
  url.search = '';
  event.respondWith(caches.open(name).then(async cache => (await cache.match(url)) ?? fetch(event.request)));
});
