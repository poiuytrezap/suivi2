/* Service worker : rend l'appli utilisable hors-ligne.
 * Coquille en cache-first (elle change rarement), Pyodide mis en cache
 * opportunistement au premier chargement : ~6 Mo telecharges une seule fois.
 */
const V = "suivi-v1";
const SHELL = ["./","./index.html","./app.js","./engine.js","./manifest.webmanifest"];

self.addEventListener("install", e=>{
  // cache.addAll() est atomique : une seule ressource manquante et
  // l'installation entiere echoue, sans le moindre message. On met en cache
  // fichier par fichier pour qu'un absent ne fasse pas tomber le reste.
  e.waitUntil((async ()=>{
    const c = await caches.open(V);
    await Promise.all(SHELL.map(u => c.add(u).catch(err =>
      console.warn("SW : mise en cache impossible", u, err))));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(
    ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e=>{
  const u = e.request.url;
  if(e.request.method !== "GET") return;
  // Pyodide et les polices : cache-first, ce sont des assets immuables.
  const cdn = u.includes("cdn.jsdelivr.net/pyodide") || u.includes("fonts.g");
  e.respondWith(
    caches.match(e.request).then(hit=>{
      if(hit) return hit;
      return fetch(e.request).then(res=>{
        if(res.ok && (cdn || u.startsWith(self.location.origin))){
          const cp = res.clone();
          caches.open(V).then(c=>c.put(e.request, cp));
        }
        return res;
      }).catch(()=> hit || Response.error());
    })
  );
});
