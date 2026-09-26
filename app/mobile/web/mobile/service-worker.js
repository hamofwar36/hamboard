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
  "./assets/fonts/Pretendard-Regular.woff2",
  "./assets/fonts/Pretendard-Bold.woff2",
  "./assets/fonts/SourceHanSerifKR-Regular-fullhangul.woff2",
  "./assets/fonts/SourceHanSerifKR-Bold-fullhangul.woff2",
  `./mobile.css${versionTag}`,
  `./shared/sync-state-model.js${versionTag}`,
  `./shared/cloud-payload.js${versionTag}`,
  `./shared/project-repository.js${versionTag}`,
  `./shared/sync-coordination.js${versionTag}`,
  `./vendor/lucide/lucide.min.js${versionTag}`,
  `./mobile-config.js${versionTag}`,
  `./mobile-google-drive.js${versionTag}`,
  `./mobile-asset-repository.js${versionTag}`,
  `./mobile-sync-engine.js${versionTag}`,
  `./mobile-app.js${versionTag}`
];
const cacheablePaths=new Set([
  "/manifest.webmanifest","/favicon.ico","/icons/hamboard-192.svg","/icons/hamboard-512.svg",
  "/assets/fonts/Pretendard-Regular.woff2","/assets/fonts/Pretendard-Bold.woff2","/assets/fonts/SourceHanSerifKR-Regular-fullhangul.woff2","/assets/fonts/SourceHanSerifKR-Bold-fullhangul.woff2",
  "/mobile.css","/shared/sync-state-model.js","/shared/project-repository.js","/shared/cloud-payload.js","/shared/sync-coordination.js",
  "/vendor/lucide/lucide.min.js","/mobile-config.js","/mobile-google-drive.js","/mobile-asset-repository.js","/mobile-sync-engine.js","/mobile-app.js"
]);

// Background publish. When the app is left with unsent edits, the page registers a one-off
// Background Sync ("hamboard-publish"). The browser runs it here even after the page is frozen or
// the screen is off, and retries it when the network returns. The page and this worker share the
// same IndexedDB state and sync bookkeeping; a Web Lock keeps them from syncing at the same time.
const PUBLISH_TAG="hamboard-publish",SYNC_LOCK="hamboard-mobile-sync",LOCK_WAIT_MS=45000,PUBLISH_ATTEMPTS=6;
let backgroundPublishReady=false;
try{
  self.window=self; // mobile-config.js assigns window.HAMBOARD_MOBILE_CONFIG
  importScripts(...[
    "./shared/sync-state-model.js","./shared/cloud-payload.js","./shared/project-repository.js","./shared/sync-coordination.js",
    "./mobile-config.js","./mobile-google-drive.js","./mobile-asset-repository.js","./mobile-sync-engine.js"
  ].map(path=>`${path}${versionTag}`));
  backgroundPublishReady=!!(self.HamboardMobileSyncEngine&&self.HamboardMobileGoogleDrive&&self.HamboardProjectRepository&&self.HamboardMobileAssetRepository&&self.navigator?.locks?.request);
}catch(error){backgroundPublishReady=false}

async function backgroundPublish(){
  if(!backgroundPublishReady)return {skipped:"unsupported"};
  // An app window in front syncs by itself.
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  if(windows.some(client=>client.visibilityState==="visible"))return {skipped:"app-visible"};
  const drive=self.HamboardMobileGoogleDrive,engineCore=self.HamboardMobileSyncEngine,assets=self.HamboardMobileAssetRepository;
  const storage=self.HamboardProjectRepository.createIndexedDbStateStorage({databaseName:"hamboard-mobile",storeName:"state",stateKey:"mobile-core"});
  const assetRepository=assets.createIndexedDbAssetRepository({databaseName:"hamboard-mobile-assets",storeName:"assets"});
  const uploader=assets.createMobileAssetUploader({drive,assetRepository,sha256Hex:bytes=>drive.sha256Hex(bytes)});
  let state=await storage.read();
  const engine=engineCore.createMobileSyncEngine({
    drive,syncModel:self.HamboardSyncStateModel,coordination:self.HamboardSyncCoordination,metaStore:engineCore.createIndexedDbMetaStore(),
    readLocal:()=>state,writeLocal:async next=>{state=next;await storage.write(next)},
    // This job retries on its own (and hands failures back to the browser), so the engine does not.
    writerId:"worker",backgroundRetry:false,exclusive:run=>self.navigator.locks.request(SYNC_LOCK,{signal:AbortSignal.timeout(LOCK_WAIT_MS)},run),
    displayName:"모바일",
    hooks:{
      reloadLocal:async()=>{state=await storage.read()},
      ensureConnected:async()=>{await drive.reconnectSilently().catch(()=>null);return drive.status().connected===true},
      beforeCommit:async({state:value})=>{await uploader.uploadReferenced(assets.collectStateAssetIds(value))},
      afterSync:async({pushed})=>{if(pushed?.committed)await uploader.markCommitted()}
    }
  });
  try{
    const status=await engine.init();
    if(!status.linked||status.suspended)return {skipped:"not-linked"};
    for(let attempt=0;attempt<PUBLISH_ATTEMPTS;attempt++){
      const result=await engine.sync("background");
      if(result?.synced&&!engine.pendingChanges().length){await engine.releaseStoredPresence();return result}
      // Throwing hands the job back to the browser, which retries later (e.g. when the network returns).
      if(result?.failed||result?.blocked||["offline","disconnected"].includes(result?.skipped))throw new Error(`background-publish-${result?.error||result?.blocked||result?.skipped}`);
      await new Promise(resolve=>setTimeout(resolve,Math.min(5000,Math.max(500,Number(result?.retryInMs)||1500))))
    }
    throw new Error("background-publish-incomplete")
  }finally{engine.stopPolling()}
}
self.addEventListener("sync",event=>{if(event.tag===PUBLISH_TAG)event.waitUntil(backgroundPublish())});

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
