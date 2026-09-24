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

await check("publish timing: 350ms debounce, 2.5s cap while typing continuously, 10s/5s/2s polling",async()=>{
  assert.match(constantsLine,/SYNC_POLL_INTERVAL_MS=10000/);assert.match(constantsLine,/SYNC_OUTBOX_DEBOUNCE_MS=350/);assert.match(constantsLine,/SYNC_OUTBOX_MAX_WAIT_MS=2500/);assert.match(constantsLine,/SYNC_READONLY_POLL_INTERVAL_MS=2000/);
  let prepared=0,presenceCalls=0,scheduled=[];
  const ctx=context({safeRunAsync:(label,task)=>task(),SyncRepository:{prepareOutbox:async()=>{prepared++;return {}}},syncPresenceAfterLocalWrite:async()=>{presenceCalls++},scheduleAutomaticSync:delay=>scheduled.push(delay),DiagnosticsLog:log},["scheduleSyncOutboxPreparation","syncMarkLocalWrite"]);
  vm.runInContext("var syncOutboxTimer=0,syncOutboxFirstRequestAt=0,syncLocalWriteSincePrepare=false,syncLastLocalWriteAt=0,syncInternalStateWrite=false",ctx);
  // Keystrokes every 200ms for 3s: the cap forces a preparation before typing stops.
  const started=Date.now();while(Date.now()-started<3000){ctx.syncMarkLocalWrite();ctx.scheduleSyncOutboxPreparation();await tick(200)}
  assert.ok(prepared>=1,"prepared at least once during continuous typing");assert.equal(presenceCalls,prepared,"presence follows user writes");assert.ok(scheduled.every(delay=>delay===250));
  vm.runInContext("syncInternalStateWrite=true",ctx);assert.equal(ctx.syncMarkLocalWrite(),false,"internal writes do not count as edits");
  const poll=context({navigator:{onLine:true},document:{hidden:false,hasFocus:()=>true}},["syncUserIdle","syncDesiredPollInterval"]);
  vm.runInContext("var syncCloudKnownConnected=true,syncRemoteLease=null,syncReturnGate=false,syncLastUserInputAt=Date.now()",poll);
  assert.equal(poll.syncDesiredPollInterval(),10000);
  vm.runInContext("syncLastUserInputAt=Date.now()-25000",poll);assert.equal(poll.syncDesiredPollInterval(),5000,"idle foreground polls like background");
  vm.runInContext("syncRemoteLease={deviceId:'x'}",poll);assert.equal(poll.syncDesiredPollInterval(),2000,"read-only polls fast")
});

await check("presence decision: keep while dirty or typing, renew near expiry, release when quiet and published",async()=>{
  const ctx=context({},["syncPresenceDecision"]),now=1_000_000,presence={expiresAtMs:now+40000};
  assert.equal(ctx.syncPresenceDecision({now,presence,dirty:true,lastEditAt:now-60000}),"keep");
  assert.equal(ctx.syncPresenceDecision({now,presence,dirty:false,lastEditAt:now-1000}),"keep");
  assert.equal(ctx.syncPresenceDecision({now,presence,dirty:false,lastEditAt:now-4000}),"release");
  assert.equal(ctx.syncPresenceDecision({now,presence:{expiresAtMs:now+5000},dirty:true,lastEditAt:now}),"renew");
  assert.equal(ctx.syncPresenceDecision({now,presence:null}),"none")
});

await check("read-only follows another device's presence, not its commit lease, and honours an override",async()=>{
  let readonly="unset";
  const ctx=context({DiagnosticsLog:log,syncSetReadonly:value=>{readonly=value}},["syncUpdateRemotePresence"]);
  vm.runInContext("var syncOwnPresence=null,syncRemoteLease=null,syncReadonlyOverride=null",ctx);
  const now=Date.now(),device={deviceId:"device-me"};
  const lease={syncType:"lease",objectKey:"sync/leases/lease-1.json",deviceId:"device-phone",createdAtMs:String(now),expiresAtMs:String(now+90000)};
  ctx.syncUpdateRemotePresence([lease],device);assert.equal(readonly,null,"a commit lease alone does not lock editing");
  const presence={syncType:"lease",objectKey:"sync/leases/presence-phone-1.json",deviceId:"mobile-phone",displayName:"iPhone",createdAtMs:String(now-1000),expiresAtMs:String(now+40000)};
  ctx.syncUpdateRemotePresence([lease,presence],device);assert.equal(readonly?.deviceId,"mobile-phone");
  vm.runInContext(`syncOwnPresence={sessionStartedAtMs:${now-5000}}`,ctx);ctx.syncUpdateRemotePresence([presence],device);assert.equal(readonly,null,"the device that started first keeps editing");
  vm.runInContext(`syncOwnPresence=null;syncReadonlyOverride={deviceId:"mobile-phone",sessionStartedAtMs:${now-1000}}`,ctx);ctx.syncUpdateRemotePresence([presence],device);assert.equal(readonly,null,"override skips that session");
  ctx.syncUpdateRemotePresence([],device);assert.equal(vm.runInContext("syncReadonlyOverride",ctx),null,"override clears when the session ends")
});

await check("commit lease handling never toggles read-only and settles before checking the winner",async()=>{
  const source=functionSource("syncEnsureLease");assert.doesNotMatch(source,/syncSetReadonly/);assert.match(source,/SYNC_LEASE_SETTLE_MS/);
  const active=functionSource("syncActiveLeases");assert.match(active,/SyncCoordination\.activeCommitLeases/);assert.match(active,/SyncCoordination\.expiredLeaseObjects/)
});

await check("return gate waits for the other device and lifts automatically",async()=>{
  let cycles=0,gate=null,hidden=false;
  const remote={deviceId:"mobile-phone",displayName:"iPhone",expiresAtMs:String(Date.now()+40000),createdAtMs:String(Date.now())};
  const ctx=context({DiagnosticsLog:log,safeRunAsync:(label,task)=>task(),syncShowReturnGate:(message,options)=>{gate={message,waiting:!!options?.waiting}},syncHideReturnGate:()=>{hidden=true},$:()=>null,runAutomaticSync:async()=>{cycles++;if(cycles>=3)vm.runInContext("syncRemoteLease=null",ctx);return {synced:true}}},["syncCheckOnReturn"]);
  vm.runInContext("var syncWindowWasAway=true,syncReturnGate=false,syncCloudKnownConnected=true,syncReturnGateRun=0,syncAutomaticPromise=null,SYNC_READONLY_POLL_INTERVAL_MS=20",ctx);ctx.syncRemoteLease=remote;
  ctx.syncCheckOnReturn();
  for(let i=0;i<200&&!hidden;i++)await tick(10);
  assert.equal(cycles,3);assert.equal(hidden,true);assert.ok(gate?.waiting,"showed the waiting message");assert.match(gate.message,/iPhone에서 수정 중입니다/)
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
