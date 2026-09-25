import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import vm from "node:vm";

// Loads the real shared model + coordination rules + mobile engine, then drives them against an
// in-memory Google Drive that a simulated Windows device also writes to.
const root=new URL("../",import.meta.url),shared=new URL("../window/web/shared/",root);
for(const file of [new URL("sync-state-model.js",shared),new URL("sync-coordination.js",shared),new URL("web/mobile/mobile-sync-engine.js",root)])vm.runInThisContext(await readFile(file,"utf8"),{filename:file.pathname});
const model=globalThis.HamboardSyncStateModel,coord=globalThis.HamboardSyncCoordination,Engine=globalThis.HamboardMobileSyncEngine;
const sha=value=>createHash("sha256").update(typeof value==="string"?value:Buffer.from(value)).digest("hex");
const clone=value=>structuredClone(value);

let clock=1_800_000_000_000;const now=()=>clock;const advance=ms=>{clock+=ms};
function createDrive(){
  const files=new Map();let seq=0;
  const listing=()=>[...files.values()].map(file=>({...file.meta}));
  return {
    files,connected:true,
    status(){return {connected:this.connected}},
    async listSyncTopology(){return {objects:listing().filter(item=>["commit","checkpoint","lease"].includes(item.syncType)).sort((a,b)=>a._order-b._order),truncated:false}},
    async getSyncValue(object){const file=files.get(object.remoteObjectId);if(!file)throw new Error("google-drive-http-404");return clone(file.value)},
    async put(objectKey,value,meta){const id=`f${++seq}`,content=JSON.stringify(value);files.set(id,{value:clone(value),meta:{remoteObjectId:id,objectKey,contentSha256:sha(content),byteSize:content.length,createdAtMs:String(now()),expiresAtMs:"0",baseRevision:"",revision:"",deviceId:"",displayName:"",clientProfile:"",...meta,_order:seq}});return {...files.get(id).meta}},
    async putSyncText({objectKey,content,syncMetadata}){return this.put(objectKey,JSON.parse(content),syncMetadata)},
    async putSyncValue({objectKey,value,syncMetadata}){return this.put(objectKey,value,syncMetadata)},
    async deleteSyncObject(object){files.delete(object.remoteObjectId);return {deleted:true}},
    async sha256Hex(bytes){return sha(bytes)},
    remove(predicate){for(const [id,file] of files)if(predicate(file.meta))files.delete(id)}
  }
}

// Simulated Windows device: canonical desktop state + the same commit format the desktop writes.
function createDesktop(drive,deviceId="device-pc"){
  let state={schemaVersion:1,projects:[],notes:[],folders:[],mindmaps:[],calendarEvents:[],characterRepository:[],characterFieldTemplates:[],quickMemos:[],trash:[],storyTemplates:[{id:"tpl"}],tagLibrary:[],favorites:[],settings:{theme:"lilac",mode:"light",fontScale:1}},base="",presence=null;
  const heads=()=>{const commits=[...drive.files.values()].map(f=>f.meta).filter(m=>m.syncType==="commit"),parents=new Set(commits.map(c=>c.baseRevision));return commits.filter(c=>!parents.has(c.revision))};
  return {
    get state(){return state},get base(){return base},
    async pull(){const objects=(await drive.listSyncTopology()).objects,path=[];let head=heads();assert.equal(head.length,1,"desktop sees a single head");let cursor=head[0];const byRev=new Map(objects.filter(o=>o.syncType==="commit").map(o=>[o.revision,o]));while(cursor&&cursor.revision!==base){path.unshift(cursor);cursor=byRev.get(cursor.baseRevision)}for(const object of path){const commit=await drive.getSyncValue(object);for(const change of commit.changes)if(change.operation==="upsert")assert.equal(sha(JSON.stringify(change.payload)),change.payloadSha256,"desktop payload hash check");state=model.applyCommitToCanonical(state,commit);base=commit.revision}return path.length},
    async commit(changes,{createdAtMs=now(),baseRevision=base}={}){const revision=`rev-pc-${createdAtMs}-${Math.random().toString(36).slice(2,6)}`,full=changes.map(c=>({...c,payloadSha256:c.operation==="upsert"?sha(JSON.stringify(c.payload)):null})),commit={format:"hamboard-sync-commit",formatVersion:1,stateSchemaVersion:1,revision,baseRevision,deviceId,clientProfile:"desktop",createdAtMs,imageQuality:"balanced",changes:full};state=model.applyCommitToCanonical(state,commit);const uploaded=await drive.putSyncValue({objectKey:`sync/commits/${revision}.json`,value:commit,syncMetadata:{syncType:"commit",revision,baseRevision,deviceId,clientProfile:"desktop",createdAtMs:String(createdAtMs)}});base=revision;return uploaded},
    async startEditing(){const record=coord.presenceRecord({deviceId,displayName:"Windows PC",clientProfile:"desktop",sessionStartedAtMs:now(),expiresAtMs:now()+coord.PRESENCE_TTL_MS,baseRevision:base});presence=await drive.putSyncText({objectKey:record.objectKey,content:record.content,syncMetadata:record.syncMetadata});return presence},
    async stopEditing(){if(presence)await drive.deleteSyncObject(presence);presence=null}
  }
}

function createMobile(drive,{local={schemaVersion:1,projects:[],notes:[]},meta=null,confirm=null,flushPendingSaves=null}={}){
  let state=clone(local);const events=[];const metaStore=Engine.createMemoryMetaStore(meta);
  const engine=Engine.createMobileSyncEngine({drive,syncModel:model,coordination:coord,metaStore,readLocal:()=>clone(state),writeLocal:async next=>{state=clone(next)},hooks:{onStatus:(name,detail)=>events.push([name,detail]),flushPendingSaves:flushPendingSaves||undefined},displayName:"iPhone",now,sleep:async ms=>{advance(ms)},timers:{setTimeout:()=>0,clearTimeout:()=>{}},online:()=>true});
  return {engine,events,metaStore,get state(){return state},replace(next){state=clone(next)},edit(fn){fn(state);engine.notifyLocalWrite()},confirm}
}

const checks=[];async function check(name,run){await run();checks.push(name);console.log("  PASS",name)}
const note=(id,title,extra={})=>({id,title,content:`<p>${title}</p>`,updatedAt:new Date(now()).toISOString(),...extra});

// --- scenarios ------------------------------------------------------------------------------
const drive=createDrive(),pc=createDesktop(drive);
await pc.commit([{entityType:"note",entityId:"n1",operation:"upsert",payload:note("n1","PC 첫 노트")},{entityType:"project",entityId:"p1",operation:"upsert",payload:{id:"p1",title:"작품",kind:"short",stageDefs:[],stages:{}}}]);
const phone=createMobile(drive);await phone.engine.init();

await check("first link on an empty phone imports the Windows state",async()=>{
  const result=await phone.engine.link();assert.equal(result.linked,true);
  assert.equal(phone.state.notes[0].title,"PC 첫 노트");assert.equal(phone.state.projects[0].id,"p1");
  assert.equal(phone.state.storyTemplates,undefined,"desktop-only collections stay off the phone");
  assert.equal(phone.engine.pendingChanges().length,0)
});

