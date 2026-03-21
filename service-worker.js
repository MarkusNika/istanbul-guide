const CACHE_NAME = "istanbul-guide-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./data/guide.json"
];

// Install: App-Shell cachen
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: alte Caches entfernen
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch-Strategie:
// - Für App-Shell / lokale Dateien: network first, fallback cache
// - Für alles andere: cache first / fallback fetch
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Nur GET behandeln
  if (event.request.method !== "GET") return;

  // GitHub Pages / lokale Dateien bevorzugt mit Network-First,
  // damit Updates nach Push recht schnell ankommen
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(cached => {
            if (cached) return cached;
            return caches.match("./index.html");
          })
        )
    );
    return;
  }

  // Externe Requests
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
