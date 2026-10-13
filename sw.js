/**
 * Service Worker for Offline PWA Support.
 * Caches local application assets so the E-ink flasher works without internet connectivity.
 */

const CACHE_NAME_IDENTIFIER = "eink-esl-web-v12";
const OFFLINE_CACHED_ASSET_COLLECTION = [
  "./",
  "./index.html",
  "./style.css",
  "./protocol.js",
  "./dither.js",
  "./ble.js",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", (installationEvent) => {
  installationEvent.waitUntil(
    caches.open(CACHE_NAME_IDENTIFIER).then((openedCache) => {
      return openedCache.addAll(OFFLINE_CACHED_ASSET_COLLECTION);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (activationEvent) => {
  activationEvent.waitUntil(
    caches.keys().then((cacheKeyList) => {
      return Promise.all(
        cacheKeyList.map((existingCacheKey) => {
          if (existingCacheKey !== CACHE_NAME_IDENTIFIER) {
            return caches.delete(existingCacheKey);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (networkFetchEvent) => {
  networkFetchEvent.respondWith(
    caches.match(networkFetchEvent.request).then((cachedResponse) => {
      return cachedResponse || fetch(networkFetchEvent.request);
    })
  );
});
