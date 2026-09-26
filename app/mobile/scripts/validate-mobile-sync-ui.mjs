import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash,webcrypto} from "node:crypto";
import {createRequire} from "node:module";

// Runs the real mobile app (index.html + mobile-app.js + engine) in jsdom against an in-memory
// Drive that a simulated Windows PC also writes to. Storage is swapped for in-memory adapters.
const require=createRequire(new URL("../../window/package.json",import.meta.url));
const {JSDOM}=require("jsdom");
const root=new URL("../",import.meta.url),shared=new URL("../window/web/shared/",root),mobile=new URL("web/mobile/",root);
const read=url=>readFile(url,"utf8");
const sha=value=>createHash("sha256").update(typeof value==="string"?value:Buffer.from(value)).digest("hex");
const clone=value=>structuredClone(value);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label,timeout=8000){const start=Date.now();while(Date.now()-start<timeout){if(await predicate())return;await sleep(50)}throw new Error(`timeout: ${label}`)}

const html=await read(new URL("index.html",mobile));
const dom=new JSDOM(html,{url:"http://localhost/mobile/",runScripts:"outside-only",pretendToBeVisual:true});
const {window}=dom;
Object.defineProperty(window,"crypto",{value:webcrypto});
window.structuredClone=structuredClone;window.scrollTo=()=>{};window.TextEncoder=TextEncoder;window.TextDecoder=TextDecoder;
window.HTMLElement.prototype.scrollTo=function(){};
let clockOffset=0;const realNow=window.Date.now.bind(window.Date);window.Date.now=()=>realNow()+clockOffset;
for(const file of [new URL("sync-state-model.js",shared),new URL("project-repository.js",shared),new URL("cloud-payload.js",shared),new URL("sync-coordination.js",shared),new URL("mobile-sync-engine.js",mobile)])window.eval(await read(file));
const model=window.HamboardSyncStateModel,coord=window.HamboardSyncCoordination;

// In-memory storage in place of IndexedDB.
const repoCore=window.HamboardProjectRepository,memoryCore=repoCore.createMemoryStateStorage({schemaVersion:1,projects:[],notes:[]});let writeHook=null;
const memoryState={read:()=>memoryCore.read(),write:(next,options)=>writeHook?writeHook(next,options):memoryCore.write(next,options)};
window.HamboardProjectRepository=Object.freeze({...repoCore,createIndexedDbStateStorage:()=>memoryState});
const engineCore=window.HamboardMobileSyncEngine,metaStore=engineCore.createMemoryMetaStore(null);
window.HamboardMobileSyncEngine=Object.freeze({...engineCore,createIndexedDbMetaStore:()=>metaStore});
const assets=new Map();let failAssetCheck=false;
window.HamboardMobileAssetRepository=Object.freeze({collectStateAssetIds:()=>[],createMobileAssetUploader:()=>({uploadReferenced:async()=>{},markCommitted:async()=>{},verifyRecent:async()=>{}}),createIndexedDbAssetRepository:()=>({get:async id=>assets.get(id)||null,put:async record=>{assets.set(record.id,record)},putMany:async rows=>{for(const row of rows)assets.set(row.id,row)},missing:async ids=>{if(failAssetCheck)throw new Error("simulated-network-drop");return ids.filter(id=>!assets.has(id))}})});

