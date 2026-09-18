import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const line=p=>html.split('\n').find(x=>x.trim().startsWith(p));
const between=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
let passed=0;const check=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
new Function(html.slice(html.indexOf('<script>\n',html.indexOf('lucide.min.js'))+8,html.lastIndexOf('</script>')));
check('main JavaScript parses',()=>{});
// Complete document snapshots, coalescing, reverting and linked changes.
{
 let serialized=0,copied=0,now=1000,serial=0;
 const c=vm.createContext({JSON:{stringify(...args){serialized++;return JSON.stringify(...args)}},Date:{now:()=>now},cloneData:v=>{copied++;return structuredClone(v)},documentEditHistories:new Map(),documentHistoryApplying:false,historyPendingAssetRemovals:new Set(),DOCUMENT_HISTORY_COALESCE_MS:700,documentHistoryLimit:()=>40,documentHistoryKey:(t,id)=>t+':'+id,sameId:(a,b)=>String(a)===String(b),uid:()=>String(++serial),safeRunAsync(){},cleanupHistoryPendingAssets(){}});
 const names=['documentHistoryCollection','documentHistoryDocument','documentHistoryComparable','documentHistoryState','documentHistoryBreak','documentHistoryTrashChanges','recordDocumentEdit','tryCoalesceLinkedDocumentEdits','captureDocumentEdits'];
 vm.runInContext(line('const documentHistoryCoalesceComparables='),c);
 for(const n of names)vm.runInContext(line('function '+n+'('),c);
 c.state={projects:[{id:'p',episodes:[{id:'e',blocks:[{id:'b',text:'old'}]}]}],notes:[{id:'n',content:'old'}]};c.previous=structuredClone(c.state);
 const capture=targets=>c.captureDocumentEdits(c.previous,{coalesce:true,targets});
 c.state.projects[0].episodes[0].blocks[0].text='new';capture([{type:'project',id:'p'}]);
 check('first project input serializes twice and retains snapshot copies',()=>{assert.equal(serialized,2);assert.equal(copied,3)});
 const row=c.documentEditHistories.get('project:p');
 check('Undo retains complete project including nested structure',()=>assert.equal(row.undo[0].before.episodes[0].blocks[0].text,'old'));
 serialized=0;copied=0;c.state.projects[0].episodes[0].blocks[0].text='newer';capture([{type:'project',id:'p'}]);
 check('coalesced input serializes twice with unchanged copy count',()=>{assert.equal(serialized,2);assert.equal(copied,2);assert.equal(row.undo.length,1)});
 c.state.projects[0].episodes[0].blocks[0].text='old';capture([{type:'project',id:'p'}]);
 check('typing back to baseline removes redundant Undo entry',()=>assert.equal(row.undo.length,0));
 c.state.projects[0].episodes[0].blocks[0].text='a';capture([{type:'project',id:'p'}]);c.documentHistoryBreak('project:p');c.state.projects[0].episodes[0].blocks[0].text='b';capture([{type:'project',id:'p'}]);
 check('explicit history boundary remains separate',()=>assert.equal(row.undo.length,2));
 now+=1000;c.state.projects[0].episodes[0].blocks[0].text='c';capture([{type:'project',id:'p'}]);
 check('elapsed coalescing boundary remains separate',()=>assert.equal(row.undo.length,3));
 // Move entry to redo and back, as Undo/Redo does, then resume typing.
 const top=row.undo.pop();row.redo.push(top);c.state.projects[0]=structuredClone(top.before);c.previous=structuredClone(c.state);c.documentHistoryBreak('project:p');
 c.state.projects[0].episodes[0].blocks[0].text='branched';capture([{type:'project',id:'p'}]);
 check('editing after Undo drops Redo and preserves old snapshots',()=>{assert.equal(row.redo.length,0);assert.equal(top.after.episodes[0].blocks[0].text,'c')});
 c.documentHistoryBreak();c.state.projects[0].episodes[0].blocks[0].text='linked';c.state.notes[0].content='linked';const targets=[{type:'project',id:'p'},{type:'note',id:'n'}];capture(targets);
 const projectTop=row.undo.at(-1),noteRow=c.documentEditHistories.get('note:n');
 check('cross-document changes retain shared operation and linked snapshots',()=>{assert.equal(projectTop.operationId,noteRow.undo.at(-1).operationId);assert.equal(projectTop.linkedChanges.length,2)});
 c.state.projects[0].episodes[0].blocks[0].text='linked2';c.state.notes[0].content='linked2';capture(targets);
 check('linked coalescing updates both documents without another entry',()=>{assert.equal(row.undo.at(-1),projectTop);assert.equal(projectTop.linkedChanges.find(x=>x.id==='n').after.content,'linked2')});
 check('comparable caches never enter saved documents or history snapshots',()=>assert.ok(!JSON.stringify(c.state).includes('Comparable')&&!JSON.stringify(projectTop).includes('Comparable')));
}
// Normalization once per incoming object, not once per frame.
{
 let scans=0;const c=vm.createContext({state:{utilities:{sound:{volume:150,favorites:[{packId:'p',fileName:'f'},{packId:'p',fileName:'f'}],albums:[],albumTracks:[],localTracks:[]}}},INITIAL_STATE:{utilities:{sound:{}}},isDataRecord:v=>v&&typeof v==='object'&&!Array.isArray(v),dataRecords:v=>{scans++;return Array.isArray(v)?v:[]},cloneData:structuredClone,sameId:(a,b)=>String(a)===String(b)});
 vm.runInContext(line('const normalizedSoundStates=')+'\n'+line('function utilityState(')+'\n'+line('function soundState('),c);
 const first=c.soundState(),favorites=first.favorites;check('new sound object normalized and deduplicated',()=>{assert.equal(first.volume,100);assert.equal(favorites.length,1)});
 scans=0;for(let i=0;i<200;i++)c.soundState();check('repeated runtime reads retain arrays without normalization',()=>{assert.equal(scans,0);assert.equal(c.soundState().favorites,favorites)});
 first.ambientVolume=17;check('runtime reads see immediate volume changes',()=>assert.equal(c.soundState().ambientVolume,17));
 c.state.utilities.sound={ambientVolume:-1};check('replaced/imported settings normalize again',()=>{assert.equal(c.soundState().ambientVolume,0);assert.equal(scans,4)});
}
// Modal close and replacement execute the same idempotent URL cleanup.
{
 const revoked=[],modal={style:{},classList:{remove(){}},querySelectorAll:()=>[],innerHTML:''},backdrop={style:{},classList:{remove(){},add(){}}};
 const c=vm.createContext({$:selector=>selector==='#modal'?modal:backdrop,URL:{revokeObjectURL:u=>revoked.push(u)},cropObjectUrl:'blob:crop',cropImage:{},draftGalleryFiles:[{url:'blob:a'},{url:'blob:b'}],workToolsPipEmbeddedSettingsModule:'',modalBlocking:true,currentViewName:()=> 'home',renderSoundMiniPlayer(){},requestAnimationFrame(){},wireSelectMenu(){},refreshFieldLinkEditors(){}});
 vm.runInContext(line('const revokeGalleryDraftUrls=')+'\n'+line('$("#modal")._resourceCleanup=')+'\n'+between('function releaseModalResources','function modal(')+'\n'+between('function closeModal(){','{const backdrop=$("#modalBackdrop");'),c);
 c.closeModal();c.closeModal();check('generic close releases crop and gallery URLs exactly once',()=>assert.deepEqual(revoked,['blob:crop','blob:a','blob:b']));
 c.cropObjectUrl='blob:next';vm.runInContext(line('$("#modal")._resourceCleanup='),c);c.renderModalInto(modal,backdrop,'replacement');check('modal replacement releases prior editor URL',()=>{assert.equal(revoked.at(-1),'blob:next');assert.equal(modal.innerHTML,'replacement')});
}
// One render for a burst; old document renders are discarded, including sorted/grid DOM updates.
{
 const pending=new Map();let serial=0,renders=0,map={nodes:[],groups:[]};const c=vm.createContext({currentMindmap:()=>map,mindmapRenderGeneration:1,requestAnimationFrame:fn=>{pending.set(++serial,fn);return serial},cancelAnimationFrame:id=>pending.delete(id),renderMindmapEdges:()=>renders++,document:{querySelector:()=>null},CSS:{escape:String}});vm.runInContext(between('let mindmapEdgesFrame=','function renderMindmapEdges(){'),c);vm.runInContext(line('function applyMindmapSortedDom('),c);
 for(let i=0;i<100;i++)c.scheduleMindmapEdgesRender();check('100 moves schedule one edge render',()=>assert.equal(pending.size,1));let fn=[...pending.values()][0];pending.clear();fn();check('frame renders current geometry once',()=>assert.equal(renders,1));
 renders=0;for(let i=0;i<100;i++)c.applyMindmapSortedDom(map);check('100 sorted/grid DOM updates schedule one edge render',()=>{assert.equal(renders,0);assert.equal(pending.size,1)});fn=[...pending.values()][0];pending.clear();fn();check('sorted/grid frame renders edges once',()=>assert.equal(renders,1));
 c.scheduleMindmapEdgesRender();map={nodes:[],groups:[]};fn=[...pending.values()][0];pending.clear();fn();check('switching maps discards queued edge work',()=>assert.equal(renders,1));c.scheduleMindmapEdgesRender();c.cancelMindmapEdgesRender();check('view exit cancels pending frame',()=>assert.equal(pending.size,0));
}
// Actual pet movement closure: no duplicate IPC, including in-flight suppression and retry.
{
 const sent=[];let fail=false,resolve;const c=vm.createContext({movePending:false,lastWindowMove:0,lastSentX:null,lastSentY:null,bounds:()=>({minX:0,maxX:100,minY:0,maxY:100}),b:{},x:10.2,y:20.2,currentWindow:{setPosition:p=>{sent.push(p);if(fail)return Promise.reject(Error('native'));return new Promise(r=>resolve=r)}},LogicalPosition:class{constructor(x,y){this.x=x;this.y=y}},DiagnosticsLog:{warn(){}},console:{warn(){}},item:{id:'p'},common:{},isMoving:true,lastSavedX:0,lastSavedY:0,window:{}});
 vm.runInContext(line('const clamp=()=>')+';this.move=moveWindow;',c);
 c.move(100);c.move(150);check('pending native move is not duplicated',()=>assert.equal(sent.length,1));resolve();await new Promise(r=>setImmediate(r));c.move(200);check('same rounded coordinates skip IPC',()=>assert.equal(sent.length,1));
 c.x=11;fail=true;c.move(250);await new Promise(r=>setImmediate(r));fail=false;c.move(300);check('failed position remains retryable',()=>assert.equal(sent.length,3));resolve();await new Promise(r=>setImmediate(r));
}
// PIP payloads compute only requested modules; calendar rows are cached until calendar/date/selection changes.
{
 const counts={sound:0,status:0,today:0,dday:0,timer:0};const utilities={pomodoro:{running:true,mode:'focus'},countdowns:[],reminders:[],mascots:[]};let dayKey='2026-09-16';
 const c=vm.createContext({state:{settings:{workToolModules:[]},calendarEvents:[{id:'e'}]},utilityState:()=>utilities,workToolModules:()=>c.state.settings.workToolModules,workTrackingView:{programs:[{id:'p'}]},sameId:(a,b)=>a===b,WorkTrackingRepository:{status:async()=>{counts.status++;return{sessionSeconds:{p:8}}}},DiagnosticsLog:{warn(){}},workToolPipVisibleTimers:new Set(),workToolPipTimerKey:(k,id)=>k+':'+id,pomodoroRemaining:()=>{counts.timer++;return 10},utilityStopwatch:{running:false,laps:[]},utilityStopwatchElapsed:()=>0,countdownRemaining:()=>10,localDateKey:()=>dayKey,calendarOccurrencesBetween:()=>{counts.today++;return[]},calendarEventCompare:()=>0,calendarEventColor:()=>'',calendarEventNextDate:()=>{counts.dday++;return '2026-09-17'},ddayValue:()=> 'D-1',utilityFormatSeconds:String,normalizeWorkToolPipZoomLevel:()=>0,workToolAppearance:()=>({}),soundPlayerPipState:()=>{counts.sound++;return{}},normalizeWorkToolPresets:()=>[]});
 vm.runInContext(between('let workToolsPipSettingsModule=','async function workToolsPipSoundLibrary'),c);
 let payload=await c.workToolsPipState();check('no active modules skip expensive data sources',()=>{assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),0);assert.equal(payload.timer,null)});
 c.state.settings.workToolModules=['timer'];payload=await c.workToolsPipState();check('enabling timer supplies current clock immediately',()=>{assert.equal(payload.timer.items[0].seconds,10);assert.equal(counts.status,0)});
 vm.runInContext('workToolsPipSettingsModule="sound"',c);payload=await c.workToolsPipState();check('open settings requests data even without visible card',()=>{assert.ok(payload.sound);assert.equal(counts.sound,1)});
 c.state.settings.workToolModules=['sound','worktimer','today','dday','mascot','timer'];payload=await c.workToolsPipState();check('all active modules retain data',()=>{assert.equal(payload.worktimer.seconds,8);assert.equal(counts.today,1);assert.equal(counts.dday,1);assert.ok(payload.mascot)});
 for(let i=0;i<20;i++)await c.workToolsPipState();check('unchanged PIP calendar data is not recomputed each tick',()=>{assert.equal(counts.today,1);assert.equal(counts.dday,1)});
 c.markWorkToolsPipCalendarDirty();await c.workToolsPipState();check('calendar revision invalidates both PIP calendar caches',()=>{assert.equal(counts.today,2);assert.equal(counts.dday,2)});
 dayKey='2026-09-17';await c.workToolsPipState();check('local date rollover refreshes calendar caches once',()=>{assert.equal(counts.today,3);assert.equal(counts.dday,3)});
 c.state.calendarEvents=[{id:'replacement'}];await c.workToolsPipState();check('calendar array replacement refreshes caches without explicit invalidation',()=>{assert.equal(counts.today,4);assert.equal(counts.dday,4)});
}
// Timer discovery is preserved even while its PIP card is disabled.
{
 const timers=[{id:'c',running:true}],visible=new Set(),local=new Set();
 const c=vm.createContext({$:()=>({}),utilityState:()=>({pomodoro:{},countdowns:timers,reminders:[]}),utilityStopwatch:{running:false},utilityStopwatchElapsed:()=>0,workToolPipTimerKey:(k,id)=>k+':'+id,utilityPopupVisibleTimers:local,workToolPipVisibleTimers:visible,workToolsPipWindow:{},markUtilityPopupTimerVisible:(k,id)=>local.add(k+':'+id),markWorkToolPipTimerVisible:(k,id)=>visible.add(k+':'+id)});
 vm.runInContext(between('function renderUtilityPip(){','  const pomodoroVisible=')+'}',c);
 c.renderUtilityPip();timers[0].running=false;c.renderUtilityPip();
 check('hidden-module timer remains discoverable after completion',()=>assert.ok(visible.has('countdown:c')));
 timers.length=0;c.renderUtilityPip();check('removed timers are pruned while module is hidden',()=>assert.equal(visible.size,0));
}
console.log(`Targeted performance QA passed (${passed} checks).`);
