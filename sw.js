// Service worker de la webapp: permite instalarla y usarla sin conexión.
// - Solo guarda los archivos del propio sitio (nunca datos de credenciales ni imágenes externas).
// - Red primero: con conexión siempre se usa la versión publicada y se refresca la copia;
//   sin conexión se sirve la copia guardada.
// - VERSION la cambia el workflow de Pages en cada publicación: así el navegador detecta
//   que hay una versión nueva y la página ofrece actualizar.
const VERSION = "dev";
const CACHE = `ad-astra-${VERSION}`;
const ARCHIVOS = [
  "./", "index.html", "app.js", "style.css", "logo.png", "favicon.png", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "icon-maskable.png", "apple-touch-icon.png",
  "vendor/qrcode.min.js", "vendor/jsqr.min.js", "vendor/html2canvas.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
  // No se activa solo: espera a que la página lo pida (botón «Actualizar»), para no cambiar
  // la app a mitad de una credencial.
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k.startsWith("ad-astra-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "activar") self.skipWaiting();
  if (e.data === "version") e.source?.postMessage({ version: VERSION });
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return; // lo externo va directo a la red
  // index.html, app.js y style.css llevan ?v=<commit>: se guardan sin la consulta.
  const navegar = req.mode === "navigate";
  const clave = navegar ? new URL("index.html", self.registration.scope).href : url.origin + url.pathname;
  e.respondWith(
    // La página se revalida siempre (GitHub Pages la cachea ~10 min); el resto lleva ?v=<commit>.
    fetch(req, navegar ? { cache: "no-cache" } : {})
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(clave, copia));
        }
        return res;
      })
      .catch(async () => (await caches.match(clave, { ignoreSearch: true })) ?? (await caches.match(req, { ignoreSearch: true })) ?? Response.error())
  );
});
