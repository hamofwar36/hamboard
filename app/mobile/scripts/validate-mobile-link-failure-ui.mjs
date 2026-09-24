import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash,webcrypto} from "node:crypto";
import {createRequire} from "node:module";

// First link from a phone that already has data, with Drive commit uploads failing at first.
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
const repoCore=window.HamboardProjectRepository,memoryCore=repoCore.createMemoryStateStorage({schemaVersion:1,projects:[],notes:[{id:"phone-only",title:"폰에만 있는 노트",content:"<p>x</p>"}]});let writeHook=null;
const memoryState={read:()=>memoryCore.read(),write:(next,options)=>writeHook?writeHook(next,options):memoryCore.write(next,options)};
window.HamboardProjectRepository=Object.freeze({...repoCore,createIndexedDbStateStorage:()=>memoryState});
const engineCore=window.HamboardMobileSyncEngine,metaStore=engineCore.createMemoryMetaStore(null);
window.HamboardMobileSyncEngine=Object.freeze({...engineCore,createIndexedDbMetaStore:()=>metaStore});
const assets=new Map();let failAssetCheck=false;
window.HamboardMobileAssetRepository=Object.freeze({createIndexedDbAssetRepository:()=>({get:async id=>assets.get(id)||null,put:async record=>{assets.set(record.id,record)},putMany:async rows=>{for(const row of rows)assets.set(row.id,row)},missing:async ids=>{if(failAssetCheck)throw new Error("simulated-network-drop");return ids.filter(id=>!assets.has(id))}})});

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
  async putSyncValue({objectKey,value,syncMetadata}){if(syncMetadata.syncType==="commit"&&globalThis.__failCommits)throw new Error("google-drive-http-503");return this.put(objectKey,value,syncMetadata)},
  async deleteSyncObject(object){files.delete(object.remoteObjectId);return {deleted:true}},
  async sha256Hex(bytes){return sha(bytes)},
  async disconnect(){this.connected=false;return this.status()},configuredAuthBaseUrl:()=>"https://auth.test"
};
window.HamboardMobileGoogleDrive=Object.freeze(drive);

let pcState={schemaVersion:1,projects:[],notes:[],folders:[],storyTemplates:[{id:"tpl"}],tagLibrary:[],favorites:[],settings:{theme:"cotton-candy",mode:"light"}},pcBase="",pcPresence=null;
const pc={
  async commit(changes){const revision=`rev-pc-${++seq}`,commit={format:"hamboard-sync-commit",formatVersion:1,stateSchemaVersion:1,revision,baseRevision:pcBase,deviceId:"device-pc",clientProfile:"desktop",createdAtMs:window.Date.now(),imageQuality:"balanced",changes:changes.map(c=>({...c,payloadSha256:c.operation==="upsert"?sha(JSON.stringify(c.payload)):null}))};pcState=model.applyCommitToCanonical(pcState,commit);await drive.put(`sync/commits/${revision}.json`,commit,{syncType:"commit",revision,baseRevision:pcBase,deviceId:"device-pc",clientProfile:"desktop"});pcBase=revision},
  async pull(){const commits=[...files.values()].map(f=>f.meta).filter(m=>m.syncType==="commit"),byBase=new Map(commits.map(m=>[m.baseRevision,m]));let next=byBase.get(pcBase),count=0;while(next){const commit=clone(files.get(next.remoteObjectId).value);pcState=model.applyCommitToCanonical(pcState,commit);pcBase=commit.revision;count++;next=byBase.get(pcBase)}return count},
  async startEditing(){const record=coord.presenceRecord({deviceId:"device-pc",displayName:"Windows PC",clientProfile:"desktop",sessionStartedAtMs:window.Date.now(),expiresAtMs:window.Date.now()+coord.PRESENCE_TTL_MS});pcPresence=await drive.putSyncText(record)},
  async stopEditing(){if(pcPresence)await drive.deleteSyncObject(pcPresence);pcPresence=null}
};
await pc.commit([{entityType:"note",entityId:"n1",operation:"upsert",payload:{id:"n1",title:"PC 노트",content:"<p>처음</p>",updatedAt:"2026-01-01T00:00:00.000Z"}},{entityType:"project",entityId:"p1",operation:"upsert",payload:{id:"p1",title:"PC 작품",kind:"short",stageDefs:[],stages:{}}}]);

window.lucide={createIcons(){}};
const runtimeErrors=[];window.addEventListener("error",event=>runtimeErrors.push(String(event.error?.stack||event.message)));window.addEventListener("unhandledrejection",event=>runtimeErrors.push(String(event.reason?.stack||event.reason)));const consoleError=window.console.error;window.console.error=(...args)=>{runtimeErrors.push(args.map(String).join(" "));consoleError.apply(window.console,args)};
window.eval(await read(new URL("mobile-app.js",mobile)));
const app=window.HamboardMobileApp,doc=window.document;
const checks=[];async function check(name,run){await run();checks.push(name);console.log("  PASS",name)}
const setHidden=value=>{Object.defineProperty(doc,"hidden",{value,configurable:true});Object.defineProperty(doc,"visibilityState",{value:value?"hidden":"visible",configurable:true});doc.dispatchEvent(new window.Event("visibilitychange"))};

globalThis.__failCommits=true;

await check("phone with its own data links from the cloud screen; a failed first upload is not reported as success",async()=>{
  await sleep(800);assert.equal(app.syncStatus().linked,false,"a phone with data does not auto-link");
  await app.openCloudSources("library");
  await until(()=>!doc.querySelector("#loadSyncSource")?.disabled,"link button enabled");
  assert.equal(doc.querySelector("#loadSyncSource").textContent,"자동 동기화 시작");
  doc.querySelector("#loadSyncSource").click();
  await until(()=>doc.querySelector(".mobile-confirm-cancel"),"phone-only dialog");
  doc.querySelector(".mobile-confirm-cancel").click();
  await until(()=>doc.querySelector("#mobileSyncToast")?.textContent,"link notice",10000);
  const toast=doc.querySelector("#mobileSyncToast").textContent;
  assert.doesNotMatch(toast,/^자동 동기화를 시작했습니다/,"no success claim");
  assert.match(toast,/아직 올리지 못했습니다. 자동으로 다시 시도합니다/);
  assert.equal(doc.querySelector("#cloudSourceStatus").textContent,toast,"cloud screen status is not stuck on '연결하는 중'");
  assert.equal(app.syncStatus().linked,true);assert.equal(app.syncStatus().dirty,true,"the change stays pending");
  assert.equal([...files.values()].filter(f=>f.meta.clientProfile==="mobile-core"&&f.meta.syncType==="commit").length,0)
});

await check("when Drive recovers, the automatic retry uploads the pending change (no manual sync)",async()=>{
  globalThis.__failCommits=false;
  await until(()=>[...files.values()].some(f=>f.meta.clientProfile==="mobile-core"&&f.meta.syncType==="commit"),"retry uploaded",15000);
  await pc.pull();assert.ok(pcState.notes.some(n=>n.id==="phone-only"),"phone-only note reached the PC");
  await until(()=>!app.syncStatus().dirty,"clean after retry",5000)
});

setHidden(true);await sleep(100);dom.window.close();
console.log(`Mobile link-failure UI QA passed (${checks.length} checks).`);
process.exit(0);
