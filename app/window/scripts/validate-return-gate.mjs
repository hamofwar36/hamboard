import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

// Runs the real Windows sync cycle and return gate (extracted from web/index.html) against a
// simulated Google Drive with latency, reproducing the field report:
// "최신 내용 확인 중" keeps appearing for a long time every time the user comes back to the window,
// while a tracked program keeps adding work-tracking seconds in the background.
const root=new URL("../",import.meta.url);
const html=await readFile(new URL("web/index.html",root),"utf8");
const modelSource=await readFile(new URL("web/shared/sync-state-model.js",root),"utf8");
const coordinationSource=await readFile(new URL("web/shared/sync-coordination.js",root),"utf8");
const safetySource=await readFile(new URL("web/shared/transfer-safety.js",root),"utf8");
function functionSource(name){
  const start=html.search(new RegExp(`^(?:async )?function ${name}\\(`,"m"));
  if(start<0)return "";
  const rest=html.slice(start),end=rest.slice(1).search(/\n(?:async )?function |\n(?:const|let) /);
  return end<0?rest:rest.slice(0,end+1)
}
const constantsLine=html.split("\n").find(line=>line.startsWith("const SYNC_PROTOCOL_VERSION=1,"));
assert.ok(constantsLine,"sync constants line");

const LATENCY=40,LEASE_MS=100,CLEANUP_MS=800;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const REAL=["runAutomaticSync","syncCheckOnReturn","syncReturnProbe","syncCaptureWorkTracking","syncWorkTrackingCaptureDue","normalizeSyncWorkTracking","dataRecords","syncUpdateRemotePresence","syncCommitTopology","syncUserIdle","syncDesiredPollInterval","scheduleAutomaticSync","syncHideReturnGate","syncErrorText","syncFailureKind","syncFailureRetryDelay","syncPresenceDecision","syncPresenceTick","syncLocalPendingForPresence","startAutomaticSync","syncInstallIdleReturnGuard","syncMarkAway","syncHandleReturn","syncFinalPushBeforeExit","syncPrepareForAppUpdate","syncResumeAfterAppUpdateFailure","syncPreserveConflict","syncConflictJson","syncConflictMergeWorkTracking","syncUploadBlocked","syncPresenceAfterLocalWrite","syncWindowFocused","syncUserEditingNow","syncInstallEditInputTracker","syncIsDocumentChange","syncShouldBatchDeviceData"];

