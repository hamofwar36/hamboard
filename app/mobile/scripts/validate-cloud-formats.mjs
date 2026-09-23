import assert from "node:assert/strict";
import {readFile,rm} from "node:fs/promises";
import {createHash,webcrypto} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import vm from "node:vm";

const root=resolve(fileURLToPath(new URL("../",import.meta.url)));
const files=new Map();let counter=0;
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
function addFile(objectKey,content,kind="asset",extra={}){
  const bytes=Buffer.from(content),digest=sha(bytes),id=`file_${++counter}`;
  files.set(id,{id,bytes,appProperties:{hamboardObjectKey:objectKey,hamboardContentSha256:digest,hamboardByteSize:String(bytes.length),hamboardKind:kind,...extra}});
  return {remoteObjectId:id,objectKey,contentSha256:digest,byteSize:bytes.length}
}
const fetch=async(url,options={})=>{
  const target=new URL(String(url));
  if(target.hostname==="auth.test")return Response.json(target.pathname==="/api/session"?{authenticated:true}:{access_token:"test",expires_in:3600});
  if(target.pathname.endsWith("/files")&&options.method==="POST"){
    const raw=Buffer.from(await options.body.arrayBuffer()),boundary=options.body.type.split("boundary=")[1];
    const first=raw.indexOf("\r\n\r\n"),second=raw.indexOf("\r\n\r\n",first+4),end=raw.lastIndexOf(`\r\n--${boundary}--\r\n`);
    const metadata=JSON.parse(raw.subarray(first+4,raw.indexOf(`\r\n--${boundary}\r\n`,first+4)).toString());
    const body=raw.subarray(second+4,end),file=addFile(metadata.appProperties.hamboardObjectKey,body,metadata.appProperties.hamboardKind,metadata.appProperties);
    return Response.json({id:file.remoteObjectId,size:String(file.byteSize)})
  }
  if(target.searchParams.get("alt")==="media"){
    const file=files.get(target.pathname.split("/").pop());return file?new Response(file.bytes):new Response("missing",{status:404})
  }
  if(target.pathname.endsWith("/files")){
    const query=target.searchParams.get("q")||"",key=/hamboardObjectKey' and value='([^']+)'/.exec(query)?.[1];
    const found=[...files.values()].filter(file=>!key||file.appProperties.hamboardObjectKey===key);
    return Response.json({files:found.map(({id,bytes,appProperties})=>({id,size:String(bytes.length),appProperties}))})
  }
  throw new Error(`unexpected request: ${url}`)
};
const context=vm.createContext({fetch,crypto:webcrypto,Blob,TextEncoder,TextDecoder,URL,Response,structuredClone,HAMBOARD_MOBILE_CONFIG:{authBaseUrl:"https://auth.test"}});
for(const path of ["../window/web/shared/sync-state-model.js","../window/web/shared/cloud-payload.js","web/mobile/mobile-google-drive.js"]){
  vm.runInContext(await readFile(resolve(root,path),"utf8"),context,{filename:path})
}
const model=context.HamboardSyncStateModel,payload=context.HamboardCloudPayload,drive=context.HamboardMobileGoogleDrive;
const state={schemaVersion:1,projects:[{id:"p1",title:"새 형식",episodes:[]}],notes:[],folders:[],mindmaps:[],settings:{theme:"dark"}};
const checkpoint={format:"hamboard-sync-checkpoint",formatVersion:1,stateSchemaVersion:1,revision:"rev-1",state};
const pages=[];
for await(const rows of payload.jsonPages(payload.treeRecords(checkpoint))){const ref=addFile(`objects/content-v1/${sha(Buffer.from(rows))}`,rows);pages.push({objectKey:ref.objectKey,contentSha256:ref.contentSha256,byteSize:ref.byteSize})}
const syncRoot=addFile("sync/checkpoints/rev-1.json",JSON.stringify({format:payload.SYNC_PAGES_FORMAT,formatVersion:1,encoding:payload.TREE_ENCODING,pages}),"sync");
assert.equal((await drive.getSyncValue(syncRoot)).state.projects[0].title,"새 형식");
const legacy=JSON.stringify({...checkpoint,revision:"rev-legacy"}),legacyChunk=addFile(`objects/content-v1/${sha(Buffer.from(legacy))}`,legacy);
const legacyRoot=addFile("sync/checkpoints/rev-legacy.json",JSON.stringify({format:payload.FORMAT,formatVersion:1,objectKind:"sync",payload:{encoding:payload.ENCODING,byteSize:legacyChunk.byteSize,contentSha256:legacyChunk.contentSha256,chunks:[{objectKey:legacyChunk.objectKey,contentSha256:legacyChunk.contentSha256,byteSize:legacyChunk.byteSize}]}}),"sync");
assert.equal((await drive.getSyncValue(legacyRoot)).revision,"rev-legacy");
files.get([...files.keys()][0]).bytes=Buffer.from("tampered");
await assert.rejects(drive.getSyncValue(syncRoot),/integrity|metadata-mismatch/);
files.get([...files.keys()][0]).bytes=Buffer.from(await (async()=>{const result=[];for await(const rows of payload.jsonPages(payload.treeRecords(checkpoint)))result.push(rows);return result[0]})());

const cloudUserData=model.projectCloudUserData(state,model.CLIENT_PROFILES.desktop),sections=[];
for(const [name,records] of Object.entries({cloudUserData:payload.fieldRecords(cloudUserData),deviceStateDelta:payload.treeRecords(null),syncContext:payload.treeRecords(null),versions:[],workTracking:[],assets:[],objects:[],missingAssets:[]})){
  const refs=[];
  for await(const rows of payload.jsonPages(records)){const ref=addFile(`objects/content-v1/${sha(Buffer.from(rows))}`,rows);refs.push({objectKey:ref.objectKey,contentSha256:ref.contentSha256,byteSize:ref.byteSize})}
  sections.push({name,pages:refs,...(["deviceStateDelta","syncContext"].includes(name)?{encoding:payload.TREE_ENCODING}:{})})
}
const manifestRef=addFile("backups/test/manifest.json",JSON.stringify({format:"hamboard-cloud-backup",formatVersion:3,complete:true,backupId:"test",stateSchemaVersion:1,cloudUserDataVersion:1,sections}),"manifest");
const manifest=await drive.getBackupManifest(manifestRef);
const hydrated=await payload.hydrateSections(manifest,drive.getBackupPage,{skipSections:["versions","workTracking","deviceStateDelta","syncContext","missingAssets"]});
assert.equal(model.applyCloudUserData({},hydrated.cloudUserData,model.CLIENT_PROFILES.desktop).projects[0].title,"새 형식");
assert.deepEqual(Array.from(hydrated.objects),[]);

const published=await drive.putSyncCheckpoint({revision:"rev-2",state});
assert.equal((await drive.getSyncValue(published)).cloudUserDataVersion,1);
assert.equal((await drive.getSyncValue(published)).state.projects[0].title,"새 형식");
assert.ok([...files.values()].some(file=>file.appProperties.hamboardKind==="asset"&&file.appProperties.hamboardObjectKey.startsWith("objects/content-v1/")));
const built=spawnSync(process.execPath,[resolve(root,"scripts/prepare-mobile-deploy.mjs")],{encoding:"utf8"});
assert.equal(built.status,0,built.stderr||built.stdout);
const deployed=await readFile(resolve(root,"dist-mobile/index.html"),"utf8");
assert.ok(deployed.includes('src="./shared/cloud-payload.js?v='));
assert.ok(deployed.indexOf("cloud-payload.js")<deployed.indexOf("mobile-google-drive.js"));
assert.equal(await readFile(resolve(root,"dist-mobile/shared/cloud-payload.js"),"utf8"),await readFile(resolve(root,"../window/web/shared/cloud-payload.js"),"utf8"));
await rm(resolve(root,"dist-mobile"),{recursive:true,force:true});
console.log("Mobile cloud formats: v3 backup, paged sync, integrity check, and paged checkpoint passed");
