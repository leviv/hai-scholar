// Offline support: network-first for the app's own files (so updates show up quickly),
// falling back to cache when offline. The PDF reader library from cdnjs is cached on first use.
const CACHE = "hai-scholar-v1";
const SHELL = [
  "./", "index.html", "css/app.css", "js/app.js", "js/store.js", "js/extract.js", "js/player.js",
  "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    try {
      const idx = await (await fetch("data/stages/index.json")).json();
      await c.addAll(["data/stages/index.json", ...idx.files.map((f) => `data/stages/${f}`)]);
    } catch { /* offline during install */ }
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) { if (k !== CACHE) { await caches.delete(k); } }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") { return; }
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const fresh = await fetch(e.request, { cache: "no-cache" });
        if (fresh.ok) { c.put(e.request, fresh.clone()); }
        return fresh;
      } catch {
        const hit = await c.match(e.request, { ignoreSearch: true });
        return hit || (await c.match("index.html")) || Response.error();
      }
    })());
    return;
  }
  if (url.hostname === "cdnjs.cloudflare.com") {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(e.request);
      if (hit) { return hit; }
      const fresh = await fetch(e.request);
      if (fresh.ok) { c.put(e.request, fresh.clone()); }
      return fresh;
    })());
  }
});