function createWorld(){
  const world={conflicts:[],objects:[{syncType:"commit",objectKey:"sync/commits/rev-0.json",revision:"rev-0",baseRevision:"",deviceId:"device-me",createdAtMs:"1",remoteObjectId:"f0"}],baseRevision:"rev-0",pending:[],events:[],gate:[],remoteApplied:false,seq:0,errors:[],workStart:Date.now(),checkpointUploads:true};
  let fileId=1;const drive=async(label,ms=LATENCY)=>{world.events.push(label);await sleep(ms)};
  const workRow=value=>({entityType:"work-tracking",entityId:"main",operation:"upsert",payloadJson:JSON.stringify(value),payloadSha256:"0".repeat(64)});
  const ctx=vm.createContext({
    console,TextEncoder,Date,Math,JSON,Promise,Map,Set,Array,String,Number,Error,structuredClone,setTimeout,clearTimeout,setInterval,clearInterval,crypto:globalThis.crypto,
    navigator:{onLine:true},document:{hidden:false,hasFocus:()=>true},window:{crypto:globalThis.crypto},
    $:()=>null,isDataRecord:value=>!!value&&typeof value==="object"&&!Array.isArray(value),
    DiagnosticsLog:{info:(area,event)=>world.events.push(`log:${event}`),warn:(area,event)=>world.events.push(`log:${event}`),error:(area,event,detail)=>{world.events.push(`log:${event}`);world.errors.push(detail?.error||event)}},
    safeRunAsync:(label,task)=>Promise.resolve().then(task).catch(error=>world.errors.push(error)),
    toast:()=>{},uid:()=>`${Date.now()}-${fileId++}`,readState:value=>value,cloneData:value=>structuredClone(value),
    normalizeCloudImageQuality:()=>"balanced",SCHEMA_VERSION:1,
    state:{schemaVersion:1,settings:{},workTrackingSync:{programs:[],daily:[]}},
    WorkTrackingRepository:{exportAll:async()=>({programs:[{id:"p1",display_name:"CLIP STUDIO",executable_path:"C:/clip.exe",executable_name:"clip.exe",created_at_ms:1,updated_at_ms:1,archived_at_ms:null}],daily:[{program_id:"p1",work_date:"2026-09-25",seconds:Math.floor((Date.now()-world.workStart)/20),updated_at_ms:Date.now()}]})},
    StateRepository:{changeGeneration:0,cached:null,flush:async()=>{},snapshot:()=>structuredClone(ctx.state),read:async()=>structuredClone(ctx.state),write:value=>{world.pending=[workRow(value.workTrackingSync)];world.seq++;return Promise.resolve()}},
    SyncRepository:{
      prepareOutbox:async()=>({}),
      runtime:async()=>({baseRevision:world.baseRevision,baseState:{schemaVersion:1,workTrackingSync:{programs:[],daily:[]}},stateSequence:world.seq,preparedSequence:world.seq,requiresRebaseline:false}),
      listPending:async()=>structuredClone(world.pending),
      status:async()=>({pending:world.pending.length,stateSequence:world.seq,preparedSequence:world.seq}),
      device:async()=>({deviceId:"device-me",displayName:"Windows PC"}),
      listUnresolvedConflicts:async()=>world.conflicts.filter(row=>row.status==="unresolved").map(row=>({...row})),
      recordConflict:async conflict=>{const id=`conflict-${world.conflicts.length+1}`;world.conflicts.push({id,entity_type:conflict.entityType,entity_id:conflict.entityId,base_json:conflict.baseJson??null,local_json:conflict.localJson??null,remote_json:conflict.remoteJson??null,remote_revision:conflict.remoteRevision,status:"unresolved"});return id},
      acceptBaseline:async(sequence,revision)=>{world.baseRevision=revision;world.pending=[];return {stale:false}},
      applyRemoteState:async(sequence,revision,merged)=>{await sleep(LATENCY);if(world.failApplyOnce){world.failApplyOnce=false;throw new Error("simulated-apply-failure")}world.appliedState=structuredClone(merged);world.baseRevision=revision;world.remoteApplied=true;world.events.push("remote-applied");return {stateSequence:1}}
    },
    GoogleDriveService:{
      status:async()=>({connected:true}),
      listSyncObjects:async scope=>{await drive(`list:${scope}`);return {objects:scope==="topology"?structuredClone(world.objects):[],truncated:false}},
      putObject:async request=>{await drive(`put:${request.syncMetadata?.syncType}`,LATENCY*1.5);const id=`f${fileId++}`;if(request.syncMetadata?.syncType==="commit")world.objects.push({syncType:"commit",objectKey:request.objectKey,revision:request.syncMetadata.revision,baseRevision:request.syncMetadata.baseRevision,deviceId:request.syncMetadata.deviceId,createdAtMs:request.syncMetadata.createdAtMs,remoteObjectId:id});return {remoteObjectId:id,contentSha256:"0".repeat(64),uploadByteSize:1}},
      deleteSyncObject:async()=>drive("delete")
    },
    syncEnsureLease:async()=>{await drive("lease",LEASE_MS);return true},
    syncStartLeaseHeartbeat:()=>{},
    syncReleaseOwnLease:async reason=>{world.events.push(`lease-release:${reason}`)},
    syncUploadReferencedAssets:async()=>{await drive("assets");return {}},
    syncPublishCheckpoint:async revision=>{await drive(`checkpoint:${revision}`);return {uploaded:world.checkpointUploads}},
    syncCleanupRemoteStorage:async(state,objects,{reason,force}={})=>{if(reason==="steady-state"&&!force)return {skipped:"interval"};world.events.push("cleanup-start");await sleep(CLEANUP_MS);world.events.push("cleanup-end");return {}},
    syncSetReadonly:lease=>{ctx.syncRemoteLease=lease||null},
    syncShowReturnGate:(message,options)=>{ctx.syncReturnGate=true;world.gate.push({at:Date.now(),message,waiting:!!options?.waiting})},
    syncApplyAutomaticRebaseline:async()=>({blocked:"not-simulated"}),
    syncReadCommit:async object=>{await drive("read-commit");return {revision:object.revision,deviceId:object.deviceId,clientProfile:"desktop",changes:[{entityType:"note",entityId:"n1",operation:"upsert",payload:{id:"n1",title:"PC2"}}]}},
    syncEntityKey:(type,id)=>`${type}:${id}`,syncTransientEditReason:()=>"",syncEmptyRemoteState:()=>({schemaVersion:1}),
    syncApplyChanges:value=>value,syncChangedEntityKeys:()=>new Set(["note:n1"]),syncEnsureStateAssets:async()=>{},syncAdoptMergedState:()=>{},
    syncApplyWorkTracking:async()=>{},syncInvalidateChangedHistories:()=>{},syncRefreshAfterRemoteApply:()=>({rendered:true}),
    syncNotifyFailure:()=>{},syncResetAutomaticBackoff:()=>{},
    syncInstallReadonlyGuard:()=>{},syncInstallInteractionGuard:()=>{},syncFlushOnLeave:reason=>world.events.push(`flush:${reason}`),
    syncReleasePresence:async reason=>{world.events.push(`presence-release:${reason}`)}
  });
  vm.runInContext(safetySource,ctx);vm.runInContext(modelSource,ctx);vm.runInContext(coordinationSource,ctx);
  vm.runInContext("var TransferSafety=HamboardTransferSafety,DataTransferCoordinator=TransferSafety.createCoordinator(),SyncStateModel=HamboardSyncStateModel,SyncCoordination=HamboardSyncCoordination,SYNC_CLIENT_PROFILES=SyncStateModel.CLIENT_PROFILES",ctx);
  vm.runInContext(constantsLine.replace(/^const /,"var "),ctx);
  vm.runInContext("var syncAutomaticTimer=0,syncAutomaticTimerDueAt=0,syncAutomaticPromise=null,syncManualImportPromise=null,syncReconnectImportPending=false,cloudBackupUploadPromise=null,syncRemoteLease=null,syncConflictBlocked=false,syncInternalStateWrite=false,syncAutomaticFailureCount=0,syncAutomaticRetryNotBefore=0,syncRejectedRemoteCommit=null,syncReturnGate=false,syncReturnGateRun=0,syncWindowWasAway=false,syncCloudKnownConnected=true,syncAutomaticRerunRequested=false,syncOwnPresence=null,syncReadonlyOverride=null,syncLastUserInputAt=Date.now(),syncLastEditInputAt=0,SYNC_PRESENCE_INPUT_WINDOW_MS=5000,SYNC_DEVICE_DATA_PUBLISH_INTERVAL_MS=600000,syncDeviceDataPublishedAt=0,syncWorkTrackingCapturedAt=0,syncOutboxTimer=0,syncLastLocalWriteAt=0,syncPresenceTimer=0,syncPresencePromise=null,syncAppUpdateInProgress=false,syncAwaySince=0,syncOutboxFirstRequestAt=0,syncLocalWriteSincePrepare=false,syncOwnLease=null,syncConflictNoticeAt=0,SYNC_RETURN_GATE_SHORT_AWAY_MS=3000",ctx);
  for(const name of REAL){const source=functionSource(name);if(source)vm.runInContext(source,ctx)}
  ctx.SYNC_READONLY_POLL_INTERVAL_MS=30;
  return {world,ctx}
}
async function settle(ctx){for(let i=0;i<400&&ctx.syncAutomaticPromise;i++)await sleep(10);if(ctx.syncAutomaticTimer){clearTimeout(ctx.syncAutomaticTimer);ctx.syncAutomaticTimer=0;ctx.syncAutomaticTimerDueAt=0}}
async function returnToWindow(ctx,timeout=6000){
  ctx.syncWindowWasAway=true;const started=Date.now();ctx.syncCheckOnReturn();
  while(ctx.syncReturnGate&&Date.now()-started<timeout)await sleep(5);
  assert.equal(ctx.syncReturnGate,false,"gate lifted");return Date.now()-started
}
const commitsFrom=(world,device)=>world.objects.filter(item=>item.syncType==="commit"&&item.deviceId===device&&item.revision!=="rev-0").length;
const checks=[],failures=[];async function check(name,run){try{await run();checks.push(name);console.log("  PASS",name)}catch(error){failures.push(name);console.log("  FAIL",name,"\n       ",String(error?.message||error).split("\n")[0])}}

