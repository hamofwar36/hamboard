import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

// Exercises the real desktop functions (extracted from web/index.html) that implement the
// device hand-off: fast publish, editing presence, read-only, return gate and poll timing.
const root=new URL("../",import.meta.url);
const html=await readFile(new URL("web/index.html",root),"utf8");
const coordinationSource=await readFile(new URL("web/shared/sync-coordination.js",root),"utf8");
function functionSource(name){
  const start=html.search(new RegExp(`^(?:async )?function ${name}\\(`,"m"));
  assert.ok(start>=0,`function ${name} exists`);
  const rest=html.slice(start),end=rest.slice(1).search(/\n(?:async )?function |\n(?:const|let) /);
  return end<0?rest:rest.slice(0,end+1)
}
const constantsLine=html.split("\n").find(line=>line.startsWith("const SYNC_PROTOCOL_VERSION=1,"));
assert.ok(constantsLine,"sync constants line");
function context(extra={},names=[]){
  const ctx=vm.createContext({console,TextEncoder,Date,Math,JSON,Promise,setTimeout,clearTimeout,setInterval,clearInterval,crypto:globalThis.crypto,...extra});
  vm.runInContext(coordinationSource,ctx);ctx.SyncCoordination=ctx.HamboardSyncCoordination;
  vm.runInContext(constantsLine.replace(/^const /,"var "),ctx);
  for(const name of names)vm.runInContext(functionSource(name).replace(/^(async )?function /,"$1function "),ctx);
  return ctx
}
const checks=[];async function check(name,run){await run();checks.push(name);console.log("  PASS",name)}
const log={info(){},warn(){},error(){}};
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));

await check("publish timing: 250ms debounce, 1.5s cap while typing continuously, 5s in front (even idle), 30s in the background",async()=>{
  assert.match(constantsLine,/SYNC_POLL_INTERVAL_MS=5000/);assert.match(constantsLine,/SYNC_OUTBOX_DEBOUNCE_MS=250/);assert.match(constantsLine,/SYNC_OUTBOX_MAX_WAIT_MS=1500/);assert.match(constantsLine,/SYNC_READONLY_POLL_INTERVAL_MS=5000/);assert.match(constantsLine,/SYNC_BACKGROUND_POLL_INTERVAL_MS=30000/);
  let prepared=0,scheduled=[];
  let presenceChecks=0;
  const ctx=context({safeRunAsync:(label,task)=>task(),SyncRepository:{prepareOutbox:async()=>{prepared++;return {}}},scheduleAutomaticSync:delay=>scheduled.push(delay),syncPresenceAfterLocalWrite:async()=>{presenceChecks++;return false},DiagnosticsLog:log},["scheduleSyncOutboxPreparation","syncMarkLocalWrite"]);
  vm.runInContext("var syncOutboxTimer=0,syncOutboxFirstRequestAt=0,syncLocalWriteSincePrepare=false,syncLastLocalWriteAt=0,syncInternalStateWrite=false",ctx);
  // Keystrokes every 200ms for 3s: the cap forces a preparation before typing stops.
  const started=Date.now();while(Date.now()-started<3000){ctx.syncMarkLocalWrite();ctx.scheduleSyncOutboxPreparation();await tick(200)}
  assert.ok(prepared>=1,"prepared at least once during continuous typing");assert.ok(presenceChecks>=1,"a local edit checks whether to mark its document as being edited");assert.ok(scheduled.every(delay=>delay===250));
  vm.runInContext("syncInternalStateWrite=true",ctx);assert.equal(ctx.syncMarkLocalWrite(),false,"internal writes do not count as edits");
  let focused=true;const poll=context({navigator:{onLine:true},document:{hidden:false,hasFocus:()=>focused}},["syncUserIdle","syncDesiredPollInterval"]);
  vm.runInContext("var syncCloudKnownConnected=true,syncRemoteLease=null,syncReturnGate=false,syncLastUserInputAt=Date.now()",poll);
  assert.equal(poll.syncDesiredPollInterval(),5000);
  vm.runInContext("syncLastUserInputAt=Date.now()-25*60000",poll);assert.equal(poll.syncDesiredPollInterval(),5000,"a PC left open in front keeps seeing other devices' edits within seconds");
  focused=false;assert.equal(poll.syncDesiredPollInterval(),30000,"a window in the background polls every 30s");focused=true;
  vm.runInContext("syncRemoteLease={deviceId:'x'}",poll);assert.equal(poll.syncDesiredPollInterval(),5000,"read-only uses the foreground interval")
});