await check("phone edit is committed in the Windows format and Windows applies it",async()=>{
  phone.edit(s=>{s.notes[0].content="<p>폰에서 고침</p>";s.notes[0].updatedAt=new Date(now()).toISOString()});
  const result=await phone.engine.sync("test");assert.equal(result.synced,true);assert.ok(result.committed);
  const commit=[...drive.files.values()].find(f=>f.meta.revision===result.committed);
  assert.equal(commit.meta.clientProfile,"mobile-core");assert.equal(commit.value.changes.length,1);
  assert.equal(await pc.pull(),1);assert.equal(pc.state.notes[0].content,"<p>폰에서 고침</p>");
  assert.deepEqual(pc.state.storyTemplates,[{id:"tpl"}],"desktop-only data survives a mobile commit");
  assert.equal(pc.state.settings.fontScale,1,"desktop-only settings survive")
});

await check("phone theme change travels as user-library without touching desktop-only settings",async()=>{
  phone.edit(s=>{s.settings={...(s.settings||{}),mode:"dark"}});const result=await phone.engine.sync("theme");assert.ok(result.committed);
  const commit=[...drive.files.values()].find(f=>f.meta.revision===result.committed).value;assert.deepEqual(commit.changes.map(c=>c.entityType),["user-library"]);
  await pc.pull();assert.equal(pc.state.settings.mode,"dark");assert.equal(pc.state.settings.fontScale,1);assert.equal(pc.state.settings.theme,"lilac")
});

await check("commit lease is released and presence is withdrawn after the quiet period",async()=>{
  assert.equal([...drive.files.values()].filter(f=>coord.isCommitLease(f.meta)).length,0);
  assert.equal([...drive.files.values()].filter(f=>coord.isPresence(f.meta)).length,1,"presence published on first edit");
  advance(coord.PRESENCE_IDLE_GRACE_MS+10);assert.equal(await phone.engine._presenceTick(),"release");
  assert.equal([...drive.files.values()].filter(f=>coord.isPresence(f.meta)).length,0)
});

await check("returning while Windows is editing waits, then unlocks with the Windows change applied",async()=>{
  await pc.startEditing();let waits=0;
  const pending=phone.engine.checkOnReturn({onWaiting:async remote=>{waits++;assert.equal(remote.displayName,"Windows PC");assert.equal(phone.engine.isReadonly(),true);if(waits===2){await pc.commit([{entityType:"note",entityId:"n1",operation:"upsert",payload:{...pc.state.notes[0],content:"<p>PC에서 이어서 고침</p>"}}]);await pc.stopEditing()}}});
  const result=await pending;assert.equal(result.synced,true);assert.ok(waits>=2);
  assert.equal(phone.engine.isReadonly(),false);assert.equal(phone.state.notes[0].content,"<p>PC에서 이어서 고침</p>")
});

await check("phone that started editing first is not blocked by a later Windows session",async()=>{
  phone.edit(s=>{s.projects[0].title="폰이 먼저"});await phone.engine.sync("x");
  const own=[...drive.files.values()].find(f=>coord.isPresence(f.meta)&&f.meta.deviceId.startsWith("mobile-"));assert.ok(own);
  advance(50);await pc.startEditing();await phone.engine.sync("poll");assert.equal(phone.engine.isReadonly(),false);
  await pc.stopEditing();await pc.pull();advance(coord.PRESENCE_IDLE_GRACE_MS+10);await phone.engine._presenceTick()
});

await check("both devices edit the same note: Windows keeps the id, phone text survives as a copy",async()=>{
  phone.edit(s=>{s.notes[0].content="<p>폰 버전</p>";s.notes[0].updatedAt=new Date(now()).toISOString()});
  await pc.commit([{entityType:"note",entityId:"n1",operation:"upsert",payload:{...pc.state.notes[0],content:"<p>PC 버전</p>"}}]);
  const result=await phone.engine.sync("x");assert.equal(result.synced,true);assert.equal(result.conflicts,1);
  const original=phone.state.notes.find(n=>n.id==="n1"),copy=phone.state.notes.find(n=>n.id!=="n1");
  assert.equal(original.content,"<p>PC 버전</p>");assert.equal(copy.content,"<p>폰 버전</p>");assert.match(copy.title,/충돌 복사본/);
  await pc.pull();assert.equal(pc.state.notes.length,2,"the copy reaches Windows");
  assert.ok(phone.events.some(([name])=>name==="conflicts"))
});

await check("simultaneous commits on one base: the later one withdraws and re-commits on top",async()=>{
  phone.edit(s=>{s.projects[0].title="폰 동시"});
  // Windows publishes a commit on the same base, stamped earlier, right after the phone's lease settles.
  const base=phone.engine.status().baseRevision,realPut=drive.putSyncValue.bind(drive);let injected=false;
  drive.putSyncValue=async request=>{const out=await realPut(request);if(!injected&&request.syncMetadata.syncType==="commit"){injected=true;await pc.commit([{entityType:"note",entityId:"n1",operation:"upsert",payload:{...pc.state.notes.find(n=>n.id==="n1"),title:"PC 동시"}}],{createdAtMs:now()-1000,baseRevision:base})}return out};
  const first=await phone.engine.sync("x");drive.putSyncValue=realPut;
  assert.equal(first.deferred,"concurrent-commit-lost");
  const second=await phone.engine.sync("retry");assert.equal(second.synced,true);assert.ok(second.committed);
  await pc.pull();assert.equal(pc.state.projects[0].title,"폰 동시");assert.equal(pc.state.notes.find(n=>n.id==="n1").title,"PC 동시");
  assert.equal(phone.state.notes.find(n=>n.id==="n1").title,"PC 동시")
});

await check("compacted history (base commit deleted by GC) rebuilds from a checkpoint without losing local edits",async()=>{
  phone.edit(s=>{s.projects[0].subtitle="오프라인 수정"});
  await pc.commit([{entityType:"note",entityId:"n9",operation:"upsert",payload:note("n9","새 PC 노트")}]);
  await drive.put(`sync/checkpoints/${pc.base}.json`,{format:"hamboard-sync-checkpoint",formatVersion:1,stateSchemaVersion:1,cloudUserDataVersion:model.CLOUD_USER_DATA_VERSION,revision:pc.base,createdAtMs:now(),state:model.projectCloudUserData(pc.state,model.CLIENT_PROFILES.desktop)},{syncType:"checkpoint",revision:pc.base,clientProfile:"desktop"});
  const keep=pc.base;drive.remove(meta=>meta.syncType==="commit"&&meta.revision!==keep);
  const result=await phone.engine.sync("x");assert.equal(result.synced,true);
  assert.ok(phone.state.notes.some(n=>n.id==="n9"));assert.equal(phone.state.projects[0].subtitle,"오프라인 수정");
  await pc.pull();assert.equal(pc.state.projects[0].subtitle,"오프라인 수정")
});