await check("field report: returning with only this device's work-tracking pending lifts the gate after one read-only check",async()=>{
  const {world,ctx}=createWorld();
  await ctx.syncCaptureWorkTracking();assert.equal(world.pending.length,1,"work-tracking change pending before return");
  world.events.length=0;
  const gateMs=await returnToWindow(ctx);
  const duringGate=[...world.events];
  assert.ok(gateMs<LATENCY*5,`gate stayed ${gateMs}ms (≈ one list call expected, not a full upload cycle)`);
  assert.ok(!duringGate.includes("lease")&&!duringGate.some(item=>item.startsWith("put:")),"the gate itself never uploads");
  await sleep(1800);
  assert.equal(commitsFrom(world,"device-me"),1,"the pending work-tracking change is still uploaded afterwards");
  await settle(ctx)
});

await check("returning while this device is in a long cleanup does not wait for the cleanup",async()=>{
  const {world,ctx}=createWorld();
  await ctx.syncCaptureWorkTracking();
  const cycle=ctx.runAutomaticSync("scheduled");
  for(let i=0;i<200&&!world.events.includes("cleanup-start");i++)await sleep(5);
  assert.ok(world.events.includes("cleanup-start"),"cleanup running");
  const gateMs=await returnToWindow(ctx);
  assert.ok(gateMs<CLEANUP_MS/2,`gate stayed ${gateMs}ms while cleanup takes ${CLEANUP_MS}ms`);
  await cycle;await settle(ctx)
});

