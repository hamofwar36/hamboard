(function(root){
  "use strict";

  // Two-way sync for the mobile web app, speaking the same Drive protocol as the Windows app:
  // commits (sync/commits/*), checkpoints, commit leases and editing presence (sync/leases/*).
  //
  // Local model: the IndexedDB state is the mobile-core projection. `meta.baseState` is the
  // projection of the remote head we last reconciled with (`meta.baseRevision`). Pending local
  // changes are always diff(baseState, local), so nothing depends on in-memory flags surviving
  // a reload or a suspended tab.

  const META_VERSION=1;
  const CONFLICT_COPY_TYPES=new Set(["project","note","mindmap","calendar-event","character","quick-memo"]);
  const POLL_ACTIVE_MS=5000,POLL_READONLY_MS=5000,PUSH_DEBOUNCE_MS=300,PUSH_MAX_WAIT_MS=1500,LEASE_SETTLE_MS=600,PRESENCE_TICK_MS=1000,BACKGROUND_RETRY_LIMIT=5;

  const clone=value=>value===undefined?undefined:typeof structuredClone==="function"?structuredClone(value):JSON.parse(JSON.stringify(value));
  const text=value=>String(value??"");
  const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
  const uuid=()=>root.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;

  function createIndexedDbMetaStore({indexedDB=root.indexedDB,databaseName="hamboard-mobile",storeName="state",key="mobile-sync-meta"}={}){
    let databasePromise=null;
    const database=()=>{
      if(!indexedDB?.open)return Promise.reject(new Error("mobile-sync-meta-indexeddb-unavailable"));
      if(databasePromise)return databasePromise;
      databasePromise=new Promise((resolve,reject)=>{const request=indexedDB.open(databaseName,1);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(storeName))db.createObjectStore(storeName)};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error("mobile-sync-meta-open-failed"));request.onblocked=()=>reject(new Error("mobile-sync-meta-blocked"))}).catch(error=>{databasePromise=null;throw error});
      return databasePromise
    };
    const run=(mode,task)=>database().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction(storeName,mode),request=task(tx.objectStore(storeName));tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(tx.error||new Error("mobile-sync-meta-transaction-failed"));tx.onabort=()=>reject(tx.error||new Error("mobile-sync-meta-transaction-aborted"))}));
    return Object.freeze({read:()=>run("readonly",store=>store.get(key)).then(value=>value||null),write:value=>run("readwrite",store=>store.put(clone(value),key)),clear:()=>run("readwrite",store=>store.delete(key))})
  }
  function createMemoryMetaStore(initial=null){let value=clone(initial);return Object.freeze({read:async()=>clone(value),write:async next=>{value=clone(next)},clear:async()=>{value=null},peek:()=>clone(value)})}

  // ---- pure helpers ----------------------------------------------------------------------

  function entityRows(syncModel,profile,state){
    const projected=syncModel.projectCloudUserData(state||{},profile),rows=new Map();
    for(const [type,field] of profile.collections)for(const item of Array.isArray(projected[field])?projected[field]:[]){const id=text(item?.id);if(id)rows.set(`${type}:${id}`,{type,field,id,value:item})}
    if(profile.userLibrary)rows.set("user-library:main",{type:"user-library",field:"",id:"main",value:{tagLibrary:projected.tagLibrary||[],favorites:projected.favorites||[],workspace:syncModel.projectWorkspace(state||{},profile)}});
    return rows
  }
  function documentTitleKey(item){for(const key of ["title","name","label"])if(typeof item?.[key]==="string")return key;return ""}
  function conflictCopy(item,newId,nowIso){
    const copy=clone(item);copy.id=newId;const key=documentTitleKey(copy);
    if(key&&!copy[key].endsWith(" (충돌 복사본)"))copy[key]=`${copy[key]} (충돌 복사본)`;
    if("updatedAt" in copy)copy.updatedAt=nowIso;
    return copy
  }
  function setEntity(target,row,value,syncModel,profile,referenceOrder){
    if(row.type==="user-library"){target.tagLibrary=clone(value?.tagLibrary||[]);target.favorites=clone(value?.favorites||[]);syncModel.applyWorkspace(target,value?.workspace||{},profile);return}
    const list=Array.isArray(target[row.field])?target[row.field]:(target[row.field]=[]),index=list.findIndex(item=>text(item?.id)===row.id);
    if(!value){if(index>=0)list.splice(index,1);return}
    if(index>=0){list[index]=clone(value);return}
    const order=referenceOrder?.get(row.field)||[],position=order.indexOf(row.id);
    for(let cursor=position-1;cursor>=0;cursor--){const anchor=list.findIndex(item=>text(item?.id)===order[cursor]);if(anchor>=0){list.splice(anchor+1,0,clone(value));return}}
    list.push(clone(value))
  }
  function isRecord(value){return !!value&&typeof value==="object"&&!Array.isArray(value)}
  function mergeObject3(base,remote,local,path=""){
    if(same(local,remote))return {value:clone(local),conflicts:[]};
    if(same(local,base))return {value:clone(remote),conflicts:[]};
    if(same(remote,base))return {value:clone(local),conflicts:[]};
    if(isRecord(base)||isRecord(remote)||isRecord(local)){
      const B=isRecord(base)?base:{},R=isRecord(remote)?remote:{},L=isRecord(local)?local:{},value={},conflicts=[];
      for(const key of [...new Set([...Object.keys(B),...Object.keys(R),...Object.keys(L)])].sort()){
        const result=mergeObject3(B[key],R[key],L[key],path?`${path}.${key}`:key);
        if(result.value!==undefined)value[key]=result.value;
        conflicts.push(...result.conflicts)
      }
      return {value,conflicts}
    }
    return {value:clone(remote),conflicts:[path||"value"]}
  }
  function listIdentity(item,kind){
    if(kind==="tagLibrary")return `tag:${text(item)}`;
    if(kind==="favorites")return `fav:${text(item?.type)}:${text(item?.id)}`;
    if(isRecord(item)&&item.id)return `id:${text(item.id)}`;
    return `json:${JSON.stringify(item)}`
  }
  function mergeList3(base,remote,local,kind){
    const B=new Map((Array.isArray(base)?base:[]).map(item=>[listIdentity(item,kind),item])),R=new Map((Array.isArray(remote)?remote:[]).map(item=>[listIdentity(item,kind),item])),L=new Map((Array.isArray(local)?local:[]).map(item=>[listIdentity(item,kind),item]));
    // Order: if the remote side kept the base order, the local order wins; otherwise remote order wins.
    // Items that exist only on the other side keep their relative position at the end.
    const common=list=>list.filter(key=>B.has(key)&&R.has(key)&&L.has(key)),remoteReordered=!same(common([...R.keys()]),common([...B.keys()]));
    const primary=remoteReordered?[...R.keys()]:[...L.keys()],secondary=remoteReordered?[...L.keys()]:[...R.keys()];
    const keys=[...new Set([...primary,...secondary,...B.keys()])],value=[],conflicts=[];
    for(const key of keys){
      const b=B.get(key),r=R.get(key),l=L.get(key),bHas=B.has(key),rHas=R.has(key),lHas=L.has(key);
      if(rHas&&lHas){
        if(isRecord(r)&&isRecord(l)){const merged=mergeObject3(bHas?b:undefined,r,l,`${kind}.${key}`);value.push(merged.value);conflicts.push(...merged.conflicts)}
        else value.push(clone(r));
        continue
      }
      if(!bHas){if(rHas)value.push(clone(r));else if(lHas)value.push(clone(l));continue}
      if(rHas&&!lHas){if(same(r,b))continue;value.push(clone(r));conflicts.push(`${kind}.${key}`);continue}
      if(lHas&&!rHas){if(same(l,b))continue;value.push(clone(l));conflicts.push(`${kind}.${key}`);continue}
    }
    return {value,conflicts}
  }
  function mergeUserLibrary3(base,remote,local){
    const B=base||{},R=remote||{},L=local||{},tags=mergeList3(B.tagLibrary,R.tagLibrary,L.tagLibrary,"tagLibrary"),favorites=mergeList3(B.favorites,R.favorites,L.favorites,"favorites"),workspace=mergeObject3(B.workspace||{},R.workspace||{},L.workspace||{},"workspace");
    return {value:{tagLibrary:tags.value,favorites:favorites.value,workspace:workspace.value},conflicts:[...tags.conflicts,...favorites.conflicts,...workspace.conflicts]}
  }
  function mergeUserLibraryInitial(remote,local){
    const tags=[],tagSeen=new Set();for(const item of [...(remote?.tagLibrary||[]),...(local?.tagLibrary||[])]){const key=listIdentity(item,"tagLibrary");if(!tagSeen.has(key)){tagSeen.add(key);tags.push(clone(item))}}
    const favorites=[],favoriteSeen=new Set();for(const item of [...(remote?.favorites||[]),...(local?.favorites||[])]){const key=listIdentity(item,"favorites");if(!favoriteSeen.has(key)){favoriteSeen.add(key);favorites.push(clone(item))}}
    return {tagLibrary:tags,favorites,workspace:clone(remote?.workspace||{})}
  }

  // Three-way entity merge. `base` null means "first link": there is no common ancestor.
  function mergeStates({syncModel,profile,base,remote,local,initial=false,uploadLocalOnly=true,preserveInitialConflicts=true,newId=uuid,now=Date.now()}){
    const baseRows=initial?new Map():entityRows(syncModel,profile,base),remoteRows=entityRows(syncModel,profile,remote),localRows=entityRows(syncModel,profile,local);
    const merged=clone(local)||{},conflicts=[],remoteApplied=new Set(),keys=[...new Set([...baseRows.keys(),...remoteRows.keys(),...localRows.keys()])].sort(),nowIso=new Date(now).toISOString();
    const remoteOrder=new Map(profile.collections.map(([,field])=>[field,(Array.isArray(remote?.[field])?remote[field]:[]).map(item=>text(item?.id))]));
    const copies=[];
    for(const key of keys){
      const B=baseRows.get(key),R=remoteRows.get(key),L=localRows.get(key),row=R||L||B;
      if(same(L?.value,R?.value))continue;
      if(initial){
        if(!R){if(!uploadLocalOnly&&row.type!=="user-library"){setEntity(merged,row,null,syncModel,profile);remoteApplied.add(key)}continue}
        if(!L){setEntity(merged,row,R.value,syncModel,profile,remoteOrder);remoteApplied.add(key);continue}
        if(row.type==="user-library"){
          const value=preserveInitialConflicts?mergeUserLibraryInitial(R.value,L.value):clone(R.value);
          setEntity(merged,row,value,syncModel,profile,remoteOrder);remoteApplied.add(key);
          conflicts.push({key,type:row.type,id:row.id,kind:preserveInitialConflicts?"initial-merged":"initial-remote-kept"});continue
        }
        setEntity(merged,row,R.value,syncModel,profile,remoteOrder);remoteApplied.add(key);
        // A folder copy would be an empty folder that only preserves a name, so folders follow the
        // cloud and the phone's previous name is reported (notice + diagnostics) instead.
        if(row.type==="folder"){conflicts.push({key,type:row.type,id:row.id,kind:"initial-folder-cloud",localName:text(L.value?.name),cloudName:text(R.value?.name)});continue}
        // Trash entries: keep only the more recently deleted version (cloud on a tie), no copy.
        if(row.type==="trash"){
          const localAt=Date.parse(text(L.value?.deletedAt)),cloudAt=Date.parse(text(R.value?.deletedAt));
          const keepLocal=Number.isFinite(localAt)&&(!Number.isFinite(cloudAt)||localAt>cloudAt);
          if(keepLocal)setEntity(merged,row,L.value,syncModel,profile,remoteOrder);
          conflicts.push({key,type:row.type,id:row.id,kind:"initial-trash-newer",kept:keepLocal?"local":"cloud"});continue
        }
        if(preserveInitialConflicts){copies.push({row,value:conflictCopy(L.value,newId(),nowIso)});conflicts.push({key,type:row.type,id:row.id,kind:"initial-copy"})}
        else conflicts.push({key,type:row.type,id:row.id,kind:"initial-remote-kept"});
        continue
      }
      if(same(L?.value,B?.value)){setEntity(merged,row,R?R.value:null,syncModel,profile,remoteOrder);remoteApplied.add(key);continue}
      if(same(R?.value,B?.value))continue;
      if(row.type==="user-library"&&B&&R&&L){
        const result=mergeUserLibrary3(B.value,R.value,L.value);setEntity(merged,row,result.value,syncModel,profile,remoteOrder);remoteApplied.add(key);
        if(result.conflicts.length)conflicts.push({key,type:row.type,id:row.id,kind:"field-conflict-remote-kept",fields:result.conflicts});
        else conflicts.push({key,type:row.type,id:row.id,kind:"field-merged"});
        continue
      }
      if(L&&R&&!CONFLICT_COPY_TYPES.has(row.type)){
        const result=mergeObject3(B?.value,R.value,L.value,row.type);setEntity(merged,row,result.value,syncModel,profile,remoteOrder);remoteApplied.add(key);
        if(result.conflicts.length)conflicts.push({key,type:row.type,id:row.id,kind:"field-conflict-remote-kept",fields:result.conflicts});
        else conflicts.push({key,type:row.type,id:row.id,kind:"field-merged"});
        continue
      }
      // Both sides changed the same document differently: remote keeps the id, local survives as a copy.
      setEntity(merged,row,R?R.value:null,syncModel,profile,remoteOrder);remoteApplied.add(key);
      if(L&&CONFLICT_COPY_TYPES.has(row.type)){copies.push({row,value:conflictCopy(L.value,newId(),nowIso)});conflicts.push({key,type:row.type,id:row.id,kind:R?"both-modified-copy":"remote-deleted-copy"})}
      else conflicts.push({key,type:row.type,id:row.id,kind:L?"remote-kept":"local-deleted-remote-modified"})
    }
    for(const copy of copies){const list=Array.isArray(merged[copy.row.field])?merged[copy.row.field]:(merged[copy.row.field]=[]);list.push(copy.value)}
    return {merged,conflicts,remoteApplied,copies:copies.length}
  }

  function topology(objects,baseRevision=""){
    const shared=root.HamboardSyncCoordination;
    if(!shared?.commitTopology)throw new Error("sync-topology-helper-missing");
    const result=shared.commitTopology(objects,baseRevision);
    if(baseRevision&&["base-revision-missing","missing-parent"].includes(result?.error)){
      const fallback=shared.commitTopology(objects,"");
      // The base is no longer reachable: rebuild the remote head from a checkpoint (foundBase:false),
      // then 3-way merge against the old base. Never replay `path` on top of the old base state.
      // Rebuildable when a checkpoint is on the head's chain, or the chain is complete from the root
      // (e.g. the cloud sync history was reset). Same cases the Windows rebaseline recovers from.
      if(!fallback.error&&fallback.head&&(fallback.reachedRoot||fallback.checkpoints?.some(item=>fallback.chain?.has(text(item.revision)))))return {...fallback,foundBase:false,compacted:true,recoveredMissingBase:true}
    }
    return result
  }

  // ---- engine ----------------------------------------------------------------------------

  function createMobileSyncEngine({drive,syncModel,coordination,metaStore,readLocal,writeLocal,hooks={},displayName="모바일",now=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timers={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)},online=()=>root.navigator?.onLine!==false,log=()=>{},exclusive=run=>run(),writerId="page",backgroundRetry=true}={}){
    if(!drive||!syncModel||!coordination||!metaStore||!readLocal||!writeLocal)throw new Error("mobile-sync-engine-dependencies-missing");
    const profile=syncModel.CLIENT_PROFILES.mobileCore,desktop=syncModel.CLIENT_PROFILES.desktop;
    let meta=null,running=null,rerun=false,pollTimer=0,pushTimer=0,pushFirstAt=0,presenceTimer=0,presenceBusy=null,ownPresence=null,remoteLocks=new Map(),lastLocalEditAt=0,writeSeq=0,cleanSeq=0,polling=false,backgroundRetries=0,lastResult=null,failureCount=0,pauseRequested=false,suspendPromise=null;

    const emit=(name,detail)=>{try{hooks.onStatus?.(name,detail)}catch{}};
    const saveMeta=async()=>{await metaStore.write(meta)};
    const deviceId=()=>text(meta?.deviceId);
    const linked=()=>!!meta?.linked&&!meta?.suspended;
    const connected=()=>drive.status?.().connected===true;

    async function init(){
      meta=await metaStore.read();
      if(meta&&meta.version!==META_VERSION)meta=null;
      if(!meta){meta={version:META_VERSION,deviceId:`mobile-${uuid()}`,linked:false,suspended:"",baseRevision:"",baseState:null,lastSyncAtMs:0};await saveMeta()}
      // Edits made before a reload or while the tab was frozen are still pending.
      if(linked()&&pendingChanges().length){writeSeq=1;cleanSeq=0}
      return status()
    }
    // The page and the service worker (background publish) run separate engines over the same stores.
    // `exclusive` (a Web Lock) keeps them from syncing at the same time; each section starts from what
    // the other one saved, and a local-state write by the other side is reloaded before continuing.
    // A read-only return probe never queues behind this engine's own running cycle (it would hold the
    // user at the gate for a whole upload); it only waits when the other side (the worker) holds the lock.
    let exclusiveDepth=0;
    function runExclusive(run,kind="cycle"){
      if(kind==="probe"&&exclusiveDepth>0)return run();
      return exclusive(async()=>{exclusiveDepth++;try{return await run()}finally{exclusiveDepth--}})
    }
    async function refreshFromStore(){
      const stored=await metaStore.read();
      if(!stored||stored.version!==META_VERSION||!meta||text(stored.deviceId)!==deviceId())return false;
      const otherWrote=text(stored.localWriter)&&text(stored.localWriter)!==writerId&&Number(stored.localWriteAt||0)!==Number(meta.localWriteAt||0);
      meta=stored;
      if(otherWrote){await hooks.reloadLocal?.();log("info","local-reloaded",{writer:text(stored.localWriter)})}
      return otherWrote
    }
    function status(){return {linked:!!meta?.linked,suspended:text(meta?.suspended)||(pauseRequested?"pausing":""),deviceId:deviceId(),baseRevision:text(meta?.baseRevision),lastSyncAtMs:Number(meta?.lastSyncAtMs)||0,locks:linked()?[...remoteLocks.keys()]:[],dirty:linked()&&(writeSeq!==cleanSeq||!!pushTimer),busy:!!running,ownPresence:!!ownPresence}}
    // Another device is editing this document (project, note or mindmap): it stays read-only here.
    function documentLock(key){if(!linked())return null;const lock=remoteLocks.get(text(key));return lock?clone(lock):null}
    function clearRemoteLocks(){if(!remoteLocks.size)return;remoteLocks=new Map();emit("locks",new Map())}
    function lockedDocuments(){return linked()?new Map([...remoteLocks].map(([key,lock])=>[key,clone(lock)])):new Map()}
    function pendingChanges(state=readLocal()){if(!meta?.linked)return [];return syncModel.diffClientProjection(meta.baseState||{},state,profile)}

    // -- reading remote ------------------------------------------------------------------
    async function listTopology(){const listing=await drive.listSyncTopology();if(listing?.truncated)throw new Error("sync-object-list-truncated");return Array.isArray(listing?.objects)?listing.objects:[]}
    // Commits are immutable per revision; the return check and the pull that follows read the same ones.
    const commitCache=new Map();
    async function readCommit(object){
      const cacheKey=`${text(object?.revision)}:${text(object?.remoteObjectId)}`;
      if(commitCache.has(cacheKey))return clone(commitCache.get(cacheKey));
      const commit=await fetchCommit(object);
      commitCache.set(cacheKey,clone(commit));
      while(commitCache.size>64)commitCache.delete(commitCache.keys().next().value);
      return commit
    }
    async function fetchCommit(object){
      const commit=await drive.getSyncValue(object);
      if(commit?.format!=="hamboard-sync-commit"||commit?.formatVersion!==1||commit?.stateSchemaVersion!==1||text(commit.revision)!==text(object.revision)||text(commit.baseRevision)!==text(object.baseRevision)||!Array.isArray(commit.changes))throw new Error("sync-commit-header-invalid");
      const commitProfile=syncModel.clientProfileForCommit(commit),profileId=syncModel.clientProfileId(commitProfile);
      if(object.clientProfile&&text(object.clientProfile)!==profileId)throw new Error("sync-commit-client-profile-mismatch");
      syncModel.validateClientChanges(commit.changes,commitProfile);
      for(const change of commit.changes){if(change?.operation!=="upsert")continue;const hash=await drive.sha256Hex(new TextEncoder().encode(JSON.stringify(change.payload)));if(hash!==text(change.payloadSha256))throw new Error("sync-commit-payload-hash-mismatch")}
      commit.clientProfile=profileId;return commit
    }
    async function readCommits(path){const out=[];for(const object of path)out.push(await readCommit(object));return out}
    async function rebuildRemote(objects,topo){
      const checkpoints=(objects||[]).filter(item=>item?.syncType==="checkpoint"&&text(item.objectKey).startsWith("sync/checkpoints/")&&topo.chain.has(text(item.revision)));
      const order=new Map(topo.path.map((item,index)=>[text(item.revision),index]));
      checkpoints.sort((a,b)=>(order.has(text(b.revision))?order.get(text(b.revision)):-1)-(order.has(text(a.revision))?order.get(text(a.revision)):-1)||Number(b.createdAtMs||0)-Number(a.createdAtMs||0));
      let canonical=null,startIndex=0;
      for(const object of checkpoints){
        try{
          const checkpoint=await drive.getSyncValue(object);
          if(checkpoint?.format!=="hamboard-sync-checkpoint"||checkpoint?.formatVersion!==1||text(checkpoint.revision)!==text(object.revision)||!checkpoint.state||typeof checkpoint.state!=="object")throw new Error("sync-checkpoint-header-invalid");
          canonical=syncModel.applyCloudUserData({},checkpoint.state,desktop);
          startIndex=order.has(text(object.revision))?order.get(text(object.revision))+1:0;break
        }catch(error){log("warn","checkpoint-rejected",error)}
      }
      if(!canonical){if(!topo.reachedRoot)throw new Error("sync-history-incomplete");canonical={schemaVersion:1}}
      for(const commit of await readCommits(topo.path.slice(startIndex)))canonical=syncModel.applyCommitToCanonical(canonical,commit);
      return syncModel.projectCanonicalState(canonical,profile)
    }
    async function remoteAtHead(objects,topo){
      if(topo.foundBase&&!topo.recoveredMissingBase&&meta.baseState){let state=clone(meta.baseState);for(const commit of await readCommits(topo.path))state=syncModel.applyCommitToClientState(state,commit,profile).state;return {state,rebuilt:false}}
      return {state:await rebuildRemote(objects,topo),rebuilt:true}
    }

    // -- presence -------------------------------------------------------------------------
    // Presences name one document; only that document is locked on other devices. Presences from
    // older versions (no document) lock nothing.
    function updateRemotePresence(objects){
      const locks=coordination.documentLocks(objects,{deviceId:deviceId(),own:ownPresence,now:now()});
      const changed=[...locks].map(([key,lock])=>`${key}=${text(lock.objectKey)}`).sort().join("|")!==[...remoteLocks].map(([key,lock])=>`${key}=${text(lock.objectKey)}`).sort().join("|");
      remoteLocks=locks;
      if(changed)emit("locks",lockedDocuments());
      // Another device claimed this document first: stop claiming it here.
      if(ownPresence?.documentKey&&locks.has(ownPresence.documentKey))releasePresence("earlier-editor-elsewhere").catch(()=>{});
      return locks
    }
    async function publishPresence(reason,documentKey=ownPresence?.documentKey||""){
      documentKey=coordination.lockableDocumentKey(documentKey);if(!documentKey)return null;
      if(presenceBusy)return presenceBusy.then(current=>current?.documentKey===documentKey?current:publishPresence(reason,documentKey));
      const sameDocument=ownPresence?.documentKey===documentKey;
      presenceBusy=(async()=>{
        try{
          // A new document starts a new claim; renewing keeps the start so the earlier editor keeps winning.
          const sessionStartedAtMs=sameDocument&&ownPresence?.sessionStartedAtMs||now(),record=coordination.presenceRecord({deviceId:deviceId(),displayName,clientProfile:"mobile-core",sessionStartedAtMs,expiresAtMs:now()+coordination.PRESENCE_TTL_MS,baseRevision:text(meta?.baseRevision),documentKey});
          const uploaded=await drive.putSyncText({objectKey:record.objectKey,content:record.content,syncMetadata:record.syncMetadata});
          const previous=ownPresence;ownPresence={...uploaded,documentKey,sessionStartedAtMs,expiresAtMs:Number(record.syncMetadata.expiresAtMs)};
          if(meta){meta.presence=clone(ownPresence);await saveMeta().catch(()=>{})}
          if(previous?.remoteObjectId)drive.deleteSyncObject(previous).catch(error=>log("warn","presence-previous-delete-deferred",error));
          log("info","presence-published",{reason,documentKey});startPresenceTicker();return ownPresence
        }catch(error){log("warn","presence-publish-failed",error);return null}
        finally{presenceBusy=null}
      })();
      return presenceBusy
    }
    async function releasePresence(reason){
      if(presenceBusy)await presenceBusy;
      const presence=ownPresence;ownPresence=null;if(!presence)return false;
      if(meta?.presence){meta.presence=null;await saveMeta().catch(()=>{})}
      try{await drive.deleteSyncObject(presence);log("info","presence-released",{reason});return true}catch(error){log("warn","presence-release-deferred",error);return false}
    }
    function dirty(){return writeSeq!==cleanSeq||!!pushTimer||!!hooks.hasPendingSaves?.()}
    // Presence promises "my edits arrive shortly". While cycles fail or are blocked they will not,
    // so do not keep the other device read-only on their account.
    function uploadBlocked(){return !!(lastResult&&(lastResult.failed||lastResult.blocked))}
    async function presenceTick(){
      if(!ownPresence){if(!presenceBusy)stopPresenceTicker();return "none"}
      if(uploadBlocked()){await releasePresence(lastResult.failed?"sync-failing":"sync-blocked");return "release"}
      const t=now();
      if(!dirty()&&t-lastLocalEditAt>=coordination.PRESENCE_IDLE_GRACE_MS){await releasePresence("quiet-and-published");return "release"}
      if(ownPresence.expiresAtMs-t<coordination.PRESENCE_RENEW_BEFORE_MS){await publishPresence("renew");return "renew"}
      return "keep"
    }
    let presenceTicking=null;
    function startPresenceTicker(){if(presenceTimer)return;const loop=()=>{presenceTimer=timers.setTimeout(async()=>{if(!presenceTicking)presenceTicking=presenceTick().catch(error=>log("warn","presence-tick-failed",error)).finally(()=>{presenceTicking=null});await presenceTicking;if(presenceTimer&&(ownPresence||presenceBusy))loop();else stopPresenceTicker()},PRESENCE_TICK_MS)};loop()}
    function stopPresenceTicker(){if(presenceTimer){timers.clearTimeout(presenceTimer);presenceTimer=0}}

    // -- local writes ---------------------------------------------------------------------
    // documentKey: the document the user edited, when the write changed it. The first edit publishes a
    // presence for it so other devices keep that one document read-only until the edit is uploaded.
    function notifyLocalWrite(documentKey=""){
      if(!linked()||pauseRequested)return;
      writeSeq++;lastLocalEditAt=now();
      const key=coordination.lockableDocumentKey(documentKey);
      if(key&&!remoteLocks.has(key)&&ownPresence?.documentKey!==key&&!uploadBlocked()&&connected()&&online())publishPresence("local-edit",key);
      schedulePush()
    }
    function schedulePush(delay=PUSH_DEBOUNCE_MS){
      const t=now();if(!pushFirstAt)pushFirstAt=t;
      const wait=Math.max(0,Math.min(delay,PUSH_MAX_WAIT_MS-(t-pushFirstAt)));
      if(pushTimer)timers.clearTimeout(pushTimer);
      pushTimer=timers.setTimeout(()=>{pushTimer=0;pushFirstAt=0;sync("local-edit").catch(()=>{})},wait)
    }

    // -- pull + merge ---------------------------------------------------------------------
    async function pull(objects){
      const topo=topology(objects,meta.baseRevision);
      if(topo.error){const healing=topo.error==="branched-history"&&coordination.isYoungSiblingFork(topo.heads,now());return {blocked:topo.error,retryInMs:healing?3000:60000}}
      if(!topo.head||text(topo.head.revision)===text(meta.baseRevision))return {changed:false};
      const remote=await remoteAtHead(objects,topo),local=readLocal(),localSeq=writeSeq;
      const result=mergeStates({syncModel,profile,base:meta.baseState,remote:remote.state,local,now:now()});
      if(writeSeq!==localSeq)return {deferred:"local-edit",retryInMs:400};
      const changed=!same(result.merged,local);
      if(changed){await writeLocal(result.merged,{reason:"remote-apply",remoteApplied:result.remoteApplied,conflicts:result.conflicts});meta.localWriter=writerId;meta.localWriteAt=now()}
      meta.baseRevision=text(topo.head.revision);meta.baseState=remote.state;meta.lastSyncAtMs=now();await saveMeta();
      if(result.conflicts.length)emit("conflicts",result.conflicts);
      log("info","remote-applied",{revision:meta.baseRevision,rebuilt:remote.rebuilt,conflicts:result.conflicts.length});
      return {changed,conflicts:result.conflicts.length,revision:meta.baseRevision}
    }

    // -- push -----------------------------------------------------------------------------
    async function acquireLease(objects){
      const busy=coordination.activeCommitLeases(objects,now()).find(item=>text(item.deviceId)!==deviceId());if(busy)return null;
      const leaseId=`lease-${uuid()}`,created=now(),expires=created+coordination.COMMIT_LEASE_TTL_MS;
      const lease=await drive.putSyncText({objectKey:`${coordination.LEASE_PREFIX}${leaseId}.json`,content:JSON.stringify({format:"hamboard-sync-lease",formatVersion:1,leaseId,deviceId:deviceId(),displayName,createdAtMs:created,expiresAtMs:expires}),syncMetadata:{syncType:"lease",revision:leaseId,baseRevision:"",deviceId:deviceId(),displayName,clientProfile:"mobile-core",createdAtMs:String(created),expiresAtMs:String(expires)}});
      await sleep(LEASE_SETTLE_MS);
      const refreshed=await listTopology(),winner=coordination.activeCommitLeases(refreshed,now())[0];
      if(winner&&text(winner.deviceId)!==deviceId()){await drive.deleteSyncObject(lease).catch(()=>{});return null}
      return {lease,objects:refreshed}
    }
    async function push(objects){
      const snapshot=readLocal(),seq=writeSeq,changes=pendingChanges(snapshot);
      if(!changes.length){cleanSeq=seq;return {synced:true,changes:0}}
      // Images this state references must be on Drive before a commit that points at them is published.
      emit("pushing",{changes:changes.length});
      await hooks.beforeCommit?.({state:snapshot,changes});
      emit("committing",{changes:changes.length});
      const held=await acquireLease(objects);if(!held)return {skipped:"lease",retryInMs:1500};
      try{
        const headNow=topology(held.objects,meta.baseRevision);
        if(headNow.error||(headNow.head&&text(headNow.head.revision)!==text(meta.baseRevision)))return {rerun:"remote-moved"};
        const revision=`rev-${uuid()}`,createdAtMs=now(),baseRevision=text(meta.baseRevision);
        const commitChanges=[];for(const change of changes)commitChanges.push({entityType:change.entityType,entityId:change.entityId,operation:change.operation,payload:change.operation==="upsert"?change.payload:null,payloadSha256:change.operation==="upsert"?await drive.sha256Hex(new TextEncoder().encode(JSON.stringify(change.payload))):null});
        const commit={format:"hamboard-sync-commit",formatVersion:1,stateSchemaVersion:1,revision,baseRevision,deviceId:deviceId(),clientProfile:"mobile-core",createdAtMs,imageQuality:"balanced",changes:commitChanges};
        syncModel.validateClientChanges(commit.changes,profile);
        const uploaded=await drive.putSyncValue({objectKey:`sync/commits/${revision}.json`,value:commit,syncMetadata:{syncType:"commit",revision,baseRevision,deviceId:deviceId(),displayName,clientProfile:"mobile-core",createdAtMs:String(createdAtMs),expiresAtMs:"0",quality:"balanced"}});
        const verify=await listTopology(),siblings=verify.filter(item=>item?.syncType==="commit"&&text(item.baseRevision)===baseRevision&&text(item.revision)!==revision);
        if(siblings.length){
          const own=verify.find(item=>item?.syncType==="commit"&&text(item.revision)===revision)||{revision,createdAtMs:String(createdAtMs)},winner=coordination.siblingWinner([own,...siblings]);
          if(text(winner?.revision)!==revision){await drive.deleteSyncObject(uploaded);log("warn","concurrent-commit-withdrawn",{revision,winner:text(winner?.revision)});return {deferred:"concurrent-commit-lost",retryInMs:1500}}
        }
        meta.baseRevision=revision;meta.baseState=clone(snapshot);meta.lastSyncAtMs=now();await saveMeta();
        cleanSeq=seq;log("info","commit-uploaded",{revision,changes:commitChanges.length});
        return {synced:true,committed:revision,changes:commitChanges.length}
      }finally{await drive.deleteSyncObject(held.lease).catch(error=>log("warn","lease-release-deferred",error))}
    }

    // -- cycle ----------------------------------------------------------------------------
    async function cycle(reason,{pullOnly=false}={}){
      let phase="preflight";
      try{
        if(pauseRequested)return {skipped:"suspended"};
        if(!meta?.linked)return {skipped:"not-linked"};
        if(meta.suspended)return {skipped:"suspended"};
        // Offline or disconnected, nothing tells us another device is still editing: nothing stays locked.
        if(!online()){clearRemoteLocks();return {skipped:"offline"}}
        if(!connected()){phase="reconnect";const reconnected=await hooks.ensureConnected?.().catch(error=>{log("warn","reconnect-failed",{reason,error});return false});if(!reconnected||!connected()){clearRemoteLocks();return {skipped:"disconnected"}}}
        // A presence stored by an earlier page session (or one the page left when it was hidden) is stale here.
        if(meta?.presence&&!ownPresence&&!presenceBusy)await releaseStoredPresence("stale-presence-cleanup");
        phase="flush-local-saves";await hooks.flushPendingSaves?.();
        for(let attempt=0;attempt<3;attempt++){
          phase="list-remote";const objects=await listTopology();updateRemotePresence(objects);
          phase="pull-remote";const pulled=await pull(objects);if(pulled.blocked||pulled.deferred)return {...pulled,phase};
          // Return check: the latest remote state is applied; this device's own upload follows right after.
          if(pullOnly){const pushDeferred=pendingChanges().length>0;return {synced:true,pulled:pulled.changed===true,conflicts:pulled.conflicts||0,pushDeferred,reason,...(pushDeferred?{retryInMs:PUSH_DEBOUNCE_MS}:{})}}
          phase="push-local";const pushed=await push(objects);if(pushed.rerun)continue;
          if(pushed.synced&&hooks.afterSync){phase="after-sync";await Promise.resolve(hooks.afterSync({state:readLocal(),pushed})).catch(error=>log("warn","after-sync-hook-failed",{reason,error}))}
          return {...pushed,pulled:pulled.changed===true,conflicts:pulled.conflicts||0,reason}
        }
        return {deferred:"remote-busy",retryInMs:1500,phase}
      }catch(error){
        log("error","sync-cycle-failed",{reason,phase,error});
        // The public result retains the original message for existing UI error handling.
        return {failed:true,error:text(error?.message||error),phase,reason}
      }
    }
    function sync(reason="manual",options={}){
      if(pauseRequested)return Promise.resolve({skipped:"suspended"});
      if(running){rerun=true;return running}
      rerun=false;
      const operation=runExclusive(async()=>{await refreshFromStore();return cycle(reason,options)}).then(result=>{
        if(result.failed){
          failureCount++;
          const throttled=/429|rate.limit|quota/i.test(result.error||"");
          result={...result,retryInMs:throttled?60000:Math.min(60000,5000*2**Math.min(failureCount-1,4))}
        }else if(result.skipped==="offline"||result.skipped==="disconnected")result={...result,retryInMs:10000};
        else if(result.synced)failureCount=0;
        lastResult=result;emit("result",result);return result
      },error=>{failureCount++;const result={failed:true,error:text(error?.message||error),retryInMs:Math.min(60000,5000*2**Math.min(failureCount-1,4))};lastResult=result;log("error","sync-failed",error);emit("result",result);return result});
      // Regular polls run only while polling (page visible). A rerun or retry still runs while hidden when
      // this device has edits left to upload, so a failed or deferred upload is not dropped until the next
      // visit; a few attempts only, since a hidden page may linger for hours.
      running=operation.finally(()=>{
        running=null;const again=rerun;rerun=false;const retry=Number(lastResult?.retryInMs)||0;
        if(lastResult?.synced&&!pendingChanges().length)backgroundRetries=0;
        if(!polling){if(!backgroundRetry||!(again||retry)||backgroundRetries>=BACKGROUND_RETRY_LIMIT||!pendingChanges().length)return;backgroundRetries++}
        if(again)schedulePoll(Math.max(250,retry));else if(retry)schedulePoll(retry);else schedulePoll(pollInterval())
      });
      return running
    }

    // -- polling & lifecycle --------------------------------------------------------------
    function pollInterval(){return remoteLocks.size?POLL_READONLY_MS:POLL_ACTIVE_MS}
    function schedulePoll(delay){if(pauseRequested||!linked())return;if(pollTimer)timers.clearTimeout(pollTimer);pollTimer=timers.setTimeout(()=>{pollTimer=0;sync("poll").catch(()=>{})},Math.max(0,delay))}
    function startPolling({immediate=true}={}){if(pauseRequested||!linked())return;polling=true;backgroundRetries=0;if(immediate)schedulePoll(0);else if(!pollTimer)schedulePoll(pollInterval())}
    function stopPolling(){polling=false;if(pollTimer){timers.clearTimeout(pollTimer);pollTimer=0}}

    // Read-only check for the return gate: one listing, no waiting on a running cycle, no upload.
    // It also refreshes which documents other devices are editing (those stay read-only on their own;
    // the return check never waits for another device).
    async function probeReturn(){
      if(!meta?.linked)return {skipped:"not-linked"};
      if(meta.suspended||pauseRequested)return {skipped:"suspended"};
      if(!online())return {skipped:"offline"};
      if(!connected()){const reconnected=await hooks.ensureConnected?.().catch(()=>false);if(!reconnected||!connected())return {skipped:"disconnected"}}
      const objects=await listTopology();updateRemotePresence(objects);
      const topo=topology(objects,meta.baseRevision);
      if(topo.error||topo.recoveredMissingBase)return {needsPull:true,why:topo.error||"base-missing"};
      // Commits after our base made by this device (an upload that is still finishing) are not news.
      const remoteCommits=(topo.path||[]).filter(item=>text(item.deviceId)!==deviceId()).length;
      if(!remoteCommits)return {upToDate:true};
      // Windows also commits utilities, work tracking and its home workspace, which this phone never keeps.
      // Commits that change nothing here are applied quietly instead of holding the user at the gate.
      if(topo.foundBase&&!topo.recoveredMissingBase&&meta.baseState){
        try{
          let state=clone(meta.baseState);
          for(const commit of await readCommits(topo.path))state=syncModel.applyCommitToClientState(state,commit,profile).state;
          if(same(state,meta.baseState))return {upToDate:true,irrelevantRemote:remoteCommits}
        }catch(error){log("warn","return-probe-classify-failed",error)}
      }
      return {needsPull:true,why:"remote-commits",remoteCommits}
    }
    async function checkOnReturn({onPulling=()=>{},isCancelled=()=>false}={}){
      for(;;){
        if(isCancelled())return {cancelled:true};
        let probe;
        try{probe=await runExclusive(async()=>{await refreshFromStore();return probeReturn()},"probe")}catch(error){log("error","return-probe-failed",{error});return {failed:true,error:text(error?.message||error),phase:"return-probe"}}
        if(isCancelled())return {cancelled:true};
        if(probe.skipped)return probe;
        // Up to date: let the user in; anything this device has not uploaded goes in a normal cycle.
        if(probe.upToDate){if(probe.irrelevantRemote)schedulePoll(0);else if(pendingChanges().length)schedulePush(0);return {synced:true,upToDate:true,...(probe.irrelevantRemote?{irrelevantRemote:probe.irrelevantRemote}:{})}}
        // Another device changed something: apply it first (pull only, after any running cycle).
        if(running){
          await running;
          if(isCancelled())return {cancelled:true};
          // An upload already in flight may have pulled this revision while we waited.
          probe=await runExclusive(async()=>probeReturn(),"probe");
          if(isCancelled())return {cancelled:true};
          if(probe.skipped)return probe;
          if(probe.upToDate)return {synced:true,upToDate:true}
        }
        onPulling(probe);
        const result=await sync("return",{pullOnly:true});
        if(isCancelled())return {cancelled:true};
        return result
      }
    }
    // Background publisher: once everything is uploaded, withdraw the editing presence the page left
    // behind so other devices do not keep waiting for its time-out.
    async function releaseStoredPresence(reason="background-published"){
      const presence=meta?.presence;if(!presence?.remoteObjectId)return false;
      try{await drive.deleteSyncObject(presence);meta.presence=null;await saveMeta();log("info","presence-released",{reason});return true}
      catch(error){log("warn","presence-release-deferred",error);return false}
    }

    // Leaving the page: publish now and, if nothing is left, withdraw presence right away.
    async function leave(){
      if(!linked())return {skipped:true};
      if(pushTimer){timers.clearTimeout(pushTimer);pushTimer=0;pushFirstAt=0}
      const result=await sync("leave");
      if(!dirty())await releasePresence("left-clean");
      return result
    }

    // First link (or re-link) with the cloud. uploadLocalOnly decides what happens to documents
    // that exist only on this device.
    async function link({uploadLocalOnly=true,confirm=null}={}){
      if(running)await running;
      await hooks.flushPendingSaves?.();
      const objects=await listTopology(),topo=topology(objects,"");
      if(topo.error)throw new Error(`sync-import-${topo.error}`);
      const local=readLocal();
      if(!topo.head){meta={...meta,linked:true,suspended:"",baseRevision:"",baseState:{schemaVersion:1},lastSyncAtMs:now()};await saveMeta();writeSeq++;return sync("link")}
      const remote=await rebuildRemote(objects,topo);
      const preview=mergeStates({syncModel,profile,base:null,remote,local,initial:true,uploadLocalOnly:true,preserveInitialConflicts:true,now:now()});
      const localRows=entityRows(syncModel,profile,local),remoteRows=entityRows(syncModel,profile,remote);
      const localOnly=[...localRows.keys()].filter(key=>key!=="user-library:main"&&!remoteRows.has(key));
      const differing=[...new Set([...localRows.keys(),...remoteRows.keys()])].filter(key=>localRows.has(key)&&remoteRows.has(key)&&!same(localRows.get(key)?.value,remoteRows.get(key)?.value));
      let upload=uploadLocalOnly,preserveConflicts=true;
      if(confirm&&(localOnly.length||differing.length)){
        // Folders never become copies (see mergeStates), so they are not counted as copy candidates.
        const copyCandidates=differing.filter(key=>key!=="user-library:main"&&!key.startsWith("folder:")&&!key.startsWith("trash:")).length;
        const decision=(localOnly.length||copyCandidates)?await confirm({localOnly:localOnly.length,copies:copyCandidates,differences:differing.length}):true;
        if(decision===null)return {cancelled:true};
        if(decision&&typeof decision==="object"){upload=decision.uploadLocalOnly!==false;preserveConflicts=decision.preserveConflicts!==false}
        else upload=decision!==false
      }
      const result=upload&&preserveConflicts?preview:mergeStates({syncModel,profile,base:null,remote,local,initial:true,uploadLocalOnly:upload,preserveInitialConflicts:preserveConflicts,now:now()});
      await writeLocal(result.merged,{reason:"link",remoteApplied:result.remoteApplied,conflicts:result.conflicts});
      meta={...meta,linked:true,suspended:"",baseRevision:text(topo.head.revision),baseState:remote,lastSyncAtMs:now()};await saveMeta();pauseRequested=false;
      writeSeq++;
      const synced=await sync("link");
      const foldersFollowedCloud=result.conflicts.filter(item=>item.kind==="initial-folder-cloud").map(item=>({id:item.id,localName:item.localName,cloudName:item.cloudName}));
      return {...synced,linked:true,localOnly:localOnly.length,uploadedLocalOnly:!!upload,conflicts:result.conflicts.length,conflictCopies:result.copies||0,preservedInitialConflicts:!!preserveConflicts,foldersFollowedCloud}
    }
    // Cloud wins; used to leave "suspended" after a backup/file restore on this device.
    async function resetFromCloud(){
      if(running)await running;
      const objects=await listTopology(),topo=topology(objects,"");
      if(topo.error)throw new Error(`sync-import-${topo.error}`);
      const remote=topo.head?await rebuildRemote(objects,topo):{schemaVersion:1};
      await writeLocal(clone(remote),{reason:"reset",remoteApplied:new Set(["*"]),conflicts:[]});
      meta={...meta,linked:true,suspended:"",baseRevision:text(topo.head?.revision),baseState:remote,lastSyncAtMs:now()};await saveMeta();pauseRequested=false;
      cleanSeq=writeSeq;
      return sync("reset")
    }
    function suspend(reason){
      if(suspendPromise)return suspendPromise;
      // Block new cycles immediately, then drain the one already in progress before a restore writes state.
      // Capture what is running *before* stopping it, so a failed pause can restore exactly that.
      const wasPolling=polling,hadScheduledPush=!!pushTimer,previousMeta=meta;
      pauseRequested=true;stopPolling();rerun=false;
      if(pushTimer){timers.clearTimeout(pushTimer);pushTimer=0;pushFirstAt=0}
      const operation=(async()=>{
        try{
          if(running)await running;
          await hooks.flushPendingSaves?.();
          meta={...meta,suspended:text(reason)||"suspended"};await saveMeta();
        }catch(error){
          // Could not record the pause: undo it completely so sync keeps working as before.
          meta=previousMeta;pauseRequested=false;
          // Edits flushed while the pause was pending were not announced (notifyLocalWrite is muted
          // during a pause), so re-arm them together with the upload that the pause cancelled.
          const hasPending=pendingChanges().length>0;
          if(hasPending&&writeSeq===cleanSeq)writeSeq++;
          if(hasPending||hadScheduledPush)schedulePush(0);
          if(wasPolling)startPolling({immediate:false});
          log("warn","suspend-failed-sync-restored",{hasPending,wasPolling});
          throw error
        }
        await releasePresence("suspended");stopPresenceTicker();remoteLocks=new Map();emit("locks",new Map());
        return status()
      })();
      const shared=operation.finally(()=>{if(suspendPromise===shared)suspendPromise=null});suspendPromise=shared;return shared
    }
    // Undo suspend(reason) when the restore that requested it failed before replacing local state.
    // A different or older suspension (e.g. an earlier restore that did apply) is left alone.
    async function resume(reason){
      if(suspendPromise)await suspendPromise.catch(()=>{});
      if(!meta?.linked){pauseRequested=false;return status()}
      if(reason&&meta.suspended&&meta.suspended!==text(reason))return status();
      meta={...meta,suspended:""};await saveMeta();pauseRequested=false;
      if(pendingChanges().length){writeSeq++;lastLocalEditAt=now()}
      log("info","sync-resumed",{reason:text(reason)});
      return status()
    }
    async function unlink(){stopPolling();if(pushTimer){timers.clearTimeout(pushTimer);pushTimer=0;pushFirstAt=0}await releasePresence("unlink");meta={...meta,linked:false,suspended:"",baseRevision:"",baseState:null};remoteLocks=new Map();await saveMeta();pauseRequested=false;emit("locks",new Map());return status()}

    return Object.freeze({init,status,documentLock,lockedDocuments,pendingChanges,notifyLocalWrite,sync,startPolling,stopPolling,checkOnReturn,leave,link,resetFromCloud,suspend,resume,unlink,releasePresence,releaseStoredPresence,reloadFromStore:()=>runExclusive(refreshFromStore),_presenceTick:presenceTick})
  }

  root.HamboardMobileSyncEngine=Object.freeze({createMobileSyncEngine,createIndexedDbMetaStore,createMemoryMetaStore,mergeStates,topology,entityRows});
})(typeof globalThis!=="undefined"?globalThis:this);