// Fake Drive shared by the phone and the simulated PC.
const files=new Map(),backupEntries=[];let seq=0;
const drive={
  connected:true,
  status(){return {configured:true,connected:this.connected,authorized:true,checking:false}},
  async reconnectSilently(){return this.status()},async checkSession(){return this.status()},async requestAccessToken(){return this.status()},
  async listSyncTopology(){return {objects:[...files.values()].map(f=>({...f.meta})).filter(m=>["commit","checkpoint","lease"].includes(m.syncType)),truncated:false}},
  async listSyncObjects(){return this.listSyncTopology()},async listSyncRestoreSource(){return null},async listBackups(){return {backups:backupEntries,truncated:false}},
  async getBackupManifest(){return {formatVersion:2,state:{schemaVersion:1,projects:[],notes:[{id:"old",title:"오래된 백업 노트",content:"<p>백업</p>"}]}}},async listSyncAssetDescriptors(){return []},
  async getSyncValue(object){const file=files.get(object.remoteObjectId);if(!file)throw new Error("google-drive-http-404");return clone(file.value)},
  async put(objectKey,value,meta){const id=`f${++seq}`,content=JSON.stringify(value);files.set(id,{value:clone(value),meta:{remoteObjectId:id,objectKey,contentSha256:sha(content),byteSize:content.length,createdAtMs:String(window.Date.now()),expiresAtMs:"0",baseRevision:"",revision:"",deviceId:"",displayName:"",clientProfile:"",...meta}});return {...files.get(id).meta}},
  async putSyncText({objectKey,content,syncMetadata}){return this.put(objectKey,JSON.parse(content),syncMetadata)},
  async putSyncValue({objectKey,value,syncMetadata}){return this.put(objectKey,value,syncMetadata)},
  async deleteSyncObject(object){files.delete(object.remoteObjectId);return {deleted:true}},
  async sha256Hex(bytes){return sha(bytes)},
  async disconnect(){this.connected=false;return this.status()},configuredAuthBaseUrl:()=>"https://auth.test"
};
window.HamboardMobileGoogleDrive=Object.freeze(drive);

let pcState={schemaVersion:1,projects:[],notes:[],folders:[],storyTemplates:[{id:"tpl"}],tagLibrary:[],favorites:[],settings:{theme:"cotton-candy",mode:"light"}},pcBase="",pcPresence=null;
const pc={
  async commit(changes){const revision=`rev-pc-${++seq}`,commit={format:"hamboard-sync-commit",formatVersion:1,stateSchemaVersion:1,revision,baseRevision:pcBase,deviceId:"device-pc",clientProfile:"desktop",createdAtMs:window.Date.now(),imageQuality:"balanced",changes:changes.map(c=>({...c,payloadSha256:c.operation==="upsert"?sha(JSON.stringify(c.payload)):null}))};pcState=model.applyCommitToCanonical(pcState,commit);await drive.put(`sync/commits/${revision}.json`,commit,{syncType:"commit",revision,baseRevision:pcBase,deviceId:"device-pc",clientProfile:"desktop"});pcBase=revision},
  async pull(){const commits=[...files.values()].map(f=>f.meta).filter(m=>m.syncType==="commit"),byBase=new Map(commits.map(m=>[m.baseRevision,m]));let next=byBase.get(pcBase),count=0;while(next){const commit=clone(files.get(next.remoteObjectId).value);pcState=model.applyCommitToCanonical(pcState,commit);pcBase=commit.revision;count++;next=byBase.get(pcBase)}return count},
  async startEditing(documentKey=""){if(pcPresence)await drive.deleteSyncObject(pcPresence);const record=coord.presenceRecord({deviceId:"device-pc",displayName:"Windows PC",clientProfile:"desktop",sessionStartedAtMs:window.Date.now(),expiresAtMs:window.Date.now()+coord.PRESENCE_TTL_MS,documentKey});pcPresence=await drive.putSyncText(record)},
  async stopEditing(){if(pcPresence)await drive.deleteSyncObject(pcPresence);pcPresence=null}
};
await pc.commit([{entityType:"note",entityId:"n1",operation:"upsert",payload:{id:"n1",title:"PC 노트",content:"<p>처음</p>",updatedAt:"2026-01-01T00:00:00.000Z"}},{entityType:"project",entityId:"p1",operation:"upsert",payload:{id:"p1",title:"PC 작품",kind:"short",stageDefs:[],stages:{}}}]);

window.lucide={createIcons(){}};
const runtimeErrors=[];window.addEventListener("error",event=>runtimeErrors.push(String(event.error?.stack||event.message)));window.addEventListener("unhandledrejection",event=>runtimeErrors.push(String(event.reason?.stack||event.reason)));const consoleError=window.console.error;window.console.error=(...args)=>{runtimeErrors.push(args.map(String).join(" "));consoleError.apply(window.console,args)};
window.eval(await read(new URL("mobile-app.js",mobile)));
const app=window.HamboardMobileApp,doc=window.document;
const checks=[];async function check(name,run){await run();checks.push(name);console.log("  PASS",name)}
const setHidden=value=>{Object.defineProperty(doc,"hidden",{value,configurable:true});Object.defineProperty(doc,"visibilityState",{value:value?"hidden":"visible",configurable:true});doc.dispatchEvent(new window.Event("visibilitychange"))};