await check("another device's new commit is applied before the gate lifts (hand-off requirement kept)",async()=>{
  const {world,ctx}=createWorld();
  world.objects.push({syncType:"commit",objectKey:"sync/commits/rev-pc2.json",revision:"rev-pc2",baseRevision:"rev-0",deviceId:"device-pc2",createdAtMs:String(Date.now()),remoteObjectId:"fx"});
  world.events.length=0;
  ctx.syncWindowWasAway=true;ctx.syncCheckOnReturn();
  let appliedWhenLifted=null;const started=Date.now();
  while(Date.now()-started<6000){if(!ctx.syncReturnGate){appliedWhenLifted=world.remoteApplied;break}await sleep(2)}
  assert.equal(appliedWhenLifted,true,"remote change applied before editing is allowed");
  const gateEvents=world.events.slice(0,world.events.indexOf("remote-applied")+1);
  assert.ok(!gateEvents.includes("lease"),"pull for the gate does not take the upload lease");
  await settle(ctx)
});

await check("while another device is editing, the gate waits without uploading, then applies its commit",async()=>{
  const {world,ctx}=createWorld();
  await ctx.syncCaptureWorkTracking();
  const now=Date.now(),presence={syncType:"lease",objectKey:"sync/leases/presence-device-pc2-ab.json",revision:"presence-device-pc2-ab",deviceId:"device-pc2",displayName:"Windows PC",createdAtMs:String(now-1000),expiresAtMs:String(now+45000),remoteObjectId:"fp"};
  world.objects.push(presence);world.events.length=0;
  ctx.syncWindowWasAway=true;ctx.syncCheckOnReturn();
  for(let i=0;i<200&&!world.gate.some(item=>item.waiting);i++)await sleep(5);
  assert.ok(world.gate.some(item=>item.waiting),"waiting message shown");
  await sleep(150);
  assert.ok(!world.events.includes("lease")&&!world.events.some(item=>item.startsWith("put:")),"no uploads while waiting");
  world.objects=world.objects.filter(item=>item!==presence);
  world.objects.push({syncType:"commit",objectKey:"sync/commits/rev-pc2.json",revision:"rev-pc2",baseRevision:"rev-0",deviceId:"device-pc2",createdAtMs:String(Date.now()),remoteObjectId:"fx"});
  const started=Date.now();while(ctx.syncReturnGate&&Date.now()-started<6000)await sleep(5);
  assert.equal(ctx.syncReturnGate,false);assert.equal(world.remoteApplied,true);
  await settle(ctx)
});

