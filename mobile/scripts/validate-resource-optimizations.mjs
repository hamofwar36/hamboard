import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const between=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const line=prefix=>html.split('\n').find(s=>s.trim().startsWith(prefix));
let checks=0;
const check=(label,fn)=>{fn();checks++;console.log('PASS '+label)};
const context=values=>vm.createContext({...values});
const cleanupSource=between('let historyAssetCleanupPromise=null;','function trimDocumentEditHistories');
function fixture(ids){
 const live=new Set(),undo=new Set(),versions=new Set(),removed=[];let scans=0,gate=null,fail=false;
 const c=context({historyPendingAssetRemovals:new Set(ids),stateReferencesAsset:id=>live.has(id),historyReferencesAsset:id=>undo.has(id),persistedVersionAssetIds:async()=>{scans++;if(gate)await gate;if(fail)throw Error('query failed');return new Set(versions)},AssetRepository:{remove:async id=>removed.push(id)},DiagnosticsLog:{error(){},info(){}},console:{warn(){}}});
 vm.runInContext(cleanupSource,c);
 return {c,live,undo,versions,removed,scanCount:()=>scans,setGate:x=>gate=x,setFail:x=>fail=x,run:options=>c.cleanupHistoryPendingAssets(options)};
}
{
 const f=fixture(['live','undo']);f.live.add('live');f.undo.add('undo');await Promise.all(Array.from({length:20},()=>f.run()));
 check('live and Undo references skip version reads and remain protected',()=>{assert.equal(f.scanCount(),0);assert.equal(f.removed.length,0);assert.equal(f.c.historyPendingAssetRemovals.size,2)});
}
{
 const f=fixture(['unused','version']);f.versions.add('version');let release;f.setGate(new Promise(r=>release=r));
 const jobs=Array.from({length:20},()=>f.run());release();await Promise.all(jobs);
 check('concurrent cleanup shares one query and one deletion',()=>{assert.equal(f.scanCount(),1);assert.deepEqual(f.removed,['unused']);assert.equal(f.c.historyPendingAssetRemovals.size,0)});
}
{
 const f=fixture(['restored']);let release;f.setGate(new Promise(r=>release=r));const job=f.run();f.live.add('restored');release();await job;
 check('reference restored during async query is rechecked',()=>{assert.equal(f.removed.length,0);assert.equal(f.c.historyPendingAssetRemovals.size,1)});
}
{
 const f=fixture(['unused','undo','version','live']);f.undo.add('undo');f.versions.add('version');f.live.add('live');let release;f.setGate(new Promise(r=>release=r));const normal=f.run(),close=f.run({ignoreHistory:true});release();await Promise.all([normal,close]);
 check('close waits for active pass and retains live/version protection',()=>{assert.deepEqual(f.removed,['unused','undo']);assert.deepEqual([...f.c.historyPendingAssetRemovals],['live']);assert.equal(f.scanCount(),2)});
}
{
 const f=fixture(['unused']);f.setFail(true);await f.run();
 check('failed version query never deletes candidates',()=>assert.equal(f.removed.length,0));
 f.setFail(false);await f.run();check('cleanup can retry after failure',()=>assert.deepEqual(f.removed,['unused']));
}
{
 const c=context({normalizeWorkToolModules:x=>x||[],normalizeWorkToolPipZoomLevel:x=>x||0,workResetConfirmOpen:false,managementOpen:false,managementModule:'',openSettings:[],workProgramPickerOpen:false,alertPickerOpen:false,soundVolumeOpen:false,soundExtrasOpen:false,soundLibrary:null});
 vm.runInContext(line('const signature=value=>')+';this.signature=signature;',c);
 const initial={modules:['timer','sound'],timer:{stopwatchRunning:true,stopwatchElapsed:1000,stopwatchLaps:[],items:[{id:'stopwatch',kind:'stopwatch',running:true,seconds:1}]}};
 const later=structuredClone(initial);later.timer.stopwatchElapsed=2000;later.timer.items[0].seconds=2;
 check('elapsed-only change keeps PIP DOM signature',()=>assert.equal(c.signature(initial),c.signature(later)));
 for(const [label,mutate] of [['pause',v=>v.timer.stopwatchRunning=false],['lap',v=>v.timer.stopwatchLaps.push({totalMs:2000,splitMs:2000})],['reset',v=>{v.timer.stopwatchRunning=false;v.timer.items=[]}],['module toggle',v=>v.modules=['sound']]]){
  const next=structuredClone(later);mutate(next);check(label+' still changes PIP structure',()=>assert.notEqual(c.signature(later),c.signature(next)));
 }
 const node={dataset:{pipTimerItem:'stopwatch'},textContent:''};c.latest=later;c.latestAt=Date.now();c.core=null;c.root={querySelector:()=>null,querySelectorAll:()=>[node]};c.sameId=(a,b)=>a===b;c.utilityFormatStopwatch=x=>String(x);c.utilityFormatSeconds=x=>String(x);c.formatSoundTime=x=>String(x);
 vm.runInContext(line('const updateLive=()=>')+';this.updateLive=updateLive;',c);c.updateLive();
 check('live clock still updates without structural rerender',()=>assert.equal(node.textContent,'2000'));
}
{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE version_records(id TEXT, owner_key TEXT, at_ms INTEGER, record_json TEXT)');
 const insert=db.prepare('INSERT INTO version_records VALUES(?,?,?,?)');insert.run('a','note:n',1,JSON.stringify({id:'a',atMs:1,data:{content:'old'}}));insert.run('b','note:n',2,JSON.stringify({id:'b',atMs:2,data:{content:'same'}}));
 const c=context({openVersionDatabase:async()=>({select:async(sql,args)=>db.prepare(sql).all(Object.fromEntries(args.map((value,index)=>[`$${index+1}`,value])))})});vm.runInContext(between('const VersionRepository={','function collectNoteHtmlAssetIds')+';this.repo=VersionRepository;',c);
 const newest=await c.repo.latest('note:n'),empty=await c.repo.latest('note:empty');check('latest query returns newest record or null',()=>{assert.equal(newest.id,'b');assert.equal(empty,null)});
 let writes=0,prunes=0;const saved=[];Object.assign(c,{versionStorageReady:async()=>{},versionOwnerKey:(o,t)=>`${t}:${o.id}`,persistStateQuietly:()=>writes++,collectVersionDataAssetIds:()=>new Set(),uid:()=> 'new',cloneData:structuredClone,versionAssetResourceSnapshots:()=>[],pruneVersionRecords:async()=>prunes++,DiagnosticsLog:{error(){}},console});c.repo.put=async record=>saved.push(record);
 vm.runInContext(line('async function captureVersionSnapshot(')+'\n'+line('async function ensureVersionBaseline('),c);
 const owner={id:'n'};assert.equal(await c.captureVersionSnapshot(owner,{content:'same'},'auto',{type:'note',kind:'auto'}),false);
 check('unchanged automatic version is skipped',()=>{assert.equal(saved.length,0);assert.equal(writes,1)});
 await c.captureVersionSnapshot(owner,{content:'different'},'auto',{type:'note',kind:'auto'});
 check('changed automatic version is saved and pruned',()=>{assert.equal(saved.length,1);assert.equal(prunes,1)});
 await c.captureVersionSnapshot(owner,{content:'same'},'manual',{type:'note',kind:'manual'});
 check('manual version remains protected even with equal content',()=>assert.equal(saved[1].protected,true));
 const baseline={id:'n'};await c.ensureVersionBaseline(baseline,{},'note');check('existing baseline timestamp restored',()=>assert.equal(baseline.versionLastAt,2));
 await c.ensureVersionBaseline({id:'empty'},{content:'first'},'note');check('missing baseline created',()=>assert.equal(saved.length,3));db.close();
}
{
 const revoked=[],logs=[];let fail=true;const c=context({AssetRepository:{get:async()=>({blob:{}})},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:url=>revoked.push(url)},Image:class{set src(value){queueMicrotask(()=>fail?this.onerror(Error('decode failed')):this.onload())}},DiagnosticsLog:{warn:(...args)=>logs.push(args)},console:{warn(){}}});
 vm.runInContext(line('async function canvasMindmapAssetImage('),c);assert.equal(await c.canvasMindmapAssetImage('image'),null);
 check('failed image decode releases URL and logs actual error',()=>{assert.deepEqual(revoked,['blob:test']);assert.equal(logs[0][2].error.message,'decode failed')});
 fail=false;const result=await c.canvasMindmapAssetImage('image');check('successful image retains URL for export caller',()=>{assert.equal(result.url,'blob:test');assert.equal(revoked.length,1)});
}
{
 // Exercise the actual final scheduler independently of native window construction.
 const tail=html.split('\n').find(s=>s.includes('if(common.speechEnabled&&item.dialogues?.length)speechTimer=setInterval')&&s.includes('if(item.motion==="bounce")frame=requestAnimationFrame(tick)'));
 for(const motion of ['static','bounce']){let frames=0,intervals=0;const c=context({common:{speechEnabled:false},item:{motion,dialogues:[]},speechTimer:0,frame:0,speech(){},speechHideTimer:0,emitPosition(){},objectUrl:'blob:test',URL:{revokeObjectURL(){}},setInterval:()=>{intervals++;return 1},clearInterval(){},clearTimeout(){},cancelAnimationFrame(){},window:{addEventListener(){}},requestAnimationFrame:()=>++frames,tick(){}});vm.runInContext(tail,c);check(motion+' pet RAF scheduling',()=>assert.equal(frames,motion==='bounce'?1:0));check(motion+' pet has no periodic position save',()=>assert.equal(intervals,0))}
 const click=html.split('\n').find(s=>s.includes('sprite.onclick=()=>')&&s.includes('const hop=time=>'));
 let hops=0;const c=context({sprite:{},dragged:false,speak(){},item:{motion:'static'},performance:{now:()=>0},img:{style:{}},requestAnimationFrame:()=>++hops});vm.runInContext(click,c);c.sprite.onclick();check('static pet click still starts hop animation',()=>assert.equal(hops,1));
}
console.log(`Resource optimization QA passed (${checks} checks).`);