await check("an empty phone links automatically on startup and shows the PC documents",async()=>{
  await until(()=>app.syncStatus()?.linked&&app.snapshot().notes?.length===1,"auto link");
  await until(()=>doc.querySelector("#projectList")?.textContent.includes("PC 노트")||doc.body.textContent.includes("PC 노트"),"library render");
  assert.equal(doc.querySelector("#mobileSyncGate"),null)
});

await check("a UI write is pushed to the cloud within a couple of seconds and PC can apply it",async()=>{
  const state=app.snapshot();state.notes[0].content="<p>폰에서 수정</p>";await app.repository.replaceState(state);
  await until(()=>[...files.values()].some(f=>f.meta.syncType==="commit"&&f.meta.clientProfile==="mobile-core"),"mobile commit",5000);
  await pc.pull();assert.equal(pcState.notes[0].content,"<p>폰에서 수정</p>");assert.deepEqual(pcState.storyTemplates,[{id:"tpl"}]);
  assert.equal([...files.values()].filter(f=>coord.isPresence(f.meta)&&f.meta.deviceId.startsWith("mobile-")).length,0,"an edit outside an open document marks nothing")
});

await check("returning while the PC is editing does not display a waiting gate or block an unrelated edit",async()=>{
  setHidden(true);await sleep(50);clockOffset+=10000;
  await pc.startEditing();setHidden(false);
  await sleep(250);
  assert.equal(doc.querySelector("#mobileSyncGate"),null);
  assert.equal(doc.querySelector("#mobileSyncReadonly"),null);
  const state=app.snapshot();state.projects[0].title="폰에서 별도 작품 수정";
  await app.repository.replaceState(state);
  const input=new window.Event("beforeinput",{bubbles:true,cancelable:true});
  const editor=doc.createElement("div");editor.setAttribute("contenteditable","true");doc.body.append(editor);
  editor.dispatchEvent(input);assert.equal(input.defaultPrevented,false);editor.remove()
});

await check("the PC change is pulled automatically without waiting for its editing presence",async()=>{
  await pc.pull();await pc.commit([{entityType:"note",entityId:"n1",operation:"upsert",payload:{...pcState.notes[0],content:"<p>PC에서 이어 씀</p>"}}]);
  await until(()=>app.snapshot().notes[0].content==="<p>PC에서 이어 씀</p>","PC change applied",8000);
  await pc.stopEditing();assert.equal(doc.querySelector("#mobileSyncReadonly"),null)
});

await check("the note the PC is editing is read-only on the phone; other documents stay editable",async()=>{
  const typeInto=parent=>{const editor=doc.createElement("div");editor.setAttribute("contenteditable","true");parent.append(editor);const event=new window.Event("beforeinput",{bubbles:true,cancelable:true});editor.dispatchEvent(event);editor.remove();return event.defaultPrevented};
  const phonePresences=()=>[...files.values()].filter(f=>coord.isPresence(f.meta)&&f.meta.deviceId.startsWith("mobile-")).map(f=>f.meta.assetId);
  await pc.pull();await pc.startEditing("note:n1");await app.syncNow("see-pc");
  assert.equal(doc.querySelector("#mobileSyncReadonly"),null,"no banner in the library");
  app.openDocument("project","p1");await until(()=>!doc.querySelector("#mobileSyncGate"),"project check");
  assert.equal(doc.querySelector("#mobileSyncReadonly"),null,"the project is not locked");
  assert.equal(typeInto(doc.querySelector("#projectReaderScreen")),false,"typing in the project works");
  let state=app.snapshot();state.projects[0].title="폰에서 작품 편집";await app.repository.replaceState(state);
  await until(()=>phonePresences().includes("project:p1"),"the phone marks the project it edits",3000);
  app.openDocument("note","n1");await until(()=>!doc.querySelector("#mobileSyncGate"),"note check");
  await until(()=>doc.querySelector("#mobileSyncReadonly"),"banner on the locked note",3000);
  assert.match(doc.querySelector("#mobileSyncReadonly").textContent,/Windows PC.*이 문서를 수정 중/);
  assert.equal(typeInto(doc.querySelector("#noteReaderScreen")),true,"typing into the locked note is blocked");
  assert.equal(typeInto(doc.body),false,"editors outside the document are not blocked");
  state=app.snapshot();state.notes[0].title="폰이 덮어쓰기";
  await assert.rejects(app.repository.replaceState(state),/mobile-sync-readonly/,"a write to the locked note is refused");
  assert.notEqual(app.snapshot().notes[0].title,"폰이 덮어쓰기");
  state=app.snapshot();state.projects[0].title="노트를 보면서 작품 편집";await app.repository.replaceState(state);
  assert.equal(app.snapshot().projects[0].title,"노트를 보면서 작품 편집","other documents save while the locked note is open");
  await pc.stopEditing();await app.syncNow("pc-done");
  await until(()=>!doc.querySelector("#mobileSyncReadonly"),"banner removed when the PC is done",3000);
  assert.equal(typeInto(doc.querySelector("#noteReaderScreen")),false,"the note is editable again");
  app.openLibrary();await until(async()=>{await app.syncNow("flush");await pc.pull();return pcState.projects[0].title==="노트를 보면서 작품 편집"},"project edit reached the PC",5000)
});

