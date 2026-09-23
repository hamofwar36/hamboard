import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {Worker as NodeWorker} from 'node:worker_threads';
const root=new URL('../',import.meta.url),html=await readFile(new URL('web/index.html',root),'utf8');
const source=await readFile(new URL('web/shared/cloud-payload.js',root),'utf8');
const ctx=vm.createContext({structuredClone,Blob,TextDecoder,TextEncoder,URL});vm.runInContext(source,ctx);
const payload=ctx.HamboardCloudPayload;
const sha=async blob=>createHash('sha256').update(new Uint8Array(await blob.arrayBuffer())).digest('hex');
const checks=[];async function check(name,task){await task();checks.push(name)}
const plain=value=>JSON.parse(JSON.stringify(value));
function fn(name){const start=html.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert.ok(start>=0);const rest=html.slice(start),end=rest.slice(1).search(/\n(?:async )?function |\n(?:const|let) /);return rest.slice(0,end+1)}
function memoryTransport(){
  const files=new Map(),pins=new Map(),events=[];let failAt=0,chunkCalls=0,newChunks=0;
  const transport=payload.createTransport({sha256:sha,
    putRaw:async request=>{const bytes=new TextEncoder().encode(request.content);assert.equal(bytes.length,request.byteSize);assert.equal(await sha(new Blob([bytes])),request.contentSha256);files.set(request.objectKey,bytes);events.push('root');return {remoteObjectId:'id',contentSha256:request.contentSha256,uploadByteSize:bytes.length}},
    putChunk:async(blob,chunk)=>{chunkCalls++;if(failAt===chunkCalls)throw Error('simulated-network-failure');if(!files.has(chunk.objectKey)){newChunks++;files.set(chunk.objectKey,new Uint8Array(await blob.arrayBuffer()))}events.push('chunk')},
    readBytes:async object=>{if(!files.has(object.objectKey))throw Error('missing-chunk');return files.get(object.objectKey)},
    pin:async(owner,key)=>{if(!pins.has(owner))pins.set(owner,new Set());pins.get(owner).add(key)},unpin:async owner=>pins.delete(owner)
  });
  return {transport,files,pins,events,get newChunks(){return newChunks},setFailure:n=>{failAt=n;chunkCalls=0}};
}
async function request(value,kind='manifest',objectKey='backups/test/manifest.json'){
  const content=JSON.stringify(value),blob=new Blob([content]);return {kind,objectKey,source:'text',content,contentSha256:await sha(blob),byteSize:blob.size,mimeType:'application/json',...(kind==='manifest'?{summary:payload.backupSummary(value)}:{})};
}
function makeManifest(state){return {format:'hamboard-cloud-backup',formatVersion:2,backupId:'test',complete:true,createdAt:'2026-09-21T00:00:00Z',stateSchemaVersion:1,state,versions:[],workTracking:{programs:[],daily:[]},assets:[],objects:[],imagePolicy:{quality:'original'},syncContext:payload.packSyncContext(state,{baseRevision:'r1',baseState:state})}}
await check('unchanged baseline contains no second copy of documents',()=>{
  const state={schemaVersion:1,notes:[{id:'a',content:'text'.repeat(250000)}],settings:{theme:'dark'}};
  const packed=payload.packSyncContext(state,{baseRevision:'r1',baseState:structuredClone(state)});
  assert.equal(packed.baseStateDelta,null);assert.ok(JSON.stringify(packed).length<150);
  assert.deepEqual(plain(payload.unpackSyncContext(state,packed).baseState),state);
});
await check('structural delta roundtrips additions, deletions, reorder, null and changed types',()=>{
  const current={schemaVersion:1,notes:[{id:'a',content:'new'},{id:'b',content:'same'}],x:null,settings:{theme:'dark',local:true}};
  const base={schemaVersion:1,notes:[{id:'b',content:'same'},{id:'c',content:'old'},{id:'a',content:'earlier'}],x:[],settings:{theme:'light'},removedLocally:{z:0}};
  const delta=payload.packSyncContext(current,{baseRevision:'r1',baseState:base});const restored=payload.unpackSyncContext(current,plain(delta));
  assert.deepEqual(plain(restored.baseState),base);assert.equal(current.notes[0].content,'new');
});
await check('legacy baseline context remains readable; unknown encodings fail closed',()=>{
  const state={schemaVersion:1,notes:[]};assert.deepEqual(plain(payload.unpackSyncContext(state,{baseRevision:'r',baseState:state}).baseState),state);
  assert.throws(()=>payload.unpackSyncContext(state,{baseEncoding:'future',baseStateDelta:null}),/encoding-invalid/);
});
await check('delta application never mutates object prototypes',()=>{
  const base=JSON.parse('{"schemaVersion":1,"__proto__":{"polluted":true}}');const next=payload.applyDifference({schemaVersion:1},payload.difference({schemaVersion:1},base));
  assert.equal(Object.hasOwn(next,'__proto__'),true);assert.equal({}.polluted,undefined);assert.equal(next.polluted,undefined);
});
await check('new local backups restore baseline delta and old backups restore cloud projection',async()=>{
  const local=vm.createContext({structuredClone,CloudPayload:payload,cloneData:structuredClone,SCHEMA_VERSION:1,readState:v=>v,fetch,Blob});
  vm.runInContext(await readFile(new URL('web/shared/sync-state-model.js',root),'utf8'),local);
  local.SyncStateModel=local.HamboardSyncStateModel;local.SYNC_CLIENT_PROFILES=local.SyncStateModel.CLIENT_PROFILES;
  vm.runInContext(fn('prepareBackupImport'),local);
  const state={schemaVersion:1,notes:[{id:'n',content:'current'}]},base={schemaVersion:1,notes:[{id:'n',content:'base'}]};
  const next=await local.prepareBackupImport({format:'hamboard-backup',schemaVersion:1,backupFormatVersion:2,state,assets:[],syncContext:payload.packSyncContext(state,{baseRevision:'r',baseState:base})});
  assert.equal(next.nextState.notes[0].content,'current');assert.equal(next.syncContext.baseState.notes[0].content,'base');
  const legacy=await local.prepareBackupImport({format:'hamboard-backup',schemaVersion:1,state,cloudUserDataVersion:1,cloudUserData:{schemaVersion:1,notes:[{id:'n',content:'legacy common'}]},syncContext:{baseRevision:'old',baseState:base}});
  assert.equal(legacy.nextState.notes[0].content,'legacy common');assert.equal(legacy.syncContext.baseRevision,'old');
});
const bigState={schemaVersion:1,notes:Array.from({length:20},(_,i)=>({id:String(i),content:String.fromCharCode(65+i).repeat(1024*1024)}))};
const bigManifest=makeManifest(bigState),bigRequest=await request(bigManifest),memory=memoryTransport();let published;
await check('over-16-MiB backup uploads as bounded chunks and publishes a small root last',async()=>{
  assert.ok(bigRequest.byteSize>16*1024*1024);published=await memory.transport.upload(bigRequest);
  assert.ok(published.uploadByteSize<20000);assert.equal(memory.events.at(-1),'root');
  const root=JSON.parse(new TextDecoder().decode(memory.files.get(bigRequest.objectKey)));
  assert.equal(root.format,payload.FORMAT);assert.equal(root.summary.state,undefined);assert.equal(root.payload.byteSize,bigRequest.byteSize);
  assert.ok(root.payload.chunks.every(c=>c.byteSize<=payload.CHUNK_BYTES));assert.equal(memory.pins.size,0);
});
await check('over-16-MiB backup roundtrips Unicode-safe JSON and baseline context',async()=>{
  const loaded=await memory.transport.download({objectKey:bigRequest.objectKey,contentSha256:published.contentSha256,byteSize:published.uploadByteSize});
  assert.equal(loaded.state.notes.length,20);assert.equal(loaded.state.notes[19].content,bigState.notes[19].content);
  assert.equal(payload.unpackSyncContext(loaded.state,loaded.syncContext).baseState.notes[0].content,bigState.notes[0].content);
});
await check('failed upload never publishes root; retry reuses uploaded chunks',async()=>{
  const m=memoryTransport();m.setFailure(4);await assert.rejects(m.transport.upload(bigRequest),/network-failure/);
  assert.equal(m.files.has(bigRequest.objectKey),false);assert.equal(m.events.includes('root'),false);assert.ok(m.pins.size>0);
  const before=m.newChunks;m.setFailure(0);await m.transport.upload(bigRequest);
  const unique=new Set(JSON.parse(new TextDecoder().decode(m.files.get(bigRequest.objectKey))).payload.chunks.map(c=>c.objectKey));
  assert.equal(m.newChunks,unique.size);assert.ok(before>0);assert.equal(m.pins.size,0);
});
await check('missing chunk prevents JSON restoration',async()=>{
  const root=JSON.parse(new TextDecoder().decode(memory.files.get(bigRequest.objectKey))),chunk=root.payload.chunks[2],original=memory.files.get(chunk.objectKey);memory.files.delete(chunk.objectKey);
  await assert.rejects(memory.transport.downloadPayload(root.payload),/missing-chunk/);memory.files.set(chunk.objectKey,original);
});
await check('corrupt chunk is rejected before parsing',async()=>{
  const root=JSON.parse(new TextDecoder().decode(memory.files.get(bigRequest.objectKey))),chunk=root.payload.chunks[2],original=memory.files.get(chunk.objectKey),bad=original.slice();bad[0]^=1;memory.files.set(chunk.objectKey,bad);
  await assert.rejects(memory.transport.downloadPayload(root.payload),/chunk-integrity-mismatch/);memory.files.set(chunk.objectKey,original);
});
await check('reordered same-size chunks fail whole-payload integrity',async()=>{
  const root=JSON.parse(new TextDecoder().decode(memory.files.get(bigRequest.objectKey)));[root.payload.chunks[2],root.payload.chunks[3]]=[root.payload.chunks[3],root.payload.chunks[2]];
  await assert.rejects(memory.transport.downloadPayload(root.payload),/payload-integrity-mismatch/);
});
await check('malformed chunk lengths and unsupported envelope versions are rejected',async()=>{
  const root=JSON.parse(new TextDecoder().decode(memory.files.get(bigRequest.objectKey)));root.payload.chunks[0].byteSize++;assert.throws(()=>payload.validatePayload(root.payload),/chunk-invalid/);
  const bad={format:payload.FORMAT,formatVersion:99,objectKind:'sync'},text=JSON.stringify(bad),bytes=new TextEncoder().encode(text);memory.files.set('bad',bytes);
  await assert.rejects(memory.transport.download({objectKey:'bad',byteSize:bytes.length,contentSha256:await sha(new Blob([bytes]))}),/envelope-invalid/);
});
await check('legacy large v1 backup remains readable and resumable without changing its remote key bytes',async()=>{
  const legacy={...bigManifest,formatVersion:1},req=await request(legacy,'manifest','backups/legacy/manifest.json'),m=memoryTransport();const saved=await m.transport.upload(req);
  assert.equal(saved.contentSha256,req.contentSha256);assert.equal(m.events.length,1);
  const restored=await m.transport.download({...req,byteSize:saved.uploadByteSize});assert.equal(restored.formatVersion,1);assert.equal(restored.state.notes.length,20);
});
await check('large sync checkpoint and small sync commit use the same reader',async()=>{
  const m=memoryTransport(),value={format:'hamboard-sync-checkpoint',formatVersion:1,revision:'r',state:bigState},req=await request(value,'sync','sync/checkpoints/r.json');const saved=await m.transport.upload(req);
  const result=await m.transport.download({objectKey:req.objectKey,contentSha256:saved.contentSha256,byteSize:saved.uploadByteSize});assert.equal(result.revision,'r');assert.equal(result.state.notes.length,20);
  const small=await request({format:'hamboard-sync-commit',revision:'s',changes:[]},'sync','sync/commits/s.json'),direct=await m.transport.upload(small);assert.equal(direct.contentSha256,small.contentSha256);
});
await check('non-ASCII text split across byte boundaries roundtrips unchanged',async()=>{
  const state={schemaVersion:1,notes:[{id:'unicode',content:'가🙂나'.repeat(180000)}]},req=await request(makeManifest(state)),m=memoryTransport(),saved=await m.transport.upload(req);
  const result=await m.transport.download({objectKey:req.objectKey,contentSha256:saved.contentSha256,byteSize:saved.uploadByteSize});assert.equal(result.state.notes[0].content,state.notes[0].content);
});
await check('listing summary is lazy and restoration hydrates and validates the actual backup',async()=>{
  let downloads=0;const root=JSON.parse(new TextDecoder().decode(memory.files.get(bigRequest.objectKey)));
  const entry={summaryOnly:true,manifest:root.summary,payload:root.payload,manifestObject:{objectKey:bigRequest.objectKey,contentSha256:published.contentSha256,byteSize:published.uploadByteSize}};
  const local=vm.createContext({CloudPayload:payload,CLOUD_BACKUP_FORMAT_VERSION:2,SCHEMA_VERSION:1,SyncStateModel:{CLOUD_USER_DATA_VERSION:1},cloudJsonTransport:()=>({download:async object=>{downloads++;return memory.transport.download(object)}})});
  for(const name of ['validateCloudBackupEntry','loadCloudBackupEntry'])vm.runInContext(fn(name),local);
  local.validateCloudBackupEntry(entry);assert.equal(downloads,0);const loaded=await local.loadCloudBackupEntry(entry);assert.equal(downloads,1);assert.equal(loaded.summaryOnly,false);assert.equal(loaded.manifest.state.notes.length,20);
});
await check('native has no residual 16/64 MiB JSON gate and GC protects payload references',async()=>{
  const rust=await readFile(new URL('src-tauri/src/google_drive.rs',root),'utf8'),lib=await readFile(new URL('src-tauri/src/lib.rs',root),'utf8');
  assert.doesNotMatch(rust,/MAX_(?:CLOUD_JSON|SYNC_OBJECT|MANIFEST)_BYTES/);assert.doesNotMatch(lib,/(?:base_state_json|state_json)\.len\(\) > 64 \* 1024/);
  assert.match(rust,/std::io::BufReader::new\(file\)/);assert.match(rust,/received > remote.byte_size/);
  assert.match(html,/await CloudJsonPins.keys\(\)/);assert.match(html,/entry.payload\?\.chunks/);assert.match(html,/root.payload.chunks/);assert.match(rust,/fresh_payload_chunk && existing.created_at_ms/);
});
await check('over-64-MiB state has no application JSON size gate',async()=>{
  const m=memoryTransport(),state={schemaVersion:1,notes:[{id:'large',content:'z'.repeat(65*1024*1024)}]},req=await request({format:'hamboard-sync-checkpoint',formatVersion:1,revision:'huge',state},'sync','sync/checkpoints/huge.json');
  const saved=await m.transport.upload(req);const result=await m.transport.download({objectKey:req.objectKey,contentSha256:saved.contentSha256,byteSize:saved.uploadByteSize});assert.equal(result.state.notes[0].content.length,65*1024*1024);
});
await check('failed parallel downloads settle in-flight writes before cleanup begins',async()=>{
  let finish;const hold=new Promise(resolve=>{finish=resolve}),events=[];
  const local=vm.createContext({});vm.runInContext(fn('mapWithConcurrency'),local);
  const task=local.mapWithConcurrency([0,1,2],2,async item=>{events.push(`start-${item}`);if(item===0){await Promise.resolve();throw Error('download-failed')}await hold;events.push(`finish-${item}`)});
  let rejected=false;const observed=task.catch(error=>{rejected=true;assert.match(error.message,/download-failed/);events.push('cleanup')});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(rejected,false);assert.deepEqual(events,['start-0','start-1']);finish();await observed;assert.deepEqual(events,['start-0','start-1','finish-1','cleanup']);
});
await check('worker scripts serialize and parse large JSON off the calling thread',async()=>{
  const urls=new Map();let workers=0;
  class BrowserWorkerAdapter {
    constructor(url){workers++;this.ready=urls.get(url).text().then(script=>{this.worker=new NodeWorker("const {parentPort}=require('node:worker_threads');globalThis.postMessage=value=>parentPort.postMessage(value);parentPort.on('message',data=>globalThis.onmessage({data}));"+script,{eval:true});this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.(error));return this.worker})}
    postMessage(value){this.ready.then(worker=>worker.postMessage(value))}
    terminate(){this.ready.then(worker=>worker.terminate())}
  }
  const local=vm.createContext({Blob,structuredClone,TextEncoder,TextDecoder,Worker:BrowserWorkerAdapter,URL:{createObjectURL:blob=>{const id=String(urls.size+1);urls.set(id,blob);return id},revokeObjectURL:id=>urls.delete(id)}});
  vm.runInContext(source,local);const model=local.HamboardCloudPayload,input={notes:[{content:'가🙂'.repeat(400000)}]};
  const text=await model.stringifyJson(input),result=await model.parseJson(text);assert.equal(result.notes[0].content,input.notes[0].content);assert.equal(workers,2);assert.equal(urls.size,0);
});
await check('garbage collection protects backup chunks, sync chunks and pending retry chunks',async()=>{
  const hash='a'.repeat(64),syncHash='b'.repeat(64),key=`objects/content-v1/${hash}`,syncKey=`objects/content-v1/${syncHash}`,root={format:payload.FORMAT,payload:{encoding:payload.ENCODING,byteSize:12,contentSha256:syncHash,chunks:[{objectKey:syncKey,contentSha256:syncHash,byteSize:12}]}};
  let kept=null,broken=false;const local=vm.createContext({SYNC_CLEANUP_DELETE_BUDGET:200,SyncAssetRepository:{hasUnfinished:async()=>false},CloudBackupRepository:{activeSharedObjectKeys:async()=>['pending-image']},CloudJsonPins:{keys:async()=>['pending-json']},CloudPayload:payload,cloudBackupListStats:{},listCloudBackups:async()=>[{manifest:{objects:[{objectKey:'objects/content-v1/image'}]},payload:{chunks:[{objectKey:key}]}}],GoogleDriveService:{listSyncObjects:async scope=>({objects:scope==='topology'?[{syncType:'checkpoint',objectKey:'root'}]:[]}),cleanupSharedContent:async keys=>{kept=keys;return {deleted:0}}},syncRemoteObjectRequest:o=>o,readCloudJsonRoot:async()=>{if(broken)throw Error('broken');return root},DiagnosticsLog:{info(){},warn(){}},syncReadAssetDescriptor:async()=>{throw Error('unused')}});
  vm.runInContext(fn('mapWithConcurrency')+'\n'+fn('cloudBackupReferences')+'\n'+fn('cleanupCloudSharedContent'),local);await local.cleanupCloudSharedContent();assert.ok(kept.includes(key));assert.ok(kept.includes(syncKey));assert.ok(kept.includes('pending-json'));
  kept=null;broken=true;const result=await local.cleanupCloudSharedContent();assert.equal(result.skipped,'invalid-json-root');assert.equal(kept,null);
});
console.log(`Hamboard large backup QA passed (${checks.length} checks).`);for(const name of checks)console.log(`  PASS ${name}`);