await check("phone edits made before a reload are still pushed after restart",async()=>{
  const saved=phone.metaStore.peek(),reloaded=createMobile(drive,{local:phone.state,meta:saved});await reloaded.engine.init();
  const stateNow=reloaded.state;stateNow.notes[0].title="재시작 전 수정";
  const again=createMobile(drive,{local:stateNow,meta:saved});await again.engine.init();
  assert.equal(again.engine.status().dirty,true);const result=await again.engine.sync("startup");assert.ok(result.committed);
  await pc.pull();assert.equal(pc.state.notes[0].title,"재시작 전 수정")
});

await check("first link with phone-only documents asks before uploading them",async()=>{
  const lone=createMobile(drive,{local:{schemaVersion:1,projects:[],notes:[note("only-phone","폰에만 있음")]}});await lone.engine.init();
  const kept=await lone.engine.link({confirm:async info=>{assert.equal(info.localOnly,1);return false}});
  assert.equal(kept.uploadedLocalOnly,false);assert.ok(!lone.state.notes.some(n=>n.id==="only-phone"));
  const other=createMobile(drive,{local:{schemaVersion:1,projects:[],notes:[note("only-phone-2","올릴 문서")]}});await other.engine.init();
  const uploaded=await other.engine.link({confirm:async()=>true});assert.equal(uploaded.uploadedLocalOnly,true);
  await pc.pull();assert.ok(pc.state.notes.some(n=>n.id==="only-phone-2"))
});

await check("a suspended phone (after a local backup restore) neither pulls nor pushes",async()=>{
  await phone.engine.suspend("backup-restore");phone.edit(s=>{s.notes=[]});
  const result=await phone.engine.sync("x");assert.equal(result.skipped,"suspended");
  await phone.engine.resetFromCloud();assert.ok(phone.state.notes.length>0,"cloud state restored");assert.equal(phone.engine.status().suspended,"")
});

await check("backup restore waits for an in-flight upload, then stays paused across restart",async()=>{
  const isolatedDrive=createDrive(),isolatedPc=createDesktop(isolatedDrive);
  await isolatedPc.commit([{entityType:"note",entityId:"safe",operation:"upsert",payload:note("safe","클라우드 원본")}]);
  let holdFlush=false,finishFlush;const pendingSave=new Promise(resolve=>{finishFlush=resolve});
  const isolatedPhone=createMobile(isolatedDrive,{flushPendingSaves:()=>holdFlush?pendingSave:undefined});await isolatedPhone.engine.init();await isolatedPhone.engine.link();
  let enteredUpload;const uploading=new Promise(resolve=>{enteredUpload=resolve});
  let finishUpload;const held=new Promise(resolve=>{finishUpload=resolve});
  const originalPut=isolatedDrive.putSyncValue.bind(isolatedDrive);
  isolatedDrive.putSyncValue=async request=>{
    if(request.syncMetadata.syncType==="commit"){enteredUpload();await held}
    return originalPut(request)
  };
  isolatedPhone.edit(state=>{state.notes[0].title="업로드 진행 중"});
  const inFlight=isolatedPhone.engine.sync("test"),reached=uploading;
  await reached;
  holdFlush=true;
  let paused=false;const pause=isolatedPhone.engine.suspend("backup-restore").then(()=>{paused=true});
  assert.equal(isolatedPhone.engine.status().suspended,"pausing");
  assert.equal((await isolatedPhone.engine.sync("queued")).skipped,"suspended");
  assert.equal(paused,false,"restore must wait before replacing local state");
  finishUpload();await inFlight;
  assert.equal(paused,false,"restore also waits for pending local saves");
  finishFlush();await pause;
  assert.equal(isolatedPhone.engine.status().suspended,"backup-restore");
  const commitsBeforeRestore=[...isolatedDrive.files.values()].filter(file=>file.meta.syncType==="commit").length;
  isolatedPhone.replace({schemaVersion:1,notes:[note("safe","오래된 백업")]});
  assert.equal((await isolatedPhone.engine.sync("poll")).skipped,"suspended");
  assert.equal([...isolatedDrive.files.values()].filter(file=>file.meta.syncType==="commit").length,commitsBeforeRestore);
  const restarted=createMobile(isolatedDrive,{local:isolatedPhone.state,meta:isolatedPhone.metaStore.peek()});
  await restarted.engine.init();assert.equal(restarted.engine.status().suspended,"backup-restore");
  assert.equal((await restarted.engine.sync("startup")).skipped,"suspended");
  assert.equal([...isolatedDrive.files.values()].filter(file=>file.meta.syncType==="commit").length,commitsBeforeRestore);
  isolatedDrive.putSyncValue=originalPut
});

await check("expired presence from a crashed device stops blocking",async()=>{
  await pc.startEditing();await phone.engine.sync("x");assert.equal(phone.engine.isReadonly(),true);
  advance(coord.PRESENCE_TTL_MS+1);await phone.engine.sync("x");assert.equal(phone.engine.isReadonly(),false);await pc.stopEditing()
});

await check("override lets the user edit without waiting, only for that session",async()=>{
  await pc.startEditing();await phone.engine.sync("x");assert.equal(phone.engine.isReadonly(),true);
  assert.equal(phone.engine.overrideRemote(),true);await phone.engine.sync("x");assert.equal(phone.engine.isReadonly(),false);
  await pc.stopEditing();advance(10);await pc.startEditing();await phone.engine.sync("x");assert.equal(phone.engine.isReadonly(),true,"a new session blocks again");await pc.stopEditing()
});

await check("first link preserves every differing local entity regardless of updatedAt",async()=>{
  const remote={schemaVersion:1,notes:[{id:"same-note",title:"PC",content:"remote",updatedAt:"2026-09-23T00:00:00.000Z"}],calendarEvents:[{id:"same-event",title:"PC 일정"}],folders:[{id:"same-folder",name:"PC 폴더"}],projects:[],mindmaps:[],characterRepository:[],characterFieldTemplates:[],trash:[],quickMemos:[],tagLibrary:[],favorites:[],settings:{mode:"light"}};
  const local={schemaVersion:1,notes:[{id:"same-note",title:"폰",content:"local",updatedAt:"2026-09-22T00:00:00.000Z"}],calendarEvents:[{id:"same-event",title:"폰 일정"}],folders:[{id:"same-folder",name:"폰 폴더"}],projects:[],mindmaps:[],characterRepository:[],characterFieldTemplates:[],trash:[],quickMemos:[],tagLibrary:[],favorites:[],settings:{mode:"light"}};
  let seq=0;const result=Engine.mergeStates({syncModel:model,profile:model.CLIENT_PROFILES.mobileCore,base:null,remote,local,initial:true,preserveInitialConflicts:true,newId:()=>`copy-${++seq}`,now:Date.parse("2026-09-23T12:00:00.000Z")});
  assert.equal(result.merged.notes.find(x=>x.id==="same-note").content,"remote");
  assert.ok(result.merged.notes.some(x=>x.id!=="same-note"&&x.content==="local"),"older local note survives as a copy");
  assert.ok(result.merged.calendarEvents.some(x=>x.id!=="same-event"&&x.title.startsWith("폰 일정")),"event without updatedAt survives");
  assert.equal(result.merged.folders.length,1,"no empty duplicate folder");
  assert.ok(!result.merged.folders[0].name.startsWith("폰 폴더"),"the folder follows the cloud");
  const folderNote=result.conflicts.find(item=>item.kind==="initial-folder-cloud");
  assert.ok(folderNote&&folderNote.localName.startsWith("폰 폴더"),"the phone's previous folder name is reported");
  assert.equal(result.copies,2,"note and event copies; the folder is not copied")
});