await check("a UI flow holding a snapshot from before a remote apply does not revert it",async()=>{
  const stale=app.snapshot();
  await pc.pull();await pc.commit([{entityType:"note",entityId:"n1",operation:"upsert",payload:{...pcState.notes[0],title:"PC가 바꾼 제목"}}]);
  await app.syncNow("test");assert.equal(app.snapshot().notes[0].title,"PC가 바꾼 제목");
  stale.projects[0].title="폰이 바꾼 작품";await app.repository.replaceState(stale);
  const now=app.snapshot();assert.equal(now.notes[0].title,"PC가 바꾼 제목","remote change survives");assert.equal(now.projects[0].title,"폰이 바꾼 작품","user change kept");
  await until(async()=>{await pc.pull();return pcState.projects[0].title==="폰이 바꾼 작품"},"pushed",5000);assert.equal(pcState.notes[0].title,"PC가 바꾼 제목")
});

await check("a short app switch does not show the gate",async()=>{
  setHidden(true);await sleep(30);setHidden(false);await sleep(500);assert.equal(doc.querySelector("#mobileSyncGate"),null)
});

await check("the cloud screen action reflects the sync state",async()=>{
  await app.openCloudSources("library");await until(()=>doc.querySelector("#loadSyncSource")?.textContent==="지금 동기화","button label")
});

await check("mobile episode creation and mindmap metadata edits reach Windows through the existing sync",async()=>{
  await pc.pull();
  await pc.commit([
    {entityType:"project",entityId:"long-story",operation:"upsert",payload:{id:"long-story",title:"장편 작품",kind:"long",episodes:[{id:"episode-1",title:"1화",stageDefs:[{id:"stage-1",name:"시작",hint:"",color:"#BDE7C4"}],stages:{"stage-1":[]}}]}},
    {entityType:"mindmap",entityId:"editable-map",operation:"upsert",payload:{id:"editable-map",title:"마인드맵",subtitle:"",nodes:[{id:"node-1",type:"text",title:"첫 노드",x:0,y:0}],groups:[],edges:[],viewport:{x:40,y:40,zoom:1}}}
  ]);
  await app.syncNow("new-documents");
  assert.equal(app.snapshot().projects.find(item=>item.id==="long-story")?.episodes.length,1);
  assert.equal(app.snapshot().mindmaps.find(item=>item.id==="editable-map")?.nodes[0].title,"첫 노드");
  app.openDocument("project","long-story");
  doc.querySelector(".episode-add-button").click();
  doc.querySelector("[data-episode-title]").value="2화";
  doc.querySelector("[data-episode-subtitle]").value="모바일에서 추가";
  doc.querySelector("[data-episode-save]").click();
  await until(()=>app.snapshot().projects.find(item=>item.id==="long-story")?.episodes.length===2,"episode saved");
  app.openLibrary();
  doc.querySelector('[data-document-id="editable-map"] .document-card-menu').click();
  doc.querySelector("#createTitleInput").value="수정된 마인드맵";
  doc.querySelector("#createSubtitleInput").value="모바일 편집";
  doc.querySelector("#createSubmit").click();
  await until(()=>app.snapshot().mindmaps.find(item=>item.id==="editable-map")?.subtitle==="모바일 편집","mindmap saved");
  await until(async()=>{
    await pc.pull();
    return pcState.projects.find(item=>item.id==="long-story")?.episodes.length===2&&pcState.mindmaps.find(item=>item.id==="editable-map")?.subtitle==="모바일 편집"
  },"episode and mindmap pushed",6000);
  assert.equal(pcState.projects.find(item=>item.id==="long-story").episodes[1].subtitle,"모바일에서 추가");
  assert.equal(pcState.mindmaps.find(item=>item.id==="editable-map").nodes[0].title,"첫 노드","mindmap nodes retained")
});