await check("work-tracking is captured at most once a minute, so it cannot drive back-to-back upload cycles",async()=>{
  const {world,ctx}=createWorld();
  await ctx.runAutomaticSync("scheduled");await settle(ctx);
  await sleep(60);
  await ctx.runAutomaticSync("scheduled");await settle(ctx);
  assert.equal(commitsFrom(world,"device-me"),1,"second cycle within a minute does not capture and upload again");
  await ctx.runAutomaticSync("app-exit");await settle(ctx);
  assert.equal(commitsFrom(world,"device-me"),2,"exit still captures the latest seconds")
});

await check("the upload lease is released as soon as the commit is published, before checkpoint and cleanup",async()=>{
  const {world,ctx}=createWorld();
  await ctx.syncCaptureWorkTracking();await ctx.runAutomaticSync("scheduled");await settle(ctx);
  const release=world.events.findIndex(item=>item.startsWith("lease-release:")),checkpoint=world.events.findIndex(item=>item.startsWith("checkpoint:")),cleanup=world.events.indexOf("cleanup-start");
  assert.ok(release>=0&&checkpoint>=0&&cleanup>=0,"all steps ran");
  assert.ok(release<checkpoint&&release<cleanup,`lease released first (${world.events.join(" → ")})`)
});

await check("an editing presence is released even while work-tracking changes keep coming",async()=>{
  const {world,ctx}=createWorld();
  await ctx.syncCaptureWorkTracking();
  ctx.syncOwnPresence={objectKey:"sync/leases/presence-me.json",expiresAtMs:Date.now()+40000,sessionStartedAtMs:Date.now()-10000};
  ctx.syncLastEditInputAt=Date.now()-10000;
  let released=false;ctx.syncReleasePresence=async()=>{released=true;ctx.syncOwnPresence=null};ctx.syncEnsurePresence=async()=>ctx.syncOwnPresence;
  assert.equal(await ctx.syncPresenceTick(),"release","work-tracking alone is not 'editing'");assert.equal(released,true);
  world.pending.push({entityType:"note",entityId:"n1",operation:"upsert",payloadJson:"{}",payloadSha256:"0".repeat(64)});
  ctx.syncOwnPresence={objectKey:"sync/leases/presence-me.json",expiresAtMs:Date.now()+40000,sessionStartedAtMs:Date.now()-10000};
  assert.equal(await ctx.syncPresenceTick(),"keep","an unsent document edit keeps the presence")
});

await check("background writes never mark this device as editing; typing does, and leaving the window releases it",async()=>{
  const {world,ctx}=createWorld();let published=0,released=[];
  ctx.syncEnsurePresence=async()=>{published++;ctx.syncOwnPresence={objectKey:"sync/leases/presence-me.json",expiresAtMs:Date.now()+40000,sessionStartedAtMs:Date.now()};return ctx.syncOwnPresence};
  ctx.syncStartPresenceTicker=()=>{};ctx.syncReleasePresence=async reason=>{released.push(reason);ctx.syncOwnPresence=null};
  world.pending.push({entityType:"note",entityId:"n9",operation:"upsert",payloadJson:"{}",payloadSha256:"0".repeat(64)});
  ctx.syncLastEditInputAt=Date.now()-60000;
  assert.equal(await ctx.syncPresenceAfterLocalWrite(),false,"a reminder/widget write with nobody typing");assert.equal(published,0);
  ctx.syncLastEditInputAt=Date.now();
  assert.equal(await ctx.syncPresenceAfterLocalWrite(),true,"a write right after typing");assert.equal(published,1);
  world.pending.length=0;ctx.document.hasFocus=()=>false;
  assert.equal(await ctx.syncPresenceTick(),"release","alt-tab away with everything committed releases at once");
  ctx.document.hasFocus=()=>true;
  const now=1_000_000;
  assert.equal(ctx.syncPresenceDecision({now,presence:{expiresAtMs:now+5000},dirty:true,lastEditAt:now-60000,focused:true}),"keep","background dirtiness alone does not renew");
  assert.equal(ctx.syncPresenceDecision({now,presence:{expiresAtMs:now+5000},dirty:true,lastEditAt:now-1000,focused:false}),"keep","out of focus never renews")
});

