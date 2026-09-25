import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

// Runs the real conflict-resolution functions from web/index.html. Until 1.0.15 they called
// syncConflictJson and syncPreserveConflict, which were never defined, so this path always threw.
const root=new URL("../",import.meta.url);
const html=await readFile(new URL("web/index.html",root),"utf8");
const modelSource=await readFile(new URL("web/shared/sync-state-model.js",root),"utf8");
function functionSource(name){
  const start=html.search(new RegExp(`^(?:async )?function ${name}\\(`,"m"));
  assert.ok(start>=0,`function ${name} exists`);
  const rest=html.slice(start),end=rest.slice(1).search(/\n(?:async )?function |\n(?:const|let) /);
  return end<0?rest:rest.slice(0,end+1)
}
const REAL=["syncConflictJson","syncPreserveConflict","syncConflictTypeLabel","syncConflictValueLabel","syncConflictCopyId","syncConflictCopyValue","syncConflictApplyValue","syncConflictMergeLibrary","syncConflictMergeWorkTracking","syncResolveConflictRecord","syncApplyChanges","syncClientProfile","syncStateEntityMap","normalizeSyncWorkTracking","dataRecords","syncEntityKey","syncChangeAssetIds","syncWorkspaceSnapshot"];

function createApp(notes){
  const app={state:{schemaVersion:1,notes:structuredClone(notes),projects:[],folders:[],settings:{}},conflicts:[],versions:[],resolved:[]};
  const ctx=vm.createContext({console,Date,Math,JSON,Promise,Map,Set,Array,String,Number,Object,Error,structuredClone,
    INITIAL_STATE:{schemaVersion:1},readState:value=>value,cloneData:value=>structuredClone(value),isDataRecord:value=>!!value&&typeof value==="object"&&!Array.isArray(value),
    collectDocumentAssetIds:()=>{},collectNoteHtmlAssetIds:()=>{},collectTrashAssetIds:()=>{},
    DiagnosticsLog:{info(){},warn(){},error(){}},safeRunAsync:(label,task)=>Promise.resolve().then(task),
    StateRepository:{cached:null,snapshot:()=>structuredClone(app.state),read:async()=>structuredClone(app.state),write:async value=>{app.state=structuredClone(value)}},
    VersionRepository:{put:async record=>{app.versions.push(record)}},
    SyncRepository:{
      listUnresolvedConflicts:async()=>app.conflicts.filter(row=>!app.resolved.includes(row.id)).map(row=>({...row})),
      recordConflict:async conflict=>{const id=`conflict-${app.conflicts.length+1}`;app.conflicts.push({id,entity_type:conflict.entityType,entity_id:conflict.entityId,base_json:conflict.baseJson??null,local_json:conflict.localJson??null,remote_json:conflict.remoteJson??null,created_at_ms:Date.now()});return id},
      resolveConflict:async id=>{app.resolved.push(id);return true},prepareOutbox:async()=>({})
    },
    syncApplyWorkTracking:async()=>{},syncUtilityTimerService:async()=>{},syncMascotOverlay:async()=>{},syncRenderCurrentState:()=>{},scheduleAutomaticSync:()=>{},
    documentEditHistories:new Map(),historyPendingAssetRemovals:new Set(),syncConflictResolutionWrite:false,syncConflictBlocked:true,state:null
  });
  vm.runInContext(modelSource,ctx);vm.runInContext("var SyncStateModel=HamboardSyncStateModel,SYNC_CLIENT_PROFILES=SyncStateModel.CLIENT_PROFILES",ctx);
  for(const name of REAL)vm.runInContext(functionSource(name),ctx);
  return {app,ctx}
}
const checks=[];async function check(name,run){await run();checks.push(name);console.log("  PASS",name)}
const local={id:"n1",title:"이 PC에서 고친 제목",content:"<p>로컬</p>",updatedAt:"2026-09-25T03:00:00.000Z"},remote={id:"n1",title:"다른 기기 제목",content:"<p>원격</p>",updatedAt:"2026-09-25T03:05:00.000Z"};
async function prepared(){
  const {app,ctx}=createApp([local]);
  const id=await ctx.syncPreserveConflict({entityType:"note",entityId:"n1",operation:"upsert",payloadJson:JSON.stringify(local),basePayloadJson:JSON.stringify({id:"n1",title:"원본"})},{entityType:"note",entityId:"n1",operation:"upsert",payload:remote},{baseRevision:"rev-0",remoteRevision:"rev-9",remoteDeviceId:"device-pc2"});
  return {app,ctx,id,conflict:app.conflicts[0]}
}

