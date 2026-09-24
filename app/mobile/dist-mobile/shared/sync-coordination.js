(function(root){
  "use strict";

  // Device hand-off coordination shared by the Windows app and the mobile web app.
  //
  // Two kinds of short-lived Drive objects are used. Both are stored as syncType "lease"
  // under sync/leases/ so the existing native list/delete commands accept them.
  //  - commit lease  (sync/leases/lease-*.json): held only while a commit is uploaded.
  //  - presence      (sync/leases/presence-*.json): "this device is editing / has unpublished
  //    edits". Other devices treat it as read-only until it disappears or expires.
  const LEASE_PREFIX="sync/leases/";
  const PRESENCE_PREFIX="sync/leases/presence-";
  const PRESENCE_TTL_MS=45000;
  const PRESENCE_RENEW_BEFORE_MS=20000;
  const PRESENCE_IDLE_GRACE_MS=4000;
  const COMMIT_LEASE_TTL_MS=90000;
  const YOUNG_FORK_MS=120000;

  const text=value=>String(value??"");
  const num=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:0};
  const safeId=value=>text(value).replace(/[^A-Za-z0-9_-]/g,"-").slice(0,48)||"device";
  const nonce=()=>{const bytes=new Uint8Array(4);(root.crypto||globalThis.crypto).getRandomValues(bytes);return [...bytes].map(byte=>byte.toString(16).padStart(2,"0")).join("")};
  const shortName=value=>{const trimmed=text(value).replace(/[\u0000-\u001f]/g,"").trim()||"기기";let out="";for(const ch of trimmed){if(new TextEncoder().encode(out+ch).byteLength>60)break;out+=ch}return out};

  function isPresence(object){return text(object?.syncType)==="lease"&&text(object?.objectKey).startsWith(PRESENCE_PREFIX)}
  function isCommitLease(object){return text(object?.syncType)==="lease"&&text(object?.objectKey).startsWith(LEASE_PREFIX)&&!isPresence(object)}

  function presenceObjectKey(deviceId){return `${PRESENCE_PREFIX}${safeId(deviceId)}-${nonce()}.json`}
  function presenceRecord({deviceId,displayName,clientProfile,sessionStartedAtMs,expiresAtMs,baseRevision=""}){
    const key=presenceObjectKey(deviceId),started=Math.max(1,Math.floor(num(sessionStartedAtMs))),expires=Math.max(started+1,Math.floor(num(expiresAtMs))),name=shortName(displayName);
    const content=JSON.stringify({format:"hamboard-sync-presence",formatVersion:1,deviceId:text(deviceId),displayName:name,clientProfile:text(clientProfile),sessionStartedAtMs:started,expiresAtMs:expires,baseRevision:text(baseRevision)});
    return {objectKey:key,content,syncMetadata:{syncType:"lease",revision:key.slice(LEASE_PREFIX.length,-5),baseRevision:text(baseRevision),deviceId:text(deviceId),displayName:name,clientProfile:text(clientProfile),createdAtMs:String(started),expiresAtMs:String(expires)}}
  }

  // Latest active presence per device.
  function activePresences(objects,now=Date.now()){
    const byDevice=new Map();
    for(const object of objects||[]){
      if(!isPresence(object)||num(object.expiresAtMs)<=now)continue;
      const deviceId=text(object.deviceId);if(!deviceId)continue;
      const previous=byDevice.get(deviceId);
      if(!previous||num(object.expiresAtMs)>num(previous.expiresAtMs))byDevice.set(deviceId,object)
    }
    return [...byDevice.values()].sort(comparePresence)
  }
  function comparePresence(a,b){return num(a?.createdAtMs)-num(b?.createdAtMs)||text(a?.deviceId).localeCompare(text(b?.deviceId))}

  // Returns the other device's presence that should make this device read-only, or null.
  // A device that started its editing session first keeps editing; later ones wait.
  function blockingPresence(objects,{deviceId,ownSessionStartedAtMs=0,ignore=null,now=Date.now()}={}){
    const self=text(deviceId),own=ownSessionStartedAtMs?{createdAtMs:ownSessionStartedAtMs,deviceId:self}:null;
    for(const other of activePresences(objects,now)){
      if(text(other.deviceId)===self)continue;
      if(ignore&&text(ignore.deviceId)===text(other.deviceId)&&num(ignore.sessionStartedAtMs)===num(other.createdAtMs))continue;
      if(!own||comparePresence(other,own)<0)return other
    }
    return null
  }

  function activeCommitLeases(objects,now=Date.now()){
    return (objects||[]).filter(object=>isCommitLease(object)&&num(object.expiresAtMs)>now).sort((a,b)=>num(a.createdAtMs)-num(b.createdAtMs)||text(a.deviceId).localeCompare(text(b.deviceId)))
  }
  function expiredLeaseObjects(objects,now=Date.now(),graceMs=60000){
    return (objects||[]).filter(object=>text(object?.syncType)==="lease"&&text(object?.objectKey).startsWith(LEASE_PREFIX)&&num(object.expiresAtMs)>0&&num(object.expiresAtMs)<now-graceMs)
  }

  // Deterministic winner among commits that share one base revision.
  function compareCommits(a,b){return num(a?.createdAtMs)-num(b?.createdAtMs)||text(a?.revision).localeCompare(text(b?.revision))}
  function siblingWinner(commits){return [...(commits||[])].sort(compareCommits)[0]||null}
  // A fork whose heads are all fresh siblings of one parent is expected to heal once the losing
  // device deletes its commit, so callers retry quickly instead of backing off for minutes.
  function isYoungSiblingFork(heads,now=Date.now()){
    const list=heads||[];if(list.length<2)return false;
    const base=text(list[0]?.baseRevision);
    return list.every(item=>text(item?.baseRevision)===base&&now-num(item?.createdAtMs)<YOUNG_FORK_MS)
  }


  // Shared commit/checkpoint topology used by both Windows and Mobile.
  // When multiple heads exist, a single head anchored to a retained checkpoint is canonical;
  // unrelated heads are reported as orphans instead of blocking the healthy chain.
  function commitTopology(objects,baseRevision=""){
    const commits=(objects||[]).filter(item=>item?.syncType==="commit"&&item.revision&&text(item.objectKey).startsWith("sync/commits/"));
    const checkpoints=(objects||[]).filter(item=>item?.syncType==="checkpoint"&&item.revision&&text(item.objectKey).startsWith("sync/checkpoints/"));
    const checkpointRevisions=new Set(checkpoints.map(item=>text(item.revision)).filter(Boolean)),byRevision=new Map();
    for(const item of commits){const revision=text(item.revision);if(byRevision.has(revision))return {error:"duplicate-revision",commits,checkpoints};byRevision.set(revision,item)}
    const parents=new Set(commits.map(item=>text(item.baseRevision)).filter(Boolean)),allHeads=commits.filter(item=>!parents.has(text(item.revision)));
    if(!commits.length)return {commits,checkpoints,heads:[],path:[],head:null,compacted:false,anchorRevision:"",orphanHeads:[],foundBase:!baseRevision,reachedRoot:true,chain:new Set()};
    const reachesCheckpoint=head=>{let cursor=head,seen=new Set();while(cursor){const revision=text(cursor.revision);if(seen.has(revision))return false;seen.add(revision);if(checkpointRevisions.has(revision))return true;const parent=text(cursor.baseRevision);if(!parent)return false;cursor=byRevision.get(parent);if(!cursor)return checkpointRevisions.has(parent)}return false};
    const anchoredHeads=allHeads.filter(reachesCheckpoint),heads=allHeads.length>1&&anchoredHeads.length===1?anchoredHeads:allHeads,orphanHeads=allHeads.filter(item=>!heads.includes(item));
    if(heads.length!==1)return {error:"branched-history",commits,checkpoints,heads:allHeads,orphanHeads,chain:new Set()};
    // `found` is set only when the base revision itself is met on the walk (or is the direct
    // parent of a retained commit). Stopping at a checkpoint never counts as finding the base:
    // commits between the base and that checkpoint are gone, so callers must rebuild from the
    // checkpoint instead of replaying `path` on top of their old base state.
    const head=heads[0],reverse=[],seen=new Set(),chain=new Set(),base=text(baseRevision);let cursor=head,found=!base,compacted=false,anchorRevision="",checkpointHits=0,reachedRoot=false;
    while(cursor){
      const revision=text(cursor.revision);if(seen.has(revision))return {error:"revision-cycle",commits,checkpoints,heads:allHeads,orphanHeads,chain};seen.add(revision);
      if(base&&revision===base){found=true;chain.add(revision);break}
      reverse.push(cursor);chain.add(revision);
      if(checkpointRevisions.has(revision)){checkpointHits++;if(checkpointHits>=2){anchorRevision=revision;compacted=true;break}}
      const parent=text(cursor.baseRevision);if(!parent){reachedRoot=true;break}
      const next=byRevision.get(parent);if(next){cursor=next;continue}
      chain.add(parent);
      // The base commit was garbage-collected but is the direct parent: path is still exactly base→head.
      if(base&&parent===base){found=true;anchorRevision=parent;compacted=true;break}
      if(checkpointRevisions.has(parent)){anchorRevision=parent;compacted=true;break}
      if(checkpointRevisions.has(revision)){anchorRevision=revision;compacted=true;break}
      return {error:"missing-parent",commits,checkpoints,heads:allHeads,head,orphanHeads,chain}
    }
    if(!found&&baseRevision)return {error:"base-revision-missing",commits,checkpoints,heads:allHeads,head,compacted,anchorRevision,orphanHeads,chain,reachedRoot};
    return {commits,checkpoints,heads:allHeads,head,path:reverse.reverse(),compacted,anchorRevision,orphanHeads,foundBase:found,reachedRoot,chain}
  }

  function deviceLabel(entry,ownDisplayName=""){
    const name=text(entry?.displayName)||"다른 기기",id=text(entry?.deviceId);
    return name===text(ownDisplayName)&&id?`${name} ·${id.replace(/[^A-Za-z0-9]/g,"").slice(-4)}`:name
  }

  root.HamboardSyncCoordination=Object.freeze({
    LEASE_PREFIX,PRESENCE_PREFIX,PRESENCE_TTL_MS,PRESENCE_RENEW_BEFORE_MS,PRESENCE_IDLE_GRACE_MS,COMMIT_LEASE_TTL_MS,YOUNG_FORK_MS,
    isPresence,isCommitLease,presenceObjectKey,presenceRecord,activePresences,blockingPresence,activeCommitLeases,expiredLeaseObjects,
    compareCommits,siblingWinner,isYoungSiblingFork,commitTopology,deviceLabel
  });
})(typeof globalThis!=="undefined"?globalThis:this);
