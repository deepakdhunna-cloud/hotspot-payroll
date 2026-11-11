/*
 * Hotspot service worker — makes the home-screen app launch fast and fail
 * gracefully, without ever serving stale payroll data.
 *
 *  - Pages (navigations): always fetched from the network, so every deploy
 *    and every number is current. With no connection, a branded offline
 *    screen is shown instead of the browser's error page.
 *  - /assets/*: Vite's content-hashed bundles never change once built, so
 *    they are served from cache after the first visit (instant launches).
 *  - Logo, icons and fonts: served from cache, refreshed in the background.
 *  - /api/*, /portal*, and everything cross-origin: never touched. Data,
 *    sign-in, exports and the kiosk's punches always go straight to the
 *    server.
 */
// Bump STATIC_CACHE's version whenever offline.html changes, so installed
// apps re-fetch it (it is cached once, at install).
const ASSET_CACHE = "hotspot-assets-v1";
const STATIC_CACHE = "hotspot-static-v1";
const OFFLINE_URL = "/offline.html";
const MAX_ASSET_ENTRIES = 150;

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(cache => cache.addAll([OFFLINE_URL, "/brand/hotspot-logo.png"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keep = new Set([ASSET_CACHE, STATIC_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith("hotspot-") && !keep.has(key))
          await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

function isBypassed(url) {
  return (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/portal" ||
    url.pathname.startsWith("/portal/") ||
    url.pathname.startsWith("/__manus__/") ||
    url.pathname === "/sw.js"
  );
}

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSET_ENTRIES; i++) {
    await cache.delete(keys[i]);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  const type = response.headers.get("content-type") || "";
  if (response.ok && response.type === "basic" && !type.includes("text/html")) {
    await cache.put(request, response.clone());
    trim(cache);
  }
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then(response => {
      if (response.ok && response.type === "basic") {
        return cache.put(event.request, response.clone()).then(() => response);
      }
      return response;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(
      refresh.then(
        () => undefined,
        () => undefined
      )
    );
    return hit;
  }
  return refresh.then(response => response || Response.error());
}

async function networkFirstPage(request) {
  try {
    return await fetch(request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    return (
      offline ||
      new Response("You're offline. Reconnect and try again.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isBypassed(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (
    url.pathname.startsWith("/brand/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/fonts/")
  ) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