await check("user-library merges tags/favorites/settings by item or key and reports only irreconcilable fields",async()=>{
  const base={schemaVersion:1,tagLibrary:["base"],favorites:[{type:"note",id:"n1"}],settings:{theme:"lilac",mode:"light"}};
  const remote={...clone(base),tagLibrary:["base","pc-tag"],settings:{theme:"cotton-candy",mode:"light"}};
  const local={...clone(base),tagLibrary:["base","phone-tag"],favorites:[{type:"note",id:"n1"},{type:"project",id:"p1"}],settings:{theme:"lilac",mode:"dark"}};
  const merged=Engine.mergeStates({syncModel:model,profile:model.CLIENT_PROFILES.mobileCore,base,remote,local});
  assert.deepEqual(new Set(merged.merged.tagLibrary),new Set(["base","pc-tag","phone-tag"]));
  assert.ok(merged.merged.favorites.some(x=>x.type==="project"&&x.id==="p1"));
  assert.equal(merged.merged.settings.theme,"cotton-candy");assert.equal(merged.merged.settings.mode,"dark");
  assert.ok(merged.conflicts.some(x=>x.type==="user-library"&&x.kind==="field-merged"));
  const remote2={...clone(base),settings:{...base.settings,mode:"dark"}},local2={...clone(base),settings:{...base.settings,mode:"sepia"}};
  const conflict=Engine.mergeStates({syncModel:model,profile:model.CLIENT_PROFILES.mobileCore,base,remote:remote2,local:local2});
  assert.equal(conflict.merged.settings.mode,"dark");assert.ok(conflict.conflicts.some(x=>x.kind==="field-conflict-remote-kept"&&x.fields.some(f=>f.includes("workspace.settings.mode"))))
});

await check("support entities merge non-overlapping fields instead of dropping the phone side",async()=>{
  const base={schemaVersion:1,folders:[{id:"f1",name:"기본",color:"gray"}]},remote={schemaVersion:1,folders:[{id:"f1",name:"PC 이름",color:"gray"}]},local={schemaVersion:1,folders:[{id:"f1",name:"기본",color:"blue"}]};
  const result=Engine.mergeStates({syncModel:model,profile:model.CLIENT_PROFILES.mobileCore,base,remote,local});
  const folder=result.merged.folders.find(x=>x.id==="f1");assert.equal(folder.name,"PC 이름");assert.equal(folder.color,"blue");assert.ok(result.conflicts.some(x=>x.type==="folder"&&x.kind==="field-merged"))
});

await check("shared topology ignores an orphan head when exactly one head is checkpoint-anchored",async()=>{
  const objects=[
    {syncType:"commit",objectKey:"sync/commits/c1.json",revision:"c1",baseRevision:""},
    {syncType:"commit",objectKey:"sync/commits/c2.json",revision:"c2",baseRevision:"c1"},
    {syncType:"checkpoint",objectKey:"sync/checkpoints/c2.json",revision:"c2"},
    {syncType:"commit",objectKey:"sync/commits/old.json",revision:"old",baseRevision:"missing"}
  ];
  const desktop=coord.commitTopology(objects,""),mobile=Engine.topology(objects,"");
  assert.equal(desktop.error,undefined);assert.equal(mobile.error,undefined);assert.equal(desktop.head.revision,"c2");assert.equal(mobile.head.revision,"c2");assert.deepEqual(desktop.orphanHeads.map(x=>x.revision),["old"]);assert.deepEqual(mobile.orphanHeads.map(x=>x.revision),["old"])
});

await check("shared rules: deterministic sibling winner and young-fork healing",async()=>{
  const a={revision:"rev-b",createdAtMs:"10",baseRevision:"x"},b={revision:"rev-a",createdAtMs:"10",baseRevision:"x"},c={revision:"rev-c",createdAtMs:"9",baseRevision:"x"};
  assert.equal(coord.siblingWinner([a,b]).revision,"rev-a");assert.equal(coord.siblingWinner([a,b,c]).revision,"rev-c");
  assert.equal(coord.isYoungSiblingFork([{...a,createdAtMs:String(now())},{...b,createdAtMs:String(now())}],now()),true);
  assert.equal(coord.isYoungSiblingFork([{...a,createdAtMs:"1"},{...b,createdAtMs:"1"}],now()),false);
  assert.equal(coord.isCommitLease({syncType:"lease",objectKey:"sync/leases/presence-x-1.json"}),false);
  assert.equal(coord.isPresence({syncType:"lease",objectKey:"sync/leases/presence-x-1.json"}),true);
  assert.ok(coord.presenceRecord({deviceId:`device-${"a".repeat(36)}`,displayName:"아주아주긴기기이름".repeat(8),sessionStartedAtMs:1,expiresAtMs:2}).objectKey.length<=100)
});

// --- regressions for the shared-topology / restore review -----------------------------------
await check("returning after GC compacted several commits rebuilds from the checkpoint (no silent loss)",async()=>{
  const d=createDrive(),p=createDesktop(d);
  await p.commit([{entityType:"note",entityId:"A",operation:"upsert",payload:note("A","A 원본")},{entityType:"note",entityId:"B",operation:"upsert",payload:note("B","B 원본")},{entityType:"note",entityId:"C",operation:"upsert",payload:note("C","C 원본")},{entityType:"note",entityId:"L",operation:"upsert",payload:note("L","L 원본")}]);
  const m=createMobile(d);await m.engine.init();await m.engine.link();
  const first=p.base;
  // Phone edits L offline while PC keeps working; PC's checkpoint lands on the middle commit, then GC runs.
  m.edit(s=>{s.notes.find(n=>n.id==="L").title="L 폰에서 고침"});
  await p.commit([{entityType:"note",entityId:"A",operation:"upsert",payload:note("A","A PC에서 고침")}]);const c2=p.base;
  await p.commit([{entityType:"note",entityId:"B",operation:"upsert",payload:note("B","B PC에서 고침")}]);const c3=p.base;
  await d.put(`sync/checkpoints/${c3}.json`,{format:"hamboard-sync-checkpoint",formatVersion:1,stateSchemaVersion:1,cloudUserDataVersion:model.CLOUD_USER_DATA_VERSION,revision:c3,createdAtMs:now(),state:model.projectCloudUserData(p.state,model.CLIENT_PROFILES.desktop)},{syncType:"checkpoint",revision:c3,clientProfile:"desktop"});
  await p.commit([{entityType:"note",entityId:"C",operation:"upsert",payload:note("C","C PC에서 고침")}]);
  d.remove(meta=>meta.syncType==="commit"&&[first,c2,c3].includes(meta.revision));
  const result=await m.engine.sync("return");assert.equal(result.synced,true);
  const title=id=>m.state.notes.find(n=>n.id===id).title;
  assert.equal(title("A"),"A PC에서 고침","change compacted into the checkpoint arrives");
  assert.equal(title("B"),"B PC에서 고침");assert.equal(title("C"),"C PC에서 고침");
  assert.equal(title("L"),"L 폰에서 고침","offline phone edit survives the rebuild");
  await p.pull();assert.equal(p.state.notes.find(n=>n.id==="L").title,"L 폰에서 고침");assert.equal(p.state.notes.find(n=>n.id==="A").title,"A PC에서 고침","phone did not push stale A back")
});

