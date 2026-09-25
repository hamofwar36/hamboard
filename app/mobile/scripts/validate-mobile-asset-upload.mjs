import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import vm from "node:vm";

// Runs the real mobile Drive transport + asset uploader against an in-memory Google Drive, then checks
// what it wrote with the Windows app's own descriptor/object validators taken from its index.html.
const root=new URL("../",import.meta.url),windowWeb=new URL("../window/web/",root),shared=new URL("shared/",windowWeb);
const sha=value=>createHash("sha256").update(value instanceof Uint8Array?Buffer.from(value):value).digest("hex");
const checks=[];async function check(name,run){await run();checks.push(name);console.log("  PASS",name)}

// --- in-memory Drive (files API subset used by the mobile transport) --------------------------------
function createDriveServer(){
  const files=new Map();let seq=0;
  const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json",...headers}});
  const matches=(file,query)=>{
    for(const [,key,value] of query.matchAll(/key='([^']+)' and value='((?:\\'|[^'])*)'/g))if(String(file.appProperties?.[key]??"")!==value.replace(/\\'/g,"'"))return false;
    return true
  };
  const store=(metadata,bytes)=>{const id=`file${++seq}`;files.set(id,{id,appProperties:{...metadata.appProperties},mimeType:metadata.mimeType,name:metadata.name,bytes,createdTime:new Date(1_800_000_000_000+seq).toISOString()});return json({id,size:String(bytes.byteLength)})};
  const sessions=new Map();
  async function fetch(input,init={}){
    const url=new URL(String(input)),method=String(init.method||"GET").toUpperCase();
    if(url.pathname==="/api/session")return json({authenticated:true});
    if(url.pathname==="/api/token")return json({access_token:"token",expires_in:3600});
    if(url.hostname==="upload.session"){const pending=sessions.get(url.pathname);sessions.delete(url.pathname);return store(pending,new Uint8Array(await new Response(init.body).arrayBuffer()))}
    if(url.pathname==="/upload/drive/v3/files"&&method==="POST"){
      if(url.searchParams.get("uploadType")==="resumable"){const key=`/s${++seq}`;sessions.set(key,JSON.parse(init.body));return new Response(null,{status:200,headers:{Location:`https://upload.session${key}`}})}
      const boundary=/boundary=([^;]+)/.exec(init.headers["Content-Type"])[1],raw=new Uint8Array(await new Response(init.body).arrayBuffer()),text=Buffer.from(raw).toString("latin1");
      const parts=text.split(`--${boundary}`),metadata=JSON.parse(Buffer.from(parts[1].split("\r\n\r\n")[1].replace(/\r\n$/,""),"latin1").toString("utf8"));
      const second=text.indexOf(`--${boundary}`,text.indexOf(`--${boundary}`)+1),start=text.indexOf("\r\n\r\n",second)+4,end=text.lastIndexOf(`\r\n--${boundary}--`);
      return store(metadata,raw.slice(start,end))
    }
    const media=/^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if(media&&url.searchParams.get("alt")==="media"){const file=files.get(decodeURIComponent(media[1]));return file?new Response(file.bytes,{status:200}):json({error:"not found"},404)}
    if(media&&method==="DELETE"){files.delete(decodeURIComponent(media[1]));return new Response(null,{status:204})}
    if(url.pathname==="/drive/v3/files"){
      const query=url.searchParams.get("q")||"",list=[...files.values()].filter(file=>matches(file,query)).sort((a,b)=>b.createdTime.localeCompare(a.createdTime));
      return json({files:list.map(file=>({id:file.id,size:String(file.bytes.byteLength),createdTime:file.createdTime,mimeType:file.mimeType,appProperties:file.appProperties}))})
    }
    throw new Error(`unexpected request ${method} ${url}`)
  }
  return {files,fetch}
}

// --- load the real mobile transport and uploader ----------------------------------------------------
const server=createDriveServer();
const context=vm.createContext({console,URL,URLSearchParams,Blob,Response,TextEncoder,TextDecoder,crypto:globalThis.crypto,setTimeout,clearTimeout,fetch:server.fetch,Date,Math,JSON});
context.globalThis=context;context.HAMBOARD_MOBILE_CONFIG={authBaseUrl:"https://auth.hamboard.test"};
for(const file of [new URL("cloud-payload.js",shared),new URL("web/mobile/mobile-google-drive.js",root),new URL("web/mobile/mobile-asset-repository.js",root)])vm.runInContext(await readFile(file,"utf8"),context,{filename:file.pathname});
const drive=context.HamboardMobileGoogleDrive,assets=context.HamboardMobileAssetRepository;