async function restoreBackupViaUi(){
  backupEntries.splice(0,backupEntries.length,{remoteObjectId:"backup-1",objectKey:"backups/backup-1.json",createdAtMs:String(window.Date.now()),byteSize:100,label:"백업"});
  await app.openCloudSources("library");
  await until(()=>doc.querySelector(".backup-source-entry"),"backup entry rendered");
  doc.querySelector(".backup-source-entry").click();
  await until(()=>!doc.querySelector("#loadSyncSource")?.disabled&&!/불러오는 중|준비하는 중|적용하는 중/.test(doc.querySelector("#cloudSourceStatus")?.textContent||""),"restore finished",8000)
}

await check("a backup restore that fails before touching local data resumes sync and keeps unsent edits",async()=>{
  await until(()=>!app.syncStatus().busy,"idle");
  const before=app.snapshot();before.notes[0].title="복원 직전의 폰 편집";await app.repository.replaceState(before);
  failAssetCheck=true;await restoreBackupViaUi();failAssetCheck=false;
  const status=app.syncStatus();assert.equal(status.suspended,"","sync is running again");
  assert.equal(app.snapshot().notes[0].title,"복원 직전의 폰 편집","local data unchanged");
  assert.ok(!app.snapshot().notes.some(n=>n.id==="old"),"backup was not applied");
  assert.match(doc.querySelector("#cloudSourceStatus").textContent,/자동 동기화를 다시 켰습니다/);
  await until(async()=>{await pc.pull();return pcState.notes.find(n=>n.id==="n1")?.title==="복원 직전의 폰 편집"},"edit made before the aborted restore still reaches the PC",6000)
});

await check("a backup restore that fails after the write started stays paused and pushes nothing",async()=>{
  const commitsBefore=[...files.values()].filter(f=>f.meta.syncType==="commit").length;
  let broke=false;writeHook=async(next,options)=>{if(!broke){broke=true;throw new Error("simulated-disk-full")}return memoryCore.write(next,options)};
  await restoreBackupViaUi();writeHook=null;
  assert.ok(broke,"write failure was injected");
  assert.equal(app.syncStatus().suspended,"backup-restore","partially applied restore keeps sync paused");
  assert.match(doc.querySelector("#cloudSourceStatus").textContent,/멈춘 상태로 둡니다/);
  await app.syncNow("probe");await sleep(300);
  assert.equal([...files.values()].filter(f=>f.meta.syncType==="commit").length,commitsBefore,"nothing was pushed")
});

await check("a note whose default font came from Windows opens its style sheet (esc was undefined)",async()=>{
  await until(()=>!app.syncStatus().busy&&!app.syncStatus().readonly,"idle");
  const state=app.snapshot(),target=state.notes[0];target.defaultStyle={fontFamily:'나눔"고딕'};await app.repository.replaceState(state);
  app.openDocument("note",target.id);await sleep(50);
  doc.querySelector('[data-note-menu-action="style"]').click();await sleep(20);
  const options=[...doc.querySelectorAll("select[data-note-default-font] option")].map(option=>option.value);
  assert.ok(options.includes('나눔"고딕'),`custom font listed (${options.join(" | ")})`);
  assert.ok(!runtimeErrors.some(line=>/esc is not defined/.test(line)),"no ReferenceError");
  doc.querySelector("[data-note-sheet-close]")?.click();app.openLibrary()
});

await check("no uncaught runtime errors during the run",async()=>assert.deepEqual(runtimeErrors.filter(line=>!/mobile-sync-readonly|simulated-network-drop|simulated-disk-full/.test(line)),[]));
setHidden(true);await sleep(100);dom.window.close();
console.log(`Mobile sync UI QA passed (${checks.length} checks).`);
process.exit(0);