await check("utilities, work tracking and workspace never count as editing and wait for a batch; documents go at once",async()=>{
  const {world,ctx}=createWorld();
  const row=(entityType,next,base)=>({entityType,entityId:"main",operation:"upsert",payloadJson:JSON.stringify(next),basePayloadJson:JSON.stringify(base),payloadSha256:"0".repeat(64)});
  const workspaceOnly=row("user-library",{tagLibrary:["a"],favorites:[],workspace:{newsReadIds:["n2"]},utilityLibrary:{pomodoroPreset:{focusMinutes:30}}},{tagLibrary:["a"],favorites:[],workspace:{newsReadIds:["n1"]},utilityLibrary:{pomodoroPreset:{focusMinutes:25}}});
  const favorite=row("user-library",{tagLibrary:["a"],favorites:["note:1"]},{tagLibrary:["a"],favorites:[]});
  const tracking=row("work-tracking",{daily:[1]},{daily:[]}),note={entityType:"note",entityId:"n1",operation:"upsert",payloadJson:"{}",payloadSha256:"0".repeat(64)};
  assert.equal(ctx.syncIsDocumentChange(workspaceOnly),false);assert.equal(ctx.syncIsDocumentChange(tracking),false);
  assert.equal(ctx.syncIsDocumentChange(favorite),true,"favorites are document data");assert.equal(ctx.syncIsDocumentChange(note),true);
  // presence: a click in the pomodoro/widget UI is not document editing
  let published=0;ctx.syncEnsurePresence=async()=>{published++;return {}};ctx.syncStartPresenceTicker=()=>{};ctx.syncLastEditInputAt=Date.now();
  world.pending.push(workspaceOnly,tracking);
  assert.equal(await ctx.syncPresenceAfterLocalWrite(),false);assert.equal(published,0);
  // batching
  const now=Date.now();ctx.syncDeviceDataPublishedAt=now-60000;
  assert.equal(ctx.syncShouldBatchDeviceData([workspaceOnly,tracking],"scheduled",now),true,"held while the PC is in use");
  assert.equal(ctx.syncShouldBatchDeviceData([workspaceOnly,note],"scheduled",now),false,"rides along with a document commit");
  assert.equal(ctx.syncShouldBatchDeviceData([tracking],"app-exit",now),false,"exit publishes everything");
  assert.equal(ctx.syncShouldBatchDeviceData([tracking],"scheduled",now+11*60000),false,"at most every 10 minutes");
  ctx.document.hasFocus=()=>false;assert.equal(ctx.syncShouldBatchDeviceData([tracking],"scheduled",now),false,"leaving the window publishes");ctx.document.hasFocus=()=>true
});

await check("device-generated writes do not trigger the fast re-publish loop",async()=>{
  const scheduled=[];
  const ctx=vm.createContext({Date,Math,setTimeout,clearTimeout,safeRunAsync:(label,task)=>Promise.resolve().then(task),DiagnosticsLog:{info(){},warn(){},error(){}},SyncRepository:{prepareOutbox:async()=>({})},syncPresenceAfterLocalWrite:async()=>{},scheduleAutomaticSync:delay=>scheduled.push(delay),syncDesiredPollInterval:()=>5000});
  vm.runInContext(constantsLine.replace(/^const /,"var "),ctx);
  vm.runInContext("var syncOutboxTimer=0,syncOutboxFirstRequestAt=0,syncLocalWriteSincePrepare=false,syncLastLocalWriteAt=0,syncInternalStateWrite=false",ctx);
  vm.runInContext(functionSource("scheduleSyncOutboxPreparation"),ctx);vm.runInContext(functionSource("syncMarkLocalWrite"),ctx);
  ctx.scheduleSyncOutboxPreparation(0);await sleep(30);
  assert.ok(!scheduled.includes(ctx.SYNC_PUBLISH_DELAY_MS),`internal write scheduled ${JSON.stringify(scheduled)}`);
  scheduled.length=0;ctx.syncMarkLocalWrite();ctx.scheduleSyncOutboxPreparation(0);await sleep(30);
  assert.deepEqual(scheduled,[ctx.SYNC_PUBLISH_DELAY_MS],"a user edit still publishes quickly")
});