await check("a conflict is stored with both sides and the dialog labels can read it",async()=>{
  const {ctx,conflict}=await prepared();
  assert.equal(conflict.entity_type,"note");assert.deepEqual(ctx.syncConflictJson(conflict.local_json),local);assert.deepEqual(ctx.syncConflictJson(conflict.remote_json),remote);
  assert.equal(ctx.syncConflictValueLabel(ctx.syncConflictJson(conflict.local_json),"note"),"이 PC에서 고친 제목");
  assert.equal(ctx.syncConflictJson(null),null);assert.equal(ctx.syncConflictJson("not json"),null)
});
await check("the same conflict is not stored twice",async()=>{
  const {app,ctx}=await prepared();
  await ctx.syncPreserveConflict({entityType:"note",entityId:"n1",operation:"upsert",payloadJson:JSON.stringify(local)},{entityType:"note",entityId:"n1",operation:"upsert",payload:remote});
  assert.equal(app.conflicts.length,1)
});
await check("resolve: keep this computer's version",async()=>{
  const {app,ctx,conflict}=await prepared();
  const remaining=await ctx.syncResolveConflictRecord(conflict,"keep-local");
  assert.equal(remaining.length,0);assert.equal(app.state.notes.length,1);assert.equal(app.state.notes[0].title,local.title);assert.equal(app.versions.length,1,"previous data kept in version history")
});
await check("resolve: use the cloud version",async()=>{
  const {app,ctx,conflict}=await prepared();
  await ctx.syncResolveConflictRecord(conflict,"keep-remote");
  assert.equal(app.state.notes.length,1);assert.equal(app.state.notes[0].title,remote.title)
});
await check("resolve: keep both (cloud keeps the id, this computer's version becomes a copy)",async()=>{
  const {app,ctx,conflict}=await prepared();
  await ctx.syncResolveConflictRecord(conflict,"keep-both");
  const titles=app.state.notes.map(note=>note.title).sort();
  assert.deepEqual(titles,["다른 기기 제목","이 PC에서 고친 제목 (충돌 복사본)"]);
  assert.equal(app.state.notes.find(note=>note.id==="n1").title,remote.title)
});
await check("resolve: the other device deleted it, and 'use the cloud' deletes it here too",async()=>{
  const {app,ctx}=createApp([local]);
  await ctx.syncPreserveConflict({entityType:"note",entityId:"n1",operation:"upsert",payloadJson:JSON.stringify(local)},{entityType:"note",entityId:"n1",operation:"delete",payload:null});
  assert.equal(app.conflicts[0].remote_json,null);
  await ctx.syncResolveConflictRecord(app.conflicts[0],"keep-remote");assert.equal(app.state.notes.length,0)
});

await check("every sync…() function that is called is also defined",async()=>{
  const script=html.slice(html.indexOf("<script>\n",html.indexOf("lucide.min.js")),html.lastIndexOf("</script>"));
  const called=new Set([...script.matchAll(/(?<![.\w$])(sync[A-Z][\w$]*)\(/g)].map(match=>match[1]));
  const missing=[...called].filter(name=>!new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=|[,{]\\s*${name}\\s*=)`).test(script)).sort();
  assert.deepEqual(missing,[],`called but never defined: ${missing.join(", ")}`)
});

console.log(`Sync conflict QA passed (${checks.length} checks).`);