await check("shared topology never reports a base it did not reach",async()=>{
  const c=(r,b)=>({syncType:"commit",objectKey:`sync/commits/${r}.json`,revision:r,baseRevision:b}),cp=r=>({syncType:"checkpoint",objectKey:`sync/checkpoints/${r}.json`,revision:r});
  assert.equal(coord.commitTopology([cp("c3"),c("c4","c3"),c("c5","c4")],"c1").error,"base-revision-missing");
  assert.equal(coord.commitTopology([cp("c3"),c("c3","c2"),c("c4","c3")],"c1").error,"base-revision-missing");
  const normal=coord.commitTopology([c("c4","c3"),c("c5","c4")],"c4");assert.equal(normal.error,undefined);assert.deepEqual(normal.path.map(x=>x.revision),["c5"]);assert.equal(normal.compacted,false);
  const gcParent=coord.commitTopology([c("c5","c4"),c("c6","c5")],"c4");assert.equal(gcParent.error,undefined,"GC'd base that is the direct parent is still exact");assert.deepEqual(gcParent.path.map(x=>x.revision),["c5","c6"]);
  assert.equal(Engine.topology([cp("c3"),c("c4","c3")],"c1").foundBase,false,"mobile fallback rebuilds instead of replaying")
});

await check("user-library lists keep the remote order when only the remote reordered, and the local order otherwise",async()=>{
  const fav=id=>({type:"note",id}),profile=model.CLIENT_PROFILES.mobileCore,base={schemaVersion:1,tagLibrary:["a","b"],favorites:[fav("x"),fav("y")]};
  const r1=Engine.mergeStates({syncModel:model,profile,base,remote:{...clone(base),favorites:[fav("y"),fav("x")]},local:{...clone(base),tagLibrary:["a","b","폰"]}});
  assert.deepEqual(r1.merged.favorites.map(f=>f.id),["y","x"]);assert.deepEqual(r1.merged.tagLibrary,["a","b","폰"]);
  assert.equal(model.diffClientProjection({...clone(base),favorites:[fav("y"),fav("x")]},r1.merged,profile)[0].payload.favorites.map(f=>f.id).join(),"y,x","the push does not undo the PC reorder");
  const r2=Engine.mergeStates({syncModel:model,profile,base,remote:{...clone(base),tagLibrary:["a","b","PC"]},local:{...clone(base),favorites:[fav("y"),fav("x")]}});
  assert.deepEqual(r2.merged.favorites.map(f=>f.id),["y","x"],"a phone-only reorder is kept");assert.deepEqual(r2.merged.tagLibrary,["a","b","PC"])
});

await check("resume() undoes only the pause it matches and re-arms pending edits",async()=>{
  const d=createDrive(),p=createDesktop(d);await p.commit([{entityType:"note",entityId:"r1",operation:"upsert",payload:note("r1","원본")}]);
  const m=createMobile(d);await m.engine.init();await m.engine.link();
  await m.engine.suspend("backup-restore");m.replace({...clone(m.state),notes:[{...m.state.notes[0],title:"멈춘 동안 저장된 편집"}]});
  assert.equal((await m.engine.resume("file-import")).suspended,"backup-restore","a different pause is left alone");
  const status=await m.engine.resume("backup-restore");assert.equal(status.suspended,"");assert.equal(status.dirty,true);
  const result=await m.engine.sync("after-resume");assert.ok(result.committed);await p.pull();assert.equal(p.state.notes[0].title,"멈춘 동안 저장된 편집")
});

await check("after the cloud sync history is reset, the phone rebuilds from the new root instead of retrying forever",async()=>{
  const d=createDrive(),p=createDesktop(d);await p.commit([{entityType:"note",entityId:"k",operation:"upsert",payload:note("k","옛 기록")}]);
  const m=createMobile(d);await m.engine.init();await m.engine.link();
  m.edit(s=>{s.notes.push(note("phone-only","초기화 중 폰에서 만든 노트"))});
  d.remove(meta=>meta.syncType==="commit");
  const fresh=createDesktop(d);await fresh.commit([{entityType:"note",entityId:"k",operation:"upsert",payload:note("k","새 기록")}]);
  const result=await m.engine.sync("after-reset");assert.equal(result.blocked,undefined);assert.equal(result.synced,true);
  assert.equal(m.state.notes.find(n=>n.id==="k").title,"새 기록");assert.ok(m.state.notes.some(n=>n.id==="phone-only"),"offline phone note kept");
  await fresh.pull();assert.ok(fresh.state.notes.some(n=>n.id==="phone-only"),"and uploaded to the new history")
});

await check("a suspend that cannot be recorded restores polling and the cancelled upload (timers only, no manual sync)",async()=>{
  const d=createDrive(),p=createDesktop(d);await p.commit([{entityType:"note",entityId:"s",operation:"upsert",payload:note("s","원본")}]);
  const inner=Engine.createMemoryMetaStore(null);let failWrites=false;
  const metaStore={read:()=>inner.read(),write:async value=>{if(failWrites)throw new Error("meta-write-failed");return inner.write(value)}};
  // Recording timers: the test only advances by firing what the engine itself scheduled.
  const scheduled=new Map();let timerId=0;
  const timers={setTimeout:(fn,ms)=>{const id=++timerId;scheduled.set(id,{fn,ms});return id},clearTimeout:id=>scheduled.delete(id)};
  let state={schemaVersion:1,projects:[],notes:[]},engineRef=null;
  const hooks={flushPendingSaves:async()=>{
    // A note save that was still debounced lands while the pause is pending.
    if(state.notes[0]&&!state.notes.some(n=>n.id==="late")){state.notes.push(note("late","멈춤 중에 저장된 노트"));engineRef.notifyLocalWrite()}
  }};
  const engine=engineRef=Engine.createMobileSyncEngine({drive:d,syncModel:model,coordination:coord,metaStore,readLocal:()=>clone(state),writeLocal:async next=>{state=clone(next)},hooks,displayName:"iPhone",now,sleep:async ms=>{advance(ms)},timers,online:()=>true});
  await engine.init();await engine.link();engine.startPolling({immediate:false});
  state.notes[0].title="멈춤 실패 전 편집";engine.notifyLocalWrite();
  failWrites=true;await assert.rejects(engine.suspend("backup-restore"),/meta-write-failed/);failWrites=false;
  assert.equal(engine.status().suspended,"","not paused");
  const kinds=[...scheduled.values()];assert.ok(kinds.length>=2,"poll and upload are scheduled again");
  // Fire only engine-scheduled timers, like the browser would.
  for(let round=0;round<8&&scheduled.size;round++){const [id,{fn}]=[...scheduled][0];scheduled.delete(id);await fn();await Promise.resolve()}
  await p.pull();
  assert.equal(p.state.notes.find(n=>n.id==="s").title,"멈춤 실패 전 편집","the edit whose upload was cancelled goes up");
  assert.ok(p.state.notes.some(n=>n.id==="late"),"the edit flushed during the pause attempt goes up too")
});