await check("the first click after returning does not start a second check (idle timer reset on return)",async()=>{
  const {world,ctx}=createWorld();
  const hub=()=>{const handlers={};return {handlers,addEventListener(type,fn){(handlers[type]=handlers[type]||[]).push(fn)},fire(type,event={}){for(const fn of handlers[type]||[])fn({type,target:null,...event})}}};
  const win=hub(),doc=hub();win.crypto=globalThis.crypto;Object.assign(doc,{hidden:false,hasFocus:()=>true,documentElement:{dataset:{}}});
  ctx.window=win;ctx.document=doc;ctx.startAutomaticSync();await settle(ctx);
  ctx.syncLastUserInputAt=Date.now()-100000;
  win.fire("blur");assert.ok(world.events.includes("flush:blur"),"leaving publishes");
  ctx.syncAwaySince=Date.now()-10000;world.events.length=0;
  win.fire("focus");assert.equal(ctx.syncReturnGate,true,"switching back to the window still runs the return check");
  for(let i=0;i<400&&ctx.syncReturnGate;i++)await sleep(5);
  assert.equal(ctx.syncReturnGate,false);
  doc.fire("pointerdown");await sleep(20);
  assert.ok(!world.events.includes("log:idle-return-check"),"no second check on the first click");
  assert.equal(ctx.syncReturnGate,false);
  await settle(ctx)
});

await check("app update: pending changes are published, sync stops, lease and presence are given back without waiting on cleanup",async()=>{
  const {world,ctx}=createWorld();ctx.SYNC_EXIT_PUSH_TIMEOUT_MS=300;
  await ctx.syncCaptureWorkTracking();
  const cycle=ctx.runAutomaticSync("scheduled");
  for(let i=0;i<200&&!world.events.includes("cleanup-start");i++)await sleep(5);
  world.workStart-=5000;
  const started=Date.now();await ctx.syncPrepareForAppUpdate();const took=Date.now()-started;
  assert.ok(took<CLEANUP_MS+ctx.SYNC_EXIT_PUSH_TIMEOUT_MS*2,`update waited ${took}ms`);
  assert.equal(ctx.syncAppUpdateInProgress,true);
  assert.ok(world.events.includes("lease-release:app-update")&&world.events.includes("presence-release:app-update"),"lease and presence given back");
  await cycle;await sleep(20);
  assert.equal(ctx.syncAutomaticTimer,0,"the interrupted cycle does not reschedule itself while updating");
  assert.equal((await ctx.runAutomaticSync("scheduled")).skipped,"app-update","no new cycles while updating");
  ctx.scheduleAutomaticSync(1000);assert.equal(ctx.syncAutomaticTimer,0,"no timers while updating");
  ctx.syncResumeAfterAppUpdateFailure();assert.equal(ctx.syncAppUpdateInProgress,false);assert.ok(ctx.syncAutomaticTimer,"sync resumes if the update fails");
  await settle(ctx)
});

// Field report 2 (App 1.0.14 log): Drive had been disconnected, this device kept unsent edits, the other
// device kept committing. The first overlapping item made every pull throw
// "ReferenceError: syncPreserveConflict is not defined", so each return showed the gate with an error.
const noteRow=(id,title)=>({entityType:"note",entityId:id,operation:"upsert",payloadJson:JSON.stringify({id,title}),basePayloadJson:JSON.stringify({id,title:"원본"}),payloadSha256:"0".repeat(64)});
const remoteNoteCommit=()=>({syncType:"commit",objectKey:"sync/commits/rev-pc2.json",revision:"rev-pc2",baseRevision:"rev-0",deviceId:"device-pc2",createdAtMs:String(Date.now()),remoteObjectId:"fx"});

await check("field report 2: an item changed on both devices is kept as a conflict, and the gate lifts instead of failing",async()=>{
  const {world,ctx}=createWorld();
  world.pending=[noteRow("n1","이 PC에서 고친 제목")];world.objects.push(remoteNoteCommit());
  const gateMs=await returnToWindow(ctx);
  assert.ok(!world.errors.some(error=>/is not defined/.test(String(error?.message||error))),`no ReferenceError (${world.errors.map(String).join(" | ")})`);
  assert.ok(!world.gate.some(item=>/확인하지 못했습니다/.test(item.message)),"no error message on the gate");
  assert.equal(world.conflicts.length,1,"the conflict is stored for the user to resolve");
  assert.deepEqual(JSON.parse(world.conflicts[0].local_json),{id:"n1",title:"이 PC에서 고친 제목"});
  assert.deepEqual(JSON.parse(world.conflicts[0].remote_json),{id:"n1",title:"PC2"});
  assert.equal(world.baseRevision,"rev-pc2","the rest of the remote history is applied");
  assert.ok(gateMs<2000);
  ctx.syncWorkTrackingCapturedAt=Date.now();const next=await ctx.runAutomaticSync("scheduled");assert.equal(next.blocked,"entity-conflict","uploads wait for the user's choice, as designed");
  await settle(ctx)
});

