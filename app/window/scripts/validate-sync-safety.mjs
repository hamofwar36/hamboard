import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const root=new URL('../',import.meta.url);
const html=await readFile(new URL('web/index.html',root),'utf8');
const safetySource=await readFile(new URL('web/shared/transfer-safety.js',root),'utf8');
function functionSource(name){
  const start=html.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
  assert.ok(start>=0,`function ${name} exists`);
  const rest=html.slice(start),end=rest.slice(1).search(/\n(?:async )?function |\n(?:const|let) /);
  return end<0?rest:rest.slice(0,end+1);
}
function context(extra={}){const ctx=vm.createContext({TextEncoder,Blob,console,...extra});vm.runInContext(safetySource,ctx);ctx.TransferSafety=ctx.HamboardTransferSafety;return ctx}
const base=context(),safety=base.TransferSafety;
const checks=[];
async function check(name,task){await task();checks.push(name)}
function gate(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
async function tick(){await new Promise(r=>setImmediate(r))}
await check('JSON sizes above 16 MiB remain valid; malformed sizes are rejected',()=>{
  for(const kind of ['manifest','sync']){
    assert.equal(safety.validateCloudObjectSize(kind,100*1024*1024),100*1024*1024);
    assert.throws(()=>safety.validateCloudObjectSize(kind,NaN),/cloud-json-size-invalid/);
  }
});
await check('real Drive service routes JSON through chunk transport',async()=>{
  let received=null;const ctx=context({cloudJsonTransport:()=>({upload:request=>{received=request;return 'uploaded'}})});
  const line=html.split('\n').find(line=>line.trim().startsWith('putObject(request){'));
  vm.runInContext('globalThis.service={'+line+'}',ctx);
  const request={kind:'manifest',source:'text',content:'large JSON'};
  assert.equal(await ctx.service.putObject(request),'uploaded');assert.equal(received,request);
});
const commit=(revision,baseRevision,changes=[])=>({revision,baseRevision,changes,syncType:'commit',objectKey:`sync/commits/${revision}.json`});
const checkpoint=revision=>({revision,syncType:'checkpoint',objectKey:`sync/checkpoints/${revision}.json`});
const upsert=(id,title)=>({entityType:'note',entityId:id,operation:'upsert',payload:{id,title}});
function reconstructionContext(valid=new Map()){
  const attempts=[],replayed=[];
  const ctx=context({
    syncEmptyRemoteState:()=>({schemaVersion:1,notes:[]}),
    syncReadCheckpoint:async object=>{attempts.push(object.revision);if(!valid.has(object.revision))throw Error('simulated-download-failure');return {state:structuredClone(valid.get(object.revision)),revision:object.revision,deviceId:'device-a'}},
    syncReadCommit:async object=>{replayed.push(object.revision);return {...object,deviceId:'device-a'}},
    syncApplyChanges:(state,changes)=>{const result=structuredClone(state);for(const c of changes){result.notes=result.notes.filter(n=>n.id!==c.entityId);if(c.operation==='upsert')result.notes.push(c.payload)}return result},
    syncStateEntityMap:state=>new Map(state.notes.map(n=>['note:'+n.id,{value:n}])),
    syncEntityKey:(type,id)=>type+':'+id,
    DiagnosticsLog:{info(){},warn(){}}
  });
  vm.runInContext(functionSource('syncCheckpointCandidates')+'\n'+functionSource('syncReconstructRemoteHead'),ctx);
  return {ctx,attempts,replayed};
}
await check('failed latest checkpoint falls back to retained previous checkpoint',async()=>{
  const {ctx,attempts,replayed}=reconstructionContext(new Map([['r8',{schemaVersion:1,notes:[{id:'a',title:'old unchanged note'}]}]]));
  const path=[commit('r9','r8',[upsert('b','first')]),commit('r16','r9',[upsert('b','latest')])];
  const result=await ctx.syncReconstructRemoteHead({anchorRevision:'r8',compacted:true,path,head:path.at(-1)},[checkpoint('r8'),checkpoint('r16')],{});
  assert.deepEqual(attempts,['r16','r8']);assert.equal(result.checkpointUsed,'r8');
  assert.deepEqual(result.remote.notes.map(x=>x.id),['a','b']);assert.deepEqual(replayed,['r9','r16']);
});
await check('compacted history fails closed when all checkpoints fail, without replaying deletions',async()=>{
  const {ctx,replayed}=reconstructionContext();const path=[commit('r9','r8',[upsert('b','latest')])];
  await assert.rejects(ctx.syncReconstructRemoteHead({anchorRevision:'r8',compacted:true,path,head:path[0]},[checkpoint('r8'),checkpoint('r9')],{}),/sync-history-incomplete/);
  assert.deepEqual(replayed,[]);
});
await check('complete root chain remains a valid fallback',async()=>{
  const {ctx}=reconstructionContext();const path=[commit('r1','',[upsert('a','old')]),commit('r2','r1',[upsert('b','new')])];
  const result=await ctx.syncReconstructRemoteHead({path,head:path[1]},[checkpoint('r2')],{});
  assert.equal(result.checkpointUsed,null);assert.deepEqual(result.remote.notes.map(n=>n.id),['a','b']);
});
await check('valid newest checkpoint skips covered commits',async()=>{
  const {ctx,replayed}=reconstructionContext(new Map([['r9',{notes:[{id:'a'},{id:'b'}]}]]));
  const result=await ctx.syncReconstructRemoteHead({anchorRevision:'r8',path:[commit('r9','r8')]},[checkpoint('r9')],{});
  assert.equal(result.checkpointUsed,'r9');assert.deepEqual(replayed,[]);assert.equal(result.remote.notes.length,2);
});
await check('gap in replay tail never yields a partial state',async()=>{
  const {ctx}=reconstructionContext(new Map([['r8',{notes:[{id:'a'}]}]]));
  await assert.rejects(ctx.syncReconstructRemoteHead({anchorRevision:'r8',path:[commit('r9','missing-parent')]},[checkpoint('r8')],{}),/sync-history-incomplete/);
});
await check('cycle/repeated revisions are rejected',()=>{
  assert.throws(()=>safety.validateReplayPath([commit('a',''),commit('b','a'),commit('a','b')]),/sync-history-incomplete/);
});
await check('queued operations serialize and continue after failure',async()=>{
  const coordinator=safety.createCoordinator(),hold=gate(),events=[];
  const first=coordinator.run('sync',async()=>{events.push('sync');await hold.promise;throw Error('network')});
  const observed=assert.rejects(first,/network/);
  const second=coordinator.run('backup',async()=>{events.push('backup');return 'saved'});
  const third=coordinator.run('restore',async()=>{events.push('restore')});
  await tick();assert.deepEqual(events,['sync']);assert.equal(coordinator.busy,true);
  hold.resolve();await observed;assert.equal(await second,'saved');await third;
  assert.deepEqual(events,['sync','backup','restore']);assert.equal(coordinator.busy,false);assert.equal(coordinator.active,null);
});
await check('actual automatic sync retains lock until lease release; backup and restore wait',async()=>{
  const connection=gate(),lease=gate(),backup=gate(),events=[];
  const ctx=context({navigator:{onLine:true},
    DataTransferCoordinator:safety.createCoordinator(),
    syncAutomaticPromise:null,syncManualImportPromise:null,syncReconnectImportPending:false,cloudBackupUploadPromise:null,
    SYNC_POLL_INTERVAL_MS:30000,syncAutomaticFailureCount:0,syncAutomaticRetryNotBefore:0,
    GoogleDriveService:{status:async()=>{events.push('sync-start');await connection.promise;return {connected:false}}},
    syncSetReadonly(){},syncReleaseOwnLease:async()=>{events.push('lease-release');await lease.promise},
    syncResetAutomaticBackoff(){},scheduleAutomaticSync(){},
    DiagnosticsLog:{info(){},warn(){},error(){}},
    CloudBackupRepository:{readRun:async()=>{events.push('backup-start');await backup.promise;return {id:'backup-1'}},progress:async()=>({total:1,uploaded:1}),complete:async()=>events.push('backup-complete')},
    applyPreparedBackupExclusive:async()=>events.push('restore-start')
  });
  for(const name of ['runAutomaticSync','runCloudBackup','applyPreparedBackup'])vm.runInContext(functionSource(name),ctx);
  const sync=ctx.runAutomaticSync();await tick();const upload=ctx.runCloudBackup('backup-1');const restore=ctx.applyPreparedBackup({});
  await tick();assert.deepEqual(events,['sync-start']);
  connection.resolve();await tick();assert.deepEqual(events,['sync-start','lease-release']);
  lease.resolve();await sync;await tick();assert.deepEqual(events,['sync-start','lease-release','backup-start']);
  backup.resolve();await upload;await restore;assert.deepEqual(events,['sync-start','lease-release','backup-start','backup-complete','restore-start']);
});
await check('cloud restore keeps one lock across download and application',async()=>{
  const download=gate(),events=[],coordinator=safety.createCoordinator();
  const ctx=context({DataTransferCoordinator:coordinator,prepareCloudBackupImport:async()=>{events.push('download');await download.promise;return {cloudBackupId:'b'}},applyPreparedBackupExclusive:async()=>events.push('apply')});
  vm.runInContext(functionSource('restoreCloudBackup'),ctx);
  const restore=ctx.restoreCloudBackup({});const next=coordinator.run('sync',async()=>events.push('sync'));
  await tick();assert.deepEqual(events,['download']);download.resolve();await restore;await next;assert.deepEqual(events,['download','apply','sync']);
});
await check('restore barrier drains in-flight repository work and rejects new writes',async()=>{
  const ctx=context({backupRestoreBlocksWrites:false,restoreRepositoryWork:new Set(),historyAssetCleanupPromise:null,StateRepository:{writeQueue:Promise.resolve()}});
  vm.runInContext(functionSource('runRestoreRepositoryWork')+'\n'+functionSource('drainRestoreRepositoryWork'),ctx);
  const hold=gate();let finished=false;const work=ctx.runRestoreRepositoryWork(()=>hold.promise);
  ctx.backupRestoreBlocksWrites=true;const drain=ctx.drainRestoreRepositoryWork().then(()=>{finished=true});
  await assert.rejects(ctx.runRestoreRepositoryWork(()=>{}),/backup-restore-in-progress/);await tick();assert.equal(finished,false);
  hold.resolve();await work;await drain;assert.equal(finished,true);
});
await check('restore errors release editor/write barrier',async()=>{
  let released=false;const ctx=context({backupRestoreBlocksWrites:false,StateRepository:{flush:async()=>{}},versionIdleTimers:new Map(),clearTimeout,installBackupRestoreGuard:()=>()=>{released=true},drainRestoreRepositoryWork:async()=>{throw Error('simulated-drain-failure')}});
  vm.runInContext(functionSource('applyPreparedBackupExclusive'),ctx);
  await assert.rejects(ctx.applyPreparedBackupExclusive({}),/simulated-drain-failure/);assert.equal(ctx.backupRestoreBlocksWrites,false);assert.equal(released,true);
});
await check('staging paths are unique and cleanup removes only the owned file',async()=>{
  const files=new Map(),ctx=context({ASSET_DIRECTORY:'assets',window:{crypto:{randomUUID}},assetBaseDirectory:()=>1,assetFilesystem:()=>({writeFile:async(path,data)=>files.set(path,data),exists:async path=>files.has(path),remove:async path=>files.delete(path)}),DiagnosticsLog:{warn(){}}});
  for(const name of ['cloudUploadStagingPath','stageCloudUpload','removeCloudUploadStaging'])vm.runInContext(functionSource(name),ctx);
  const a=await ctx.stageCloudUpload(new Blob(['a'])),b=await ctx.stageCloudUpload(new Blob(['b']));assert.notEqual(a,b);await ctx.removeCloudUploadStaging(a);assert.equal(files.has(a),false);assert.equal(files.has(b),true);
});
// Native-side regression gates supplement behavioral JS tests; Windows Rust tests
// live next to the size/path helpers and must be run on a Windows build host.
const rust=await readFile(new URL('src-tauri/src/google_drive.rs',root),'utf8');
await check('native removes fixed JSON limits and keeps actual response bounds',()=>{
  assert.doesNotMatch(rust,/MAX_(?:CLOUD_JSON|SYNC_OBJECT|MANIFEST)_BYTES/);
  assert.match(rust,/received > remote.byte_size/);
  assert.match(rust,/is_upload_staging_name\(&file_name\)/);
  assert.match(rust,/"summaryOnly": true/);
  assert.match(rust,/fresh_payload_chunk/);
});
console.log(`Hamboard sync safety QA passed (${checks.length} checks).`);
for(const name of checks)console.log(`  PASS ${name}`);