await check("first link: folders follow the cloud without a dialog, and the old name comes back for the notice",async()=>{
  const d=createDrive(),p=createDesktop(d);
  await p.commit([{entityType:"folder",entityId:"f1",operation:"upsert",payload:{id:"f1",name:"PC 폴더"}},{entityType:"note",entityId:"n1",operation:"upsert",payload:note("n1","같은 노트",{folderId:"f1"})}]);
  const local={schemaVersion:1,projects:[],folders:[{id:"f1",name:"폰에서 바꾼 폴더"}],notes:[{...p.state.notes[0]}]};
  let asked=0;const m=createMobile(d,{local});await m.engine.init();
  const result=await m.engine.link({confirm:async()=>{asked++;return true}});
  assert.equal(asked,0,"a folder-only difference does not ask about copies");
  assert.deepEqual(m.state.folders.map(f=>`${f.id}:${f.name}`),["f1:PC 폴더"]);
  assert.equal(m.state.notes[0].folderId,"f1","notes stay in the folder");
  assert.deepEqual(result.foldersFollowedCloud,[{id:"f1",localName:"폰에서 바꾼 폴더",cloudName:"PC 폴더"}]);
  assert.equal(result.conflictCopies,0);
  await p.pull();assert.equal(p.state.folders.length,1,"nothing extra reaches the PC")
});

await check("first link: a differing document still asks, and the count excludes folders",async()=>{
  const d=createDrive(),p=createDesktop(d);
  await p.commit([{entityType:"folder",entityId:"f1",operation:"upsert",payload:{id:"f1",name:"PC 폴더"}},{entityType:"note",entityId:"n1",operation:"upsert",payload:note("n1","PC 내용")}]);
  const local={schemaVersion:1,projects:[],folders:[{id:"f1",name:"폰 폴더"}],notes:[note("n1","폰 내용")]};
  let info=null;const m=createMobile(d,{local});await m.engine.init();
  await m.engine.link({confirm:async value=>{info=value;return {uploadLocalOnly:true,preserveConflicts:true}}});
  assert.equal(info.copies,1,"only the note is a copy candidate");
  assert.equal(m.state.notes.length,2,"note copy kept");assert.equal(m.state.folders.length,1,"folder not duplicated")
});

await check("first link: a differing trash entry keeps only the more recently deleted version, without a copy",async()=>{
  const profile=model.CLIENT_PROFILES.mobileCore,entry=(label,at)=>({id:"t1",type:"note",label,payload:{id:"x",title:label},meta:{},deletedAt:at});
  const merge=(localAt,cloudAt)=>Engine.mergeStates({syncModel:model,profile,base:null,initial:true,preserveInitialConflicts:true,remote:{schemaVersion:1,trash:[entry("클라우드",cloudAt)]},local:{schemaVersion:1,trash:[entry("폰",localAt)]}});
  const newerPhone=merge("2026-09-20T10:00:00.000Z","2026-09-19T10:00:00.000Z");
  assert.deepEqual(newerPhone.merged.trash.map(t=>t.label),["폰"]);assert.equal(newerPhone.copies,0);assert.equal(newerPhone.conflicts[0].kept,"local");
  const newerCloud=merge("2026-09-18T10:00:00.000Z","2026-09-19T10:00:00.000Z");assert.deepEqual(newerCloud.merged.trash.map(t=>t.label),["클라우드"]);
  const tie=merge("2026-09-19T10:00:00.000Z","2026-09-19T10:00:00.000Z");assert.deepEqual(tie.merged.trash.map(t=>t.label),["클라우드"],"cloud on a tie");
  const noDate=merge("","2026-09-19T10:00:00.000Z");assert.deepEqual(noDate.merged.trash.map(t=>t.label),["클라우드"]);
  // Through link(): trash differences do not trigger the copy dialog.
  const d=createDrive(),p=createDesktop(d);await p.commit([{entityType:"trash",entityId:"t1",operation:"upsert",payload:entry("클라우드","2026-09-19T10:00:00.000Z")}]);
  let asked=0;const m=createMobile(d,{local:{schemaVersion:1,projects:[],notes:[],trash:[entry("폰","2026-09-20T10:00:00.000Z")]}});await m.engine.init();
  await m.engine.link({confirm:async()=>{asked++;return true}});assert.equal(asked,0);
  assert.deepEqual(m.state.trash.map(t=>t.label),["폰"]);await p.pull();assert.deepEqual(p.state.trash.map(t=>t.label),["폰"],"the kept version reaches the PC")
});

await check("new episodes, reordered parts and blocks, and mindmap edits round-trip without losing desktop data",async()=>{
  const d=createDrive(),p=createDesktop(d),project={id:"story",title:"장편",kind:"long",episodes:[{id:"ep-1",title:"1화",subtitle:"",stageDefs:[{id:"part-a",name:"기"},{id:"part-b",name:"승"}],stages:{"part-a":[{id:"block-a",type:"detail",title:"첫 블록",children:[]}],"part-b":[]}}]};
  const mindmap={id:"map",title:"구상",nodes:[{id:"node-1",type:"text",title:"처음",x:10,y:20}],groups:[],edges:[],viewport:{x:40,y:40,zoom:1}};
  await p.commit([{entityType:"project",entityId:"story",operation:"upsert",payload:project},{entityType:"mindmap",entityId:"map",operation:"upsert",payload:mindmap}]);
  const m=createMobile(d);await m.engine.init();await m.engine.link();
  m.edit(s=>{
    const story=s.projects.find(item=>item.id==="story"),first=story.episodes[0];
    story.episodes.push({id:"ep-2",title:"2화",subtitle:"새 화",stageDefs:[{id:"part-c",name:"시작"}],stages:{"part-c":[{id:"script-1",type:"script",title:"대화",scriptBlocks:[{id:"line-1",type:"dialogue",speaker:"화자",text:"대사"}],children:[]}]}});
    first.stageDefs.reverse();first.stages["part-b"].push(first.stages["part-a"].shift());
    s.mindmaps[0].subtitle="폰에서 추가";s.mindmaps[0].nodes.push({id:"node-2",type:"text",title:"다음",x:300,y:20});s.mindmaps[0].edges.push({id:"edge-1",from:"node-1",to:"node-2"})
  });
  const upload=await m.engine.sync("new-mobile-edits");assert.equal(upload.synced,true);
  const commit=[...d.files.values()].find(file=>file.meta.revision===upload.committed).value;
  assert.deepEqual(commit.changes.map(change=>change.entityType),["project","mindmap"]);
  await p.pull();
  assert.deepEqual(p.state.projects.find(item=>item.id==="story").episodes.map(item=>item.id),["ep-1","ep-2"]);
  assert.deepEqual(p.state.projects.find(item=>item.id==="story").episodes[0].stageDefs.map(item=>item.id),["part-b","part-a"]);
  assert.equal(p.state.projects.find(item=>item.id==="story").episodes[0].stages["part-b"][0].id,"block-a");
  assert.equal(p.state.projects.find(item=>item.id==="story").episodes[1].stages["part-c"][0].scriptBlocks[0].text,"대사");
  assert.equal(p.state.mindmaps[0].edges[0].to,"node-2");assert.deepEqual(p.state.storyTemplates,[{id:"tpl"}]);
  await p.commit([{entityType:"project",entityId:"story",operation:"upsert",payload:{...p.state.projects[0],episodes:[...p.state.projects[0].episodes].reverse()}},{entityType:"mindmap",entityId:"map",operation:"upsert",payload:{...p.state.mindmaps[0],nodes:[...p.state.mindmaps[0].nodes,{id:"node-3",type:"text",title:"PC 노드"}]}}]);
  const download=await m.engine.sync("pc-edits");assert.equal(download.synced,true);
  assert.deepEqual(m.state.projects[0].episodes.map(item=>item.id),["ep-2","ep-1"]);
  assert.ok(m.state.mindmaps[0].nodes.some(item=>item.id==="node-3"));assert.equal(m.engine.pendingChanges().length,0)
});