await check("a retried pull does not store the same conflict twice",async()=>{
  const {world,ctx}=createWorld();
  world.pending=[noteRow("n1","이 PC에서 고친 제목")];world.objects.push(remoteNoteCommit());world.failApplyOnce=true;ctx.syncWorkTrackingCapturedAt=Date.now();
  const first=await ctx.runAutomaticSync("scheduled");assert.equal(first.failed,true,"first attempt fails after recording");await settle(ctx);
  ctx.syncAutomaticRetryNotBefore=0;
  await ctx.runAutomaticSync("scheduled");await settle(ctx);
  assert.equal(world.conflicts.length,1)
});

await check("work-tracking changed on both devices is merged automatically, not turned into a conflict",async()=>{
  const {world,ctx}=createWorld();
  const program={id:"p1",display_name:"CLIP",executable_path:"C:/clip.exe",executable_name:"clip.exe",created_at_ms:1,updated_at_ms:1,archived_at_ms:null};
  const local={programs:[program],daily:[{program_id:"p1",work_date:"2026-09-24",seconds:100,updated_at_ms:5}]},remote={programs:[program],daily:[{program_id:"p1",work_date:"2026-09-24",seconds:40,updated_at_ms:4},{program_id:"p1",work_date:"2026-09-25",seconds:30,updated_at_ms:6}]};
  world.pending=[{entityType:"work-tracking",entityId:"main",operation:"upsert",payloadJson:JSON.stringify(local),payloadSha256:"0".repeat(64)}];
  world.objects.push({...remoteNoteCommit()});ctx.syncWorkTrackingCapturedAt=Date.now();
  ctx.syncReadCommit=async object=>({revision:object.revision,deviceId:object.deviceId,clientProfile:"desktop",changes:[{entityType:"work-tracking",entityId:"main",operation:"upsert",payload:remote}]});
  ctx.syncApplyChanges=(snapshot,changes)=>{const next=structuredClone(snapshot);for(const change of changes)if(change.entityType==="work-tracking")next.workTrackingSync=structuredClone(change.payload);return next};
  await ctx.runAutomaticSync("scheduled");await settle(ctx);
  assert.equal(world.conflicts.length,0,"no conflict for device-generated data");
  const days=Object.fromEntries(world.appliedState.workTrackingSync.daily.map(row=>[row.work_date,row.seconds]));
  assert.deepEqual(days,{"2026-09-24":100,"2026-09-25":30},"both devices' days are kept")
});

await check("while uploads are blocked by a conflict or failures, this device does not hold other devices read-only",async()=>{
  const {world,ctx}=createWorld();
  world.pending=[noteRow("n1","보내지 못한 편집")];
  ctx.syncOwnPresence={objectKey:"sync/leases/presence-me.json",expiresAtMs:Date.now()+40000,sessionStartedAtMs:Date.now()-10000};ctx.syncLastLocalWriteAt=Date.now();
  let released=null;ctx.syncReleasePresence=async reason=>{released=reason;ctx.syncOwnPresence=null};ctx.syncEnsurePresence=async()=>ctx.syncOwnPresence;
  ctx.syncConflictBlocked=true;assert.equal(await ctx.syncPresenceTick(),"release");assert.equal(released,"sync-conflict");
  ctx.syncConflictBlocked=false;ctx.syncAutomaticFailureCount=2;ctx.syncOwnPresence={...ctx.syncOwnPresence||{},objectKey:"p",expiresAtMs:Date.now()+40000,sessionStartedAtMs:1};
  assert.equal(await ctx.syncPresenceTick(),"release");assert.equal(released,"sync-failing");
  let published=false;ctx.syncEnsurePresence=async()=>{published=true};
  assert.equal(await ctx.syncPresenceAfterLocalWrite(),false);assert.equal(published,false,"no new presence while blocked")
});

if(failures.length){console.log(`Return gate QA failed (${failures.length} of ${checks.length+failures.length}).`);process.exit(1)}
console.log(`Return gate QA passed (${checks.length} checks).`);
process.exit(0);
