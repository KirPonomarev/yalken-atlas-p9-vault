const CACHE_NAME = "yalken-vault-fde617e9b891";
const CACHE_PREFIX = "yalken-vault-";
const scopeUrl = new URL(self.registration.scope);
const appPrefix = new URL("app/", scopeUrl).pathname;
const entryUrl = new URL("app/yalken-primary/index.html", scopeUrl).toString();

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const port = event.ports[0];
  event.waitUntil((async () => {
    try {
      if (event.data?.type === "status") {
        const cache = await caches.open(CACHE_NAME);
        port.postMessage({ ok: true, unlocked: Boolean(await cache.match(entryUrl)) });
        return;
      }
      if (event.data?.type !== "unlock" || !event.data.assets) throw new Error("invalid-message");
      await caches.delete(CACHE_NAME);
      const cache = await caches.open(CACHE_NAME);
      for (const [assetPath, asset] of Object.entries(event.data.assets)) {
        const [contentType, base64] = asset;
        const requestUrl = new URL("app" + assetPath, scopeUrl);
        await cache.put(requestUrl, new Response(decodeBase64(base64), {
          headers: { "Content-Type": contentType, "Cache-Control": "private, no-store" },
        }));
      }
      port.postMessage({ ok: true, unlocked: true });
    } catch (error) {
      port.postMessage({ ok: false, error: error.message || "unlock-failed" });
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(appPrefix)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(event.request, { ignoreSearch: true });
    if (response) return response;
    if (event.request.mode === "navigate") return Response.redirect(scopeUrl, 302);
    return new Response("Atlas is locked.", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  })());
});