// Document-level locks: another device's presence names one document; only that one is read-only here.
const presenceObject=({deviceId,documentKey="",createdAtMs=Date.now()-1000,expiresAtMs=Date.now()+40000,name="presence"})=>({syncType:"lease",objectKey:`sync/leases/presence-${deviceId}-${name}.json`,deviceId,displayName:"휴대폰",createdAtMs:String(createdAtMs),expiresAtMs:String(expiresAtMs),...(documentKey?{assetId:documentKey}:{})});
function lockContext({view="note:n1"}={}){
  const banners=[],notices=[];let current=view;
  const ctx=context({DiagnosticsLog:log,safeRunAsync:(label,task)=>Promise.resolve().then(task),toast:message=>notices.push(message),document:{getElementById:()=>null,body:{classList:{add(){},remove(){}},appendChild(){}},createElement:()=>({style:{},setAttribute(){}})},
    splitDocumentKey:snapshot=>snapshot,sessionViewSnapshot:()=>current,currentViewName:()=>"note"},
    ["syncUpdateRemotePresence","syncCurrentDocumentKey","syncCurrentDocumentLock","syncRefreshDocumentLock","syncNoticeDocumentLocked","syncClearDocumentLocks"]);
  vm.runInContext("var syncRemoteLease=null,syncRemoteDocLocks=new Map(),syncOwnPresence=null,syncReadonlyNoticeAt=0",ctx);
  ctx.syncSetReadonly=lease=>{ctx.syncRemoteLease=lease||null;banners.push(lease?String(lease.assetId||""):null)};
  ctx.syncReleasePresence=async reason=>{ctx.released=reason;ctx.syncOwnPresence=null};
  return {ctx,banners,notices,view:key=>{current=key}}
}

await check("presence from an older version (no document) locks nothing",async()=>{
  const {ctx}=lockContext();vm.runInContext("syncRemoteLease={deviceId:'old-phone'}",ctx);
  assert.equal(ctx.syncUpdateRemotePresence([presenceObject({deviceId:"mobile-old"})],{deviceId:"device-me"}),null);
  assert.equal(ctx.syncRemoteDocLocks.size,0);assert.equal(ctx.syncRemoteLease,null,"an older phone's editing marker no longer locks this PC")
});

await check("another device editing a note locks that note only; other documents stay editable",async()=>{
  const {ctx,banners,view}=lockContext({view:"note:n1"});
  const lock=ctx.syncUpdateRemotePresence([presenceObject({deviceId:"mobile-phone",documentKey:"note:n1"})],{deviceId:"device-me"});
  assert.equal(lock?.assetId,"note:n1","the open note is read-only");assert.deepEqual([...ctx.syncRemoteDocLocks.keys()],["note:n1"]);assert.equal(banners.at(-1),"note:n1");
  view("note:n2");assert.equal(ctx.syncRefreshDocumentLock(),null,"another note opened on this PC is editable");assert.equal(ctx.syncRemoteLease,null);assert.equal(banners.at(-1),null,"banner removed");
  view("project:p1");assert.equal(ctx.syncRefreshDocumentLock(),null,"a project is editable");
  view("note:n1");assert.equal(ctx.syncRefreshDocumentLock()?.assetId,"note:n1","going back to the note shows the lock again");
  ctx.syncUpdateRemotePresence([],{deviceId:"device-me"});assert.equal(ctx.syncRemoteLease,null,"the lock lifts when the phone's presence is gone");
  ctx.syncUpdateRemotePresence([presenceObject({deviceId:"mobile-phone",documentKey:"note:n1",expiresAtMs:Date.now()-1})],{deviceId:"device-me"});assert.equal(ctx.syncRemoteLease,null,"an expired presence locks nothing");
  ctx.syncUpdateRemotePresence([presenceObject({deviceId:"mobile-phone",documentKey:"note:n1",expiresAtMs:Date.now()+10*60000})],{deviceId:"device-me"});assert.equal(ctx.syncRemoteLease,null,"a presence from a clock far ahead is not trusted to lock for minutes");
  ctx.syncUpdateRemotePresence([presenceObject({deviceId:"mobile-phone",documentKey:"folder:f1"})],{deviceId:"device-me"});assert.equal(ctx.syncRemoteDocLocks.size,0,"only projects, notes and mindmaps can be locked")
});