await check("simultaneous edits to the same project or mindmap still preserve mobile conflict copies",async()=>{
  const base={schemaVersion:1,projects:[{id:"p",title:"장편",kind:"long",episodes:[{id:"e",title:"1화",stageDefs:[],stages:{}}]}],mindmaps:[{id:"m",title:"구상",nodes:[],edges:[]}]};
  const remote=clone(base),local=clone(base);
  remote.projects[0].episodes[0].title="PC 화";local.projects[0].episodes[0].title="폰 화";
  remote.mindmaps[0].nodes.push({id:"pc-node",title:"PC"});local.mindmaps[0].nodes.push({id:"mobile-node",title:"폰"});
  const merged=Engine.mergeStates({syncModel:model,profile:model.CLIENT_PROFILES.mobileCore,base,remote,local,newId:(()=>{let i=0;return()=>`copy-${++i}`})()});
  assert.equal(merged.copies,2);assert.equal(merged.merged.projects.find(item=>item.id==="p").episodes[0].title,"PC 화");
  assert.equal(merged.merged.projects.find(item=>item.id!=="p").episodes[0].title,"폰 화");
  assert.equal(merged.merged.mindmaps.find(item=>item.id==="m").nodes[0].id,"pc-node");
  assert.equal(merged.merged.mindmaps.find(item=>item.id!=="m").nodes[0].id,"mobile-node")
});

// --- return check: read-only probe first, pull only when another device changed something ---------
function countWrites(drive){const counts={text:0,value:0};const text=drive.putSyncText.bind(drive),value=drive.putSyncValue.bind(drive);drive.putSyncText=async request=>{counts.text++;return text(request)};drive.putSyncValue=async request=>{counts.value++;return value(request)};return counts}
const mobileCommits=drive=>[...drive.files.values()].filter(file=>file.meta.syncType==="commit"&&file.meta.clientProfile==="mobile-core").length;
async function linkedPhone(){
  const d=createDrive(),p=createDesktop(d);await p.commit([{entityType:"note",entityId:"r1",operation:"upsert",payload:note("r1","원본")},{entityType:"note",entityId:"r2",operation:"upsert",payload:note("r2","다른 노트")}]);
  const m=createMobile(d);await m.engine.init();await m.engine.link();return {d,p,m}
}

await check("return with an unsent phone edit and nothing new remotely: the check lets the user in without uploading",async()=>{
  const {d,m}=await linkedPhone();
  m.edit(s=>{s.notes.find(n=>n.id==="r1").title="숨기기 직전 편집"});
  const writes=countWrites(d);
  const result=await m.engine.checkOnReturn();
  assert.equal(result.upToDate,true);assert.equal(writes.text+writes.value,0,"no lease, presence or commit during the check");
  assert.equal(mobileCommits(d),0);
  const pushed=await m.engine.sync("after-return");assert.ok(pushed.committed,"the edit is uploaded by the normal cycle afterwards")
});

await check("return with nothing new remotely: no visible pull phase is announced",async()=>{
  const {m}=await linkedPhone();let pulling=0;
  const result=await m.engine.checkOnReturn({onPulling:()=>{pulling++}});
  assert.equal(result.upToDate,true);assert.equal(pulling,0,"an up-to-date check never reports a pull")
});

await check("return with another device's commit: the pull phase is announced once before applying",async()=>{
  const {p,m}=await linkedPhone();let pulling=0;
  await p.pull();await p.commit([{entityType:"note",entityId:"r2",operation:"upsert",payload:note("r2","PC에서 알린 변경")}]);
  const result=await m.engine.checkOnReturn({onPulling:probe=>{pulling++;assert.equal(probe.needsPull,true)}});
  assert.equal(result.synced,true);assert.equal(pulling,1);
  assert.equal(m.state.notes.find(n=>n.id==="r2").title,"PC에서 알린 변경")
});