// In-memory stand-in for the IndexedDB asset store (same record contract as the real repository).
function createMemoryAssets(){
  const rows=new Map();
  return {rows,
    async get(id){return rows.get(String(id))||null},
    async put(record){rows.set(String(record.id),{...record});return record},
    async update(id,patch){const row=rows.get(String(id));if(row)rows.set(String(id),{...row,...patch})},
    async listPendingUploads(){return [...rows.values()].filter(row=>row.uploadState==="pending"||row.uploadState==="uploaded")}
  }
}

// --- Windows validators, extracted verbatim from the desktop app ------------------------------------
const desktopHtml=await readFile(new URL("index.html",windowWeb),"utf8");
function desktopFunction(name){
  const start=desktopHtml.search(new RegExp(`(?:async\\s+)?function ${name}\\(`));assert.ok(start>=0,`desktop ${name} not found`);
  let i=desktopHtml.indexOf(")",start),depth=0;i=desktopHtml.indexOf("{",i);
  for(let j=i;j<desktopHtml.length;j++){if(desktopHtml[j]==="{")depth++;else if(desktopHtml[j]==="}"&&--depth===0)return desktopHtml.slice(start,j+1)}
  throw new Error(`desktop ${name} unterminated`)
}
const policies=/const CLOUD_IMAGE_POLICIES=Object\.freeze\(\{[\s\S]*?\n\}\);/.exec(desktopHtml)[0];
const desktop=vm.createContext({GoogleDriveService:{getSyncObject:request=>drive.getSyncObject(request)},syncRemoteObjectRequest:object=>object,JSON,Number,String,Math,Object,Error});
vm.runInContext([policies,...["normalizeCloudImageQuality","syncValidateAssetObject","syncAssetDescriptorCandidates","syncReadAssetDescriptor"].map(desktopFunction),"this.api={syncValidateAssetObject,syncAssetDescriptorCandidates,syncReadAssetDescriptor};"].join("\n"),desktop);
const desktopApi=desktop.api;
const desktopAssetListing=()=>[...server.files.values()].filter(file=>file.appProperties.hamboardKind==="sync"&&file.appProperties.hamboardSyncType==="asset").map(file=>({remoteObjectId:file.id,objectKey:file.appProperties.hamboardObjectKey,contentSha256:file.appProperties.hamboardContentSha256,byteSize:Number(file.appProperties.hamboardByteSize),syncType:"asset",assetId:file.appProperties.hamboardAssetId,quality:file.appProperties.hamboardQuality,createdAtMs:file.appProperties.hamboardCreatedAtMs}));
async function desktopDownload(assetId){
  const [candidate]=desktopApi.syncAssetDescriptorCandidates(desktopAssetListing(),assetId);assert.ok(candidate,"Windows finds a descriptor for the phone image");
  const descriptor=await desktopApi.syncReadAssetDescriptor(candidate),object=await drive.getObjectByKey(descriptor.main);
  return {descriptor,bytes:new Uint8Array(await object.blob.arrayBuffer())}
}

const store=createMemoryAssets();let clock=1_800_000_000_000;
const uploader=assets.createMobileAssetUploader({drive,assetRepository:store,sha256Hex:bytes=>drive.sha256Hex(bytes),now:()=>clock});
const image=(bytes,type="image/webp")=>new Blob([Uint8Array.from(bytes)],{type});
const addLocal=async(id,blob,extra={})=>{const hash=sha(new Uint8Array(await blob.arrayBuffer()));await store.put({id,ownerId:`note:n1`,blob,mimeType:blob.type,byteSize:blob.size,sourceSha256:hash,contentSha256:hash,quality:"balanced",width:640,height:480,uploadState:"pending",...extra});return hash};

await check("only images referenced by the committed state are uploaded",async()=>{
  await addLocal("img-a",image([1,2,3,4,5]));await addLocal("img-unused",image([9,9,9]));
  const result=await uploader.uploadReferenced(new Set(["img-a","img-from-pc"]));
  assert.equal(result.uploaded,1);
  assert.equal(store.rows.get("img-a").uploadState,"uploaded");
  assert.equal(store.rows.get("img-unused").uploadState,"pending")
});

await check("image bytes use the Windows content-addressed object layout",async()=>{
  const hash=sha(Uint8Array.from([1,2,3,4,5])),objects=[...server.files.values()].filter(file=>file.appProperties.hamboardObjectKey===`objects/content-v1/${hash}`);
  assert.equal(objects.length,1);
  assert.deepEqual({...objects[0].appProperties,hamboardCreatedAtMs:"x"},{hamboardObjectKey:`objects/content-v1/${hash}`,hamboardContentSha256:hash,hamboardByteSize:"5",hamboardFormatVersion:"1",hamboardKind:"asset",hamboardCreatedAtMs:"x"});
  assert.equal(objects[0].name,`hamboard-object-${hash.slice(0,24)}.bin`)
});

