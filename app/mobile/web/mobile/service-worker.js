const params=new URL(self.location.href).searchParams;
const version=params.get("v")||"dev";
const cacheName=`hamboard-mobile-${version}`;
const versionTag=`?v=${encodeURIComponent(version)}`;
const core=[
  "./",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./icons/hamboard-192.svg",
  "./icons/hamboard-512.svg",
  `./mobile.css${versionTag}`,
  `./shared/sync-state-model.js${versionTag}`,
  `./shared/cloud-payload.js${versionTag}`,
  `./shared/project-repository.js${versionTag}`,
  `./vendor/lucide/lucide.min.js${versionTag}`,
  `./mobile-config.js${versionTag}`,
  `./mobile-google-drive.js${versionTag}`,
  `./mobile-asset-repository.js${versionTag}`,
  `./mobile-app.js${versionTag}`
];
const cacheablePaths=new Set([
  "/manifest.webmanifest","/favicon.ico","/icons/hamboard-192.svg","/icons/hamboard-512.svg",
  "/mobile.css","/shared/sync-state-model.js","/shared/project-repository.js","/shared/cloud-payload.js",
  "/vendor/lucide/lucide.min.js","/mobile-config.js","/mobile-google-drive.js","/mobile-asset-repository.js","/mobile-app.js"
]);

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(core)).then(()=>self.skipWaiting()))
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key.startsWith("hamboard-mobile-")&&key!==cacheName).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  )
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  if(request.mode==="navigate"){
    event.respondWith(
      fetch(request)
        .then(response=>{
          if(response.ok)caches.open(cacheName).then(cache=>cache.put("./",response.clone()));
          return response
        })
        .catch(()=>caches.match("./"))
    );
    return
  }

  if(!cacheablePaths.has(url.pathname))return;
  event.respondWith(
    fetch(request)
      .then(response=>{
        if(response.ok)caches.open(cacheName).then(cache=>cache.put(request,response.clone()));
        return response
      })
      .catch(()=>caches.match(request))
  )
});