await check("return while this phone's upload is still running: the check does not wait for it",async()=>{
  const {d,m}=await linkedPhone();
  m.edit(s=>{s.notes.find(n=>n.id==="r1").title="업로드 중인 편집"});
  let release;const hold=new Promise(resolve=>{release=resolve});const value=d.putSyncValue.bind(d);
  d.putSyncValue=async request=>{if(request.syncMetadata.syncType==="commit")await hold;return value(request)};
  const upload=m.engine.sync("push");await Promise.resolve();
  let settled=false;const check=m.engine.checkOnReturn().then(result=>{settled=true;return result});
  for(let i=0;i<50&&!settled;i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(settled,true,"the return check finished while the upload was held");
  assert.equal((await check).upToDate,true);
  release();assert.ok((await upload).committed)
});

await check("return with another device's commit: it is applied before the check returns, and nothing is uploaded meanwhile",async()=>{
  const {d,p,m}=await linkedPhone();
  m.edit(s=>{s.notes.find(n=>n.id==="r1").title="폰에서 고친 r1"});
  await p.pull();await p.commit([{entityType:"note",entityId:"r2",operation:"upsert",payload:note("r2","PC에서 고친 r2")}]);
  const writes=countWrites(d);
  const result=await m.engine.checkOnReturn();
  assert.equal(result.synced,true);assert.equal(result.pushDeferred,true);
  assert.equal(m.state.notes.find(n=>n.id==="r2").title,"PC에서 고친 r2","remote change applied");
  assert.equal(m.state.notes.find(n=>n.id==="r1").title,"폰에서 고친 r1","local edit kept");
  assert.equal(writes.text+writes.value,0,"pull only");
  assert.ok((await m.engine.sync("after-return")).committed)
});

await check("while uploads fail, the phone does not keep Windows read-only",async()=>{
  const {d,m}=await linkedPhone();
  m.edit(s=>{s.notes.find(n=>n.id==="r1").title="올라가지 못하는 편집"});
  assert.equal([...d.files.values()].filter(file=>coord.isPresence(file.meta)).length,1,"presence published on edit");
  const value=d.putSyncValue.bind(d);d.putSyncValue=async request=>{if(request.syncMetadata.syncType==="commit")throw new Error("google-drive-http-500");return value(request)};
  const failed=await m.engine.sync("push");assert.equal(failed.failed,true);
  assert.equal(await m.engine._presenceTick(),"release");
  assert.equal([...d.files.values()].filter(file=>coord.isPresence(file.meta)).length,0,"presence withdrawn");
  m.edit(s=>{s.notes.find(n=>n.id==="r1").title="실패 중 추가 편집"});
  assert.equal([...d.files.values()].filter(file=>coord.isPresence(file.meta)).length,0,"no new presence while failing");
  d.putSyncValue=value;assert.ok((await m.engine.sync("recovered")).committed)
});

// --- background publish: the service worker finishes what a backgrounded page could not -------------
// Page and worker engines share one meta store, one local-state store and one lock, as in the app.
function createLock(){let tail=Promise.resolve(),held=0;return {get held(){return held},run(fn){const result=tail.then(async()=>{held++;try{return await fn()}finally{held--}});tail=result.catch(()=>{});return result}}}
function createSharedPhone(drive){
  const lock=createLock(),metaStore=Engine.createMemoryMetaStore(null),stored={state:{schemaVersion:1,projects:[],notes:[]}};let pageState=clone(stored.state),reloads=0;
  const page=Engine.createMobileSyncEngine({drive,syncModel:model,coordination:coord,metaStore,readLocal:()=>clone(pageState),writeLocal:async next=>{pageState=clone(next);stored.state=clone(next)},writerId:"page",exclusive:fn=>lock.run(fn),hooks:{reloadLocal:async()=>{reloads++;pageState=clone(stored.state)}},now});
  const worker=()=>{let workerState=clone(stored.state);return Engine.createMobileSyncEngine({drive,syncModel:model,coordination:coord,metaStore,readLocal:()=>clone(workerState),writeLocal:async next=>{workerState=clone(next);stored.state=clone(next)},writerId:"worker",exclusive:fn=>lock.run(fn),hooks:{reloadLocal:async()=>{workerState=clone(stored.state)}},now})};
  return {page,worker,lock,stored,get pageState(){return pageState},get reloads(){return reloads},edit(fn){fn(pageState);stored.state=clone(pageState);page.notifyLocalWrite()}}
}
async function sharedLinked(){
  const d=createDrive(),p=createDesktop(d);await p.commit([{entityType:"note",entityId:"b1",operation:"upsert",payload:note("b1","원본")}]);
  const phone=createSharedPhone(d);sharedPhones.push(phone);await phone.page.init();await phone.page.link();return {d,p,phone}
}
const sharedPhones=[];

await check("background publish: a push the backgrounded page could not finish is published by the worker",async()=>{
  const {d,p,phone}=await sharedLinked();
  const value=d.putSyncValue.bind(d);d.putSyncValue=async request=>{if(request.syncMetadata.syncType==="commit")throw new TypeError("Failed to fetch");return value(request)};
  phone.edit(s=>{s.notes.find(n=>n.id==="b1").title="폰에서 바로 내려놓음"});
  assert.equal((await phone.page.sync("leave")).failed,true,"the page lost the network while leaving");
  d.putSyncValue=value;
  const worker=phone.worker();await worker.init();
  const result=await worker.sync("background");
  assert.ok(result.committed,"the worker publishes the pending edit");assert.equal(worker.pendingChanges().length,0);
  await p.pull();assert.equal(p.state.notes.find(n=>n.id==="b1").title,"폰에서 바로 내려놓음","Windows sees the edit without the phone being reopened")
});

await check("background publish: the returning page adopts the worker's base and does not publish the edit twice",async()=>{
  const {d,phone}=await sharedLinked();
  phone.edit(s=>{s.notes.find(n=>n.id==="b1").title="워커가 올림"});
  const worker=phone.worker();await worker.init();assert.ok((await worker.sync("background")).committed);
  const before=mobileCommits(d),result=await phone.page.sync("return");
  assert.equal(result.synced,true);assert.equal(mobileCommits(d),before,"no second commit for the same edit");
  assert.equal(phone.page.pendingChanges().length,0)
});

await check("background publish: remote changes the worker merged are reloaded into the page before it continues",async()=>{
  const {p,phone}=await sharedLinked();
  phone.edit(s=>{s.notes.find(n=>n.id==="b1").title="폰 편집"});
  await p.pull();await p.commit([{entityType:"note",entityId:"b2",operation:"upsert",payload:note("b2","PC가 그 사이 추가")}]);
  const worker=phone.worker();await worker.init();assert.ok((await worker.sync("background")).committed);
  const probe=await phone.page.checkOnReturn();
  assert.ok(phone.reloads>=1,"the page reloads what the worker wrote");assert.ok(probe.synced||probe.upToDate);
  assert.equal(phone.pageState.notes.find(n=>n.id==="b2")?.title,"PC가 그 사이 추가");
  assert.equal(phone.pageState.notes.find(n=>n.id==="b1").title,"폰 편집")
});

await check("background publish: page and worker never run a sync cycle at the same time",async()=>{
  const {d,phone}=await sharedLinked();
  phone.edit(s=>{s.notes.find(n=>n.id==="b1").title="동시 실행 방지"});
  let release;const hold=new Promise(resolve=>{release=resolve});const value=d.putSyncValue.bind(d);let inside=0,maxInside=0;
  d.putSyncValue=async request=>{inside++;maxInside=Math.max(maxInside,phone.lock.held);if(request.syncMetadata.syncType==="commit")await hold;const out=await value(request);inside--;return out};
  const pagePush=phone.page.sync("leave");await new Promise(resolve=>setTimeout(resolve,5));
  const worker=phone.worker();await worker.init();const workerRun=worker.sync("background");
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(phone.lock.held,1,"the worker waits for the page's lock");
  release();const [pageResult,workerResult]=await Promise.all([pagePush,workerRun]);
  assert.ok(pageResult.committed);assert.equal(workerResult.changes,0,"the worker finds nothing left to publish");assert.equal(maxInside,1);
  d.putSyncValue=value
});

await check("background publish: the worker withdraws the page's editing presence once everything is published",async()=>{
  const {d,phone}=await sharedLinked();
  const value=d.putSyncValue.bind(d);d.putSyncValue=async request=>{if(request.syncMetadata.syncType==="commit")throw new TypeError("Failed to fetch");return value(request)};
  phone.edit(s=>{s.notes.find(n=>n.id==="b1").title="편집 중 표시 남김"});await new Promise(resolve=>setTimeout(resolve,5));
  await phone.page.sync("leave");d.putSyncValue=value;
  assert.equal([...d.files.values()].filter(file=>coord.isPresence(file.meta)).length,1,"the page left its presence behind");
  const worker=phone.worker();await worker.init();assert.ok((await worker.sync("background")).committed);
  assert.equal(await worker.releaseStoredPresence(),true);
  assert.equal([...d.files.values()].filter(file=>coord.isPresence(file.meta)).length,0,"Windows no longer waits for the phone")
});

for(const phone of sharedPhones){phone.page.stopPolling();await phone.page.releasePresence("qa-done").catch(()=>{})}
console.log(`Mobile two-way sync QA passed (${checks.length} checks).`);
