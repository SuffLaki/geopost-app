/* GeoPost - Service Worker: die App vollständig offline bereithalten.
   VERSION beim Ändern hochzählen, damit Geräte die neue Fassung laden. */

const VERSION = "geopost-app-v3";
const DATEIEN = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/style.css",
  "./assets/app.js",
  "./assets/exif.js",
  "./assets/icons/icon-180.png",
  "./assets/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((s) => s.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((namen) => Promise.all(namen.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const adresse = new URL(e.request.url);
  if (adresse.origin !== self.location.origin) return;   // Ortsnamen nie aus dem Speicher
  e.respondWith(
    caches.match(e.request).then((treffer) => treffer || fetch(e.request).then((antwort) => {
      if (antwort && antwort.ok) {
        const kopie = antwort.clone();
        caches.open(VERSION).then((s) => s.put(e.request, kopie));
      }
      return antwort;
    }).catch(() => caches.match("./index.html")))
  );
});