await check("Windows accepts the phone descriptor and downloads the exact bytes",async()=>{
  const {descriptor,bytes}=await desktopDownload("img-a");
  assert.equal(descriptor.quality,"balanced");assert.equal(descriptor.ownerId,"note:n1");
  assert.deepEqual([...bytes],[1,2,3,4,5]);
  const file=[...server.files.values()].find(item=>item.appProperties.hamboardAssetId==="img-a");
  assert.equal(file.appProperties.hamboardObjectKey,`sync/assets/${sha("img-a:balanced")}.json`,"descriptor key matches Windows sha256(id:quality)");
  assert.equal(file.appProperties.hamboardRevision,`asset-${sha("img-a:balanced").slice(0,24)}`)
});

await check("a stored thumbnail is uploaded and referenced separately",async()=>{
  const thumb=image([7,7]),thumbSha=sha(Uint8Array.from([7,7]));
  await addLocal("img-b",image([4,4,4,4]),{thumbnail:{blob:thumb,mimeType:thumb.type,byteSize:2,contentSha256:thumbSha}});
  await uploader.uploadReferenced(["img-b"]);
  const {descriptor}=await desktopDownload("img-b");
  assert.equal(descriptor.thumbnail.objectKey,`objects/content-v1/${thumbSha}`);
  assert.equal(desktopApi.syncValidateAssetObject(descriptor.thumbnail).byteSize,2)
});

await check("identical bytes reuse the existing Drive object",async()=>{
  const before=server.files.size;await addLocal("img-copy",image([1,2,3,4,5]));
  await uploader.uploadReferenced(["img-copy"]);
  assert.equal(server.files.size,before+1,"only a new descriptor is written");
  assert.deepEqual([...(await desktopDownload("img-copy")).bytes],[1,2,3,4,5])
});

await check("large images use a resumable upload",async()=>{
  const big=new Uint8Array(4*1024*1024+17).map((_,i)=>i%251);await addLocal("img-big",image(big));
  await uploader.uploadReferenced(["img-big"]);
  const {bytes}=await desktopDownload("img-big");assert.equal(bytes.byteLength,big.byteLength);assert.equal(sha(bytes),sha(big))
});

await check("a local image changed after it was queued is not uploaded",async()=>{
  await addLocal("img-tampered",image([5,5,5]),{sourceSha256:"0".repeat(64)});
  await assert.rejects(uploader.uploadReferenced(["img-tampered"]),/mobile-asset-changed-before-upload/);
  assert.equal(store.rows.get("img-tampered").uploadState,"pending");store.rows.delete("img-tampered")
});

await check("a descriptor removed by Windows cleanup is put back",async()=>{
  for(const [id,file] of server.files)if(file.appProperties.hamboardAssetId==="img-a")server.files.delete(id);
  clock+=3*60*1000;
  const result=await uploader.verifyRecent(["img-a","img-b","img-copy","img-big"]);
  assert.equal(result.restored,1);
  assert.deepEqual([...(await desktopDownload("img-a")).bytes],[1,2,3,4,5])
});

await check("verified uploads stop being rechecked after the window",async()=>{
  clock+=31*60*1000;await uploader.verifyRecent(["img-a","img-b","img-copy","img-big"]);
  assert.ok(["img-a","img-b","img-copy","img-big"].every(id=>store.rows.get(id).uploadState==="verified"));
  const again=await uploader.verifyRecent(["img-a"]);assert.equal(again.checked,0);assert.equal(again.restored,0)
});

await check("right before a commit, a descriptor removed by an older Windows cleanup is put back",async()=>{
  await addLocal("img-late",image([3,1,4,1,5]));await uploader.uploadReferenced(["img-late"]);
  for(const [id,file] of server.files)if(file.appProperties.hamboardAssetId==="img-late")server.files.delete(id);
  const result=await uploader.uploadReferenced(["img-late"]);
  assert.equal(result.restored,1,"restored before the commit, not minutes later");
  assert.deepEqual([...(await desktopDownload("img-late")).bytes],[3,1,4,1,5])
});

await check("once the referencing commit is published, images are not rechecked before every commit",async()=>{
  await uploader.markCommitted();
  assert.ok(store.rows.get("img-late").committedAtMs>0);
  let queries=0;const list=drive.listSyncAssetDescriptors;
  const counting=assets.createMobileAssetUploader({drive:{...drive,listSyncAssetDescriptors:async id=>{queries++;return list(id)}},assetRepository:store,sha256Hex:bytes=>drive.sha256Hex(bytes),now:()=>clock});
  await counting.uploadReferenced(["img-late"]);assert.equal(queries,0)
});

