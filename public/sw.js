// sw.js: the service worker that makes IoBot work offline.
//
// Two strategies:
//   - App files (HTML, CSS, JS, icons): "cache first". They rarely change, so
//     loading them from the device is instant. Bump VERSION to ship an update.
//   - Data (/api/...): "network first". Always try to get the latest schedule,
//     but if campus Wi-Fi is down, fall back to the last copy we saved.

const VERSION = "iobot-v7";
const APP_FILES = [
  "/", "/index.html", "/styles.css", "/manifest.webmanifest",
  "/js/app.js", "/js/time.js", "/js/day.js", "/js/data.js", "/js/settings.js",
  "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

// Delete caches from older versions.
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