await check("the same document claimed on two devices: the earlier editor keeps it, the later one gives up its claim",async()=>{
  const {ctx}=lockContext({view:"mindmap:m1"});const now=Date.now();
  ctx.syncOwnPresence={objectKey:"sync/leases/presence-me.json",documentKey:"mindmap:m1",sessionStartedAtMs:now-5000,expiresAtMs:now+40000};
  assert.equal(ctx.syncUpdateRemotePresence([presenceObject({deviceId:"mobile-phone",documentKey:"mindmap:m1",createdAtMs:now-1000})],{deviceId:"device-me"}),null,"this PC started first and keeps editing");
  assert.equal(ctx.released,undefined);
  ctx.syncUpdateRemotePresence([presenceObject({deviceId:"mobile-phone",documentKey:"mindmap:m1",createdAtMs:now-9000})],{deviceId:"device-me"});await tick(0);
  assert.equal(ctx.syncRemoteLease?.assetId,"mindmap:m1","the phone started first: read-only here");assert.equal(ctx.released,"earlier-editor-elsewhere")
});

await check("offline or disconnected, nothing stays locked",async()=>{
  const {ctx}=lockContext();ctx.syncUpdateRemotePresence([presenceObject({deviceId:"mobile-phone",documentKey:"note:n1"})],{deviceId:"device-me"});
  ctx.syncClearDocumentLocks();assert.equal(ctx.syncRemoteDocLocks.size,0);assert.equal(ctx.syncRemoteLease,null);
  const run=functionSource("runAutomaticSync");assert.match(run,/if\(navigator\.onLine===false\)\{syncClearDocumentLocks\(\)/);assert.match(run,/if\(!driveStatus\?\.connected\)\{syncClearDocumentLocks\(\)/)
});

await check("presence names the edited document, only after typing, and never for a document another device holds",async()=>{
  const puts=[],deletes=[];let pending=[{entityType:"note",entityId:"n1",operation:"upsert"}],current="note:n1",lastEdit=Date.now();
  const ctx=context({DiagnosticsLog:log,safeRunAsync:(label,task)=>Promise.resolve().then(task),navigator:{onLine:true},document:{hidden:false,hasFocus:()=>true},
    SyncRepository:{listPending:async()=>structuredClone(pending),device:async()=>({deviceId:"device-me",displayName:"작업 PC"}),runtime:async()=>({baseRevision:"rev-1"})},
    GoogleDriveService:{putObject:async request=>{puts.push(request);return {}},deleteSyncObject:async object=>{deletes.push(object.objectKey);return {}}},
    syncRemoteObjectRequest:object=>object,syncJsonSha256:async()=>"0".repeat(64),syncStartPresenceTicker:()=>{},splitDocumentKey:snapshot=>snapshot,sessionViewSnapshot:()=>current,currentViewName:()=>"note",
    syncEntityKey:(type,id)=>`${type}:${id}`},
    ["syncPresenceAfterLocalWrite","syncEnsurePresence","syncUploadBlocked","syncUserEditingNow","syncWindowFocused","syncCurrentDocumentKey"]);
  vm.runInContext("var syncAppUpdateInProgress=false,syncConflictBlocked=false,syncAutomaticFailureCount=0,syncCloudKnownConnected=true,syncRemoteDocLocks=new Map(),syncOwnPresence=null,syncPresencePromise=null,SYNC_PRESENCE_INPUT_WINDOW_MS=5000",ctx);
  ctx.syncLastEditInputAt=lastEdit;
  assert.equal(await ctx.syncPresenceAfterLocalWrite(),true);
  assert.equal(puts.length,1);assert.equal(puts[0].syncMetadata.assetId,"note:n1","the presence names the note");assert.equal(JSON.parse(puts[0].content).documentKey,"note:n1");
  const firstStart=ctx.syncOwnPresence.sessionStartedAtMs;
  // Same document again: no new object until renewal is due.
  assert.equal(await ctx.syncPresenceAfterLocalWrite(),true);assert.equal(puts.length,1);
  // Editing another document moves the claim there, with a new start.
  await tick(2);current="project:p1";pending=[{entityType:"project",entityId:"p1",operation:"upsert"}];
  assert.equal(await ctx.syncPresenceAfterLocalWrite(),true);assert.equal(puts.length,2);assert.equal(puts[1].syncMetadata.assetId,"project:p1");
  assert.ok(ctx.syncOwnPresence.sessionStartedAtMs>firstStart,"a new document is a new claim");await tick(0);assert.equal(deletes.length,1,"the note's presence is withdrawn");
  // A folder, the calendar or a memo never publish a presence.
  current="";assert.equal(await ctx.syncPresenceAfterLocalWrite(),false);
  // The open document changed only somewhere else (e.g. an automatic write to another item): no presence.
  current="note:n7";assert.equal(await ctx.syncPresenceAfterLocalWrite(),false);
  // Another device holds this document: this PC does not claim it.
  current="note:n1";pending=[{entityType:"note",entityId:"n1",operation:"upsert"}];ctx.syncRemoteDocLocks=new Map([["note:n1",{deviceId:"mobile-phone"}]]);
  assert.equal(await ctx.syncPresenceAfterLocalWrite(),false);assert.equal(puts.length,2);
  // Nobody typing (reminders, widgets): no presence.
  ctx.syncRemoteDocLocks=new Map();ctx.syncLastEditInputAt=Date.now()-60000;assert.equal(await ctx.syncPresenceAfterLocalWrite(),false)
});

await check("only writes that change a locked document are refused; other documents save normally",async()=>{
  const modelSource=await readFile(new URL("web/shared/sync-state-model.js",root),"utf8");
  const notices=[];let rendered=0;
  const stored={schemaVersion:1,notes:[{id:"n1",title:"폰에서 수정 중"},{id:"n2",title:"다른 노트"}],projects:[{id:"p1",title:"작품"}],folders:[],mindmaps:[],trash:[]};
  const ctx=context({DiagnosticsLog:log,toast:message=>notices.push(message),setTimeout:fn=>{rendered++;return 0},readState:value=>value,cloneData:value=>structuredClone(value),INITIAL_STATE:{schemaVersion:1},
    StateRepository:{snapshot:()=>structuredClone(stored)},syncRenderCurrentState:()=>{},normalizeSyncWorkTracking:value=>value,isDataRecord:value=>!!value&&typeof value==="object"&&!Array.isArray(value)},
    ["syncGuardStateWrite","syncChangedEntityKeys","syncStateEntityMap","syncClientProfile","syncEntityKey","syncNoticeDocumentLocked","syncWorkspaceSnapshot","dataRecords"]);
  vm.runInContext(modelSource,ctx);vm.runInContext("var SyncStateModel=HamboardSyncStateModel,SYNC_CLIENT_PROFILES=SyncStateModel.CLIENT_PROFILES,backupRestoreBlocksWrites=false,syncConflictResolutionWrite=false,syncInternalStateWrite=false,syncReadonlyNoticeAt=0,state=null",ctx);
  vm.runInContext("var syncRemoteDocLocks=new Map([['note:n1',{deviceId:'mobile-phone',displayName:'휴대폰',assetId:'note:n1'}]])",ctx);
  const edit=fn=>{const next=structuredClone(stored);fn(next);return next};
  assert.equal(ctx.syncGuardStateWrite(edit(s=>{s.notes[1].title="이 PC에서 고침"})),true,"another note saves");
  assert.equal(ctx.syncGuardStateWrite(edit(s=>{s.projects[0].title="작품 수정"})),true,"a project saves");
  assert.equal(ctx.syncGuardStateWrite(edit(s=>{s.folders.push({id:"f1",name:"새 폴더"})})),true,"a folder saves");
  assert.equal(notices.length,0);
  assert.equal(ctx.syncGuardStateWrite(edit(s=>{s.notes[0].title="덮어쓰기"})),false,"the locked note is refused");
  assert.equal(ctx.state.notes[0].title,"폰에서 수정 중","memory goes back to the saved note");assert.match(notices[0],/휴대폰.*읽기 전용/);
  assert.equal(ctx.syncGuardStateWrite(edit(s=>{s.trash.push({id:"t1",type:"note",item:s.notes[0]});s.notes.splice(0,1)})),false,"moving the locked note to the trash is refused as a whole");
  vm.runInContext("syncInternalStateWrite=true",ctx);assert.equal(ctx.syncGuardStateWrite(edit(s=>{s.notes[0].title="원격 반영"})),true,"applying the other device's edits is allowed")
});

await check("commit lease handling never toggles read-only and settles before checking the winner",async()=>{
  const source=functionSource("syncEnsureLease");assert.doesNotMatch(source,/syncSetReadonly/);assert.match(source,/SYNC_LEASE_SETTLE_MS/);
  const active=functionSource("syncActiveLeases");assert.match(active,/SyncCoordination\.activeCommitLeases/);assert.match(active,/SyncCoordination\.expiredLeaseObjects/)
});

await check("return checks quietly when up to date and guards only a real remote pull",async()=>{
  let gate=0,hidden=0,cycles=0,nudged=0,remote=false;
  const ctx=context({DiagnosticsLog:log,safeRunAsync:(label,task)=>task(),syncShowReturnGate:()=>{gate++},syncHideReturnGate:()=>{hidden++},syncSetNoteOpenGuard:()=>{},
    syncReturnProbe:async()=>remote?{needsPull:true,why:"remote-commits"}:{upToDate:true},
    runAutomaticSync:async()=>{cycles++;return {synced:true}},scheduleAutomaticSync:()=>{nudged++}},["syncCheckOnReturn"]);
  vm.runInContext("var syncWindowWasAway=true,syncReturnGate=false,syncCloudKnownConnected=true,syncReturnGateRun=0,syncAutomaticPromise=null,syncNoteOpenGuardId=''",ctx);
  ctx.syncCheckOnReturn();await tick(0);assert.equal(gate,0);assert.equal(cycles,0);assert.ok(nudged);
  remote=true;vm.runInContext("syncWindowWasAway=true",ctx);ctx.syncCheckOnReturn();await tick(0);
  assert.equal(gate,1);assert.equal(cycles,1);assert.ok(hidden>=1)
});

await check("sibling commits: loser withdraws; young forks retry in seconds instead of minutes",async()=>{
  const run=functionSource("runAutomaticSync");
  assert.match(run,/SyncCoordination\.siblingWinner/);assert.match(run,/concurrent-commit-withdrawn/);assert.match(run,/deferred:"concurrent-commit-lost",retryInMs:1500/);
  assert.match(run,/isYoungSiblingFork\(topology\.heads\)/);assert.match(run,/syncAutomaticRerunRequested=true;return syncAutomaticPromise/);
  assert.match(run,/rerun\?SYNC_PUBLISH_DELAY_MS/);assert.match(run,/skipped:"lease",retryInMs:1500/);
  assert.doesNotMatch(run,/remote-lease-active/)
});

await check("leaving the window publishes immediately; exit pushes before quitting; work tracking is internal",async()=>{
  assert.match(functionSource("syncMarkAway"),/syncFlushOnLeave/);assert.match(functionSource("syncFlushOnLeave"),/scheduleSyncOutboxPreparation\(0\)/);
  assert.match(functionSource("closeWindowAfterStateFlush"),/await syncFinalPushBeforeExit\(\);await syncReleaseOwnLease\("app-exit"\);await syncReleasePresence\("app-exit"\)/);
  assert.match(functionSource("syncCaptureWorkTracking"),/syncInternalStateWrite=true;try\{StateRepository\.write\(state\)\}finally\{syncInternalStateWrite=false\}/);
  assert.match(html,/<script src="\.\/shared\/sync-coordination\.js"><\/script>/)
});

await check("switching windows (Alt+Tab) still runs the return check; returning resets the idle timer",async()=>{
  const startup=functionSource("startAutomaticSync");
  assert.match(startup,/window\.addEventListener\("blur",\(\)=>syncMarkAway\("blur"\)\)/,"blur marks the window as away");
  assert.match(startup,/window\.addEventListener\("focus",\(\)=>\{syncLastUserInputAt=Date\.now\(\);/,"focus counts as input");
  assert.match(startup,/else\{syncLastUserInputAt=Date\.now\(\);syncHandleReturn\(\)\}/,"becoming visible counts as input")
});

await check("app update publishes, freezes automatic sync, and releases lease/presence before installer restart",async()=>{
  const prepare=functionSource("syncPrepareForAppUpdate"),install=functionSource("installAppUpdate"),schedule=functionSource("scheduleAutomaticSync"),automatic=functionSource("runAutomaticSync");
  assert.match(prepare,/await syncFinalPushBeforeExit\("app-update"\)/);assert.match(prepare,/syncAppUpdateInProgress=true/);assert.match(prepare,/await syncReleaseOwnLease\("app-update"\)/);assert.match(prepare,/await syncReleasePresence\("app-update"\)/);
  assert.match(prepare,/Promise\.race\(\[syncAutomaticPromise\.catch/,"does not wait unboundedly for a running cycle");
  assert.match(install,/await syncPrepareForAppUpdate\(\);await update\.downloadAndInstall/);assert.match(install,/syncResumeAfterAppUpdateFailure\(\)/);
  assert.match(schedule,/if\(syncAppUpdateInProgress\)return/);assert.match(automatic,/if\(syncAppUpdateInProgress\)return \{skipped:"app-update"\}/);
  assert.match(functionSource("syncWorkTrackingCaptureDue"),/reason==="app-update"/,"the update captures the latest work-tracking seconds");
  assert.match(functionSource("scheduleSyncOutboxPreparation"),/await syncPresenceAfterLocalWrite\(\)/,"a local edit may mark its document as being edited")
});

await check("Windows topology (shared) sends a device whose base was GC'd to the checkpoint rebaseline, never to a partial replay",async()=>{
  assert.match(html,/function syncCommitTopology\(objects,baseRevision=""\)\{return SyncCoordination\.commitTopology\(objects,baseRevision\)\}/);
  assert.match(functionSource("runAutomaticSync"),/topology\.error==="base-revision-missing"\)\{\s*const rebased=await syncApplyAutomaticRebaseline/);
  const ctx=context();const topo=ctx.SyncCoordination.commitTopology;
  const c=(r,b)=>({syncType:"commit",objectKey:`sync/commits/${r}.json`,revision:r,baseRevision:b}),cp=r=>({syncType:"checkpoint",objectKey:`sync/checkpoints/${r}.json`,revision:r});
  assert.equal(topo([cp("c3"),c("c4","c3"),c("c5","c4")],"c1").error,"base-revision-missing");
  const rebase=topo([cp("c3"),c("c4","c3"),c("c5","c4")],"");assert.equal(rebase.error,undefined);assert.equal(rebase.anchorRevision,"c3");
  // Invariant over random histories: whenever the base counts as found, replaying `path` starts exactly at it.
  let seed=11;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;let found=0;
  for(let n=0;n<5000;n++){
    const len=2+Math.floor(rnd()*12),revs=Array.from({length:len},(_,i)=>`r${i}`),objs=[];
    revs.forEach((r,i)=>{if(rnd()<0.3&&i<len-1)return;objs.push(c(r,i?revs[i-1]:""))});
    revs.forEach((r,i)=>{if(i%4===3&&rnd()<0.8)objs.push(cp(r))});
    const base=revs[Math.floor(rnd()*len)],t=topo(objs,base);if(t.error)continue;found++;
    assert.ok(t.path.length?t.path[0].baseRevision===base:t.head.revision===base,`path starts at base ${base}`)
  }
  assert.ok(found>1000)
});

console.log(`Desktop device hand-off QA passed (${checks.length} checks).`);