await check("the service worker's background publisher imports only files the deployment ships",async()=>{
  const worker=await readFile(new URL("web/mobile/service-worker.js",root),"utf8"),block=/importScripts\(\.\.\.\[([\s\S]*?)\]/.exec(worker);
  assert.ok(block,"importScripts list found");
  const paths=[...block[1].matchAll(/"\.\/([^"]+)"/g)].map(match=>match[1]);
  assert.ok(paths.includes("mobile-sync-engine.js")&&paths.includes("mobile-asset-repository.js"));
  for(const path of paths)await readFile(new URL(`dist-mobile/${path}`,root));
  assert.match(worker,/addEventListener\("sync",event=>\{if\(event\.tag===PUBLISH_TAG\)event\.waitUntil\(backgroundPublish\(\)\)\}\)/);
  assert.match(worker,/navigator\.locks\.request\(SYNC_LOCK/)
});

// --- engine ordering: uploads finish before the commit, failures keep the commit back --------------
for(const file of [new URL("sync-state-model.js",shared),new URL("sync-coordination.js",shared),new URL("web/mobile/mobile-sync-engine.js",root)])vm.runInThisContext(await readFile(file,"utf8"),{filename:file.pathname});
const Engine=globalThis.HamboardMobileSyncEngine,model=globalThis.HamboardSyncStateModel,coord=globalThis.HamboardSyncCoordination;
function createSyncDrive(){
  const files=new Map();let seq=0;const log=[];
  return {files,log,status:()=>({connected:true}),
    async listSyncTopology(){return {objects:[...files.values()].map(file=>({...file.meta})).filter(item=>["commit","checkpoint","lease"].includes(item.syncType)),truncated:false}},
    async getSyncValue(object){return structuredClone(files.get(object.remoteObjectId).value)},
    async putSyncText({objectKey,content,syncMetadata}){return this.putSyncValue({objectKey,value:JSON.parse(content),syncMetadata})},
    async putSyncValue({objectKey,value,syncMetadata}){const id=`s${++seq}`;log.push(syncMetadata.syncType);files.set(id,{value:structuredClone(value),meta:{remoteObjectId:id,objectKey,createdAtMs:String(Date.now()+seq),expiresAtMs:"0",baseRevision:"",...syncMetadata}});return {remoteObjectId:id,objectKey}},
    async deleteSyncObject(object){files.delete(object.remoteObjectId);return {deleted:true}},
    async sha256Hex(bytes){return sha(new Uint8Array(bytes))}
  }
}
async function phoneWith(hooks){
  const syncDrive=createSyncDrive();let state={schemaVersion:1,projects:[],notes:[]};
  const engine=Engine.createMobileSyncEngine({drive:syncDrive,syncModel:model,coordination:coord,metaStore:Engine.createMemoryMetaStore(null),readLocal:()=>structuredClone(state),writeLocal:async next=>{state=structuredClone(next)},hooks});
  await engine.init();await engine.link();
  state.notes.push({id:"n1",title:"사진 노트",content:'<p><img data-note-image="img-new"></p>',resources:[{id:"img-new",name:"사진",type:"image/webp",inline:true}]});engine.notifyLocalWrite();
  return {engine,syncDrive}
}

await check("image uploads run before the commit that references them",async()=>{
  const order=[];let {engine,syncDrive}={};
  ({engine,syncDrive}=await phoneWith({beforeCommit:async({state})=>{order.push(`upload:${state.notes[0].id}`);syncDrive.log.push("asset-upload")},afterSync:async()=>order.push("verify")}));
  const result=await engine.sync("test");
  assert.equal(result.synced,true);assert.deepEqual(order.slice(-2),["upload:n1","verify"]);assert.equal(order.filter(item=>item.startsWith("upload")).length,1);
  const commitIndex=syncDrive.log.lastIndexOf("commit");assert.ok(syncDrive.log.lastIndexOf("asset-upload")<commitIndex,"upload precedes commit")
});

await check("a failed image upload keeps the commit back and reports the failure",async()=>{
  const {engine,syncDrive}=await phoneWith({beforeCommit:async()=>{throw new Error("google-drive-http-503")}});
  const commitsBefore=syncDrive.log.filter(type=>type==="commit").length,result=await engine.sync("test");
  assert.equal(result.failed,true);assert.match(result.error,/google-drive-http-503/);
  assert.equal(syncDrive.log.filter(type=>type==="commit").length,commitsBefore,"no commit published");
  assert.ok(engine.pendingChanges().length>0,"edit stays pending for the next cycle")
});

console.log(`Mobile asset upload QA passed (${checks.length} checks).`);
