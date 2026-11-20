// Gör att appen öppnas snabbt och fungerar utan nät med senast hämtade data
const CACHE = "loven-kollen-v3";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Alltid nätet först (färsk data och sida), cache bara som reserv
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    if (r.ok) caches.open(CACHE).then(c => c.put(url.pathname.endsWith("data.json") ? "data.json" : e.request, copy));
    return r;
  }).catch(() => caches.match(url.pathname.endsWith("data.json") ? "data.json" : e.request).then(m => m || caches.match("index.html"))));
});
