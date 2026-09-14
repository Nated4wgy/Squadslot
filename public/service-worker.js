const cacheName = "squadslot-shell-v4";
const shellAssets = [
  "/",
  "/manifest.webmanifest",
  "/squadslot-logo-transparent.png",
  "/squadslot-icon.png",
  "/squadslot-192.png",
  "/squadslot-512.png"
];

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Use the default notification. */ }
  event.waitUntil(self.registration.showNotification(String(payload.title || "SquadSlot").slice(0, 100), {
    body: String(payload.body || "You have a SquadSlot update.").slice(0, 300),
    icon: "/squadslot-192.png", badge: "/squadslot-192.png",
    tag: String(payload.tag || "squadslot-update").slice(0, 100),
    data: { url: "/?view=events" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL("/?view=events", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url); await existing.focus(); }
    else { await self.clients.openWindow(url); }
  })());
});

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shellAssets)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== "GET"
    || requestUrl.origin !== self.location.origin
    || requestUrl.pathname.startsWith("/api/")
  ) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") return caches.match("/");
        return new self.Response(null, { status: 503, statusText: "Offline" });
      })
  );
});
