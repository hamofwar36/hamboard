import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const source=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
let checks=0;function check(name,fn){fn();checks++;console.log('PASS '+name)}
const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE app_state(state_key TEXT, state_json TEXT); CREATE TABLE sync_runtime_state(singleton INTEGER, state_change_sequence INTEGER); INSERT INTO sync_runtime_state VALUES(1,1)');
const data={schemaVersion:1,projects:[{id:'large',text:'x'.repeat(1000000)}],settings:{mode:'dark'},calendarEvents:[{id:'event'}],quickMemos:[{id:'memo',desktopWidget:{enabled:true}}]};db.prepare('INSERT INTO app_state VALUES(?,?)').run('state',JSON.stringify(data));
let projections=0,normalized=0;const queries=[];
const c=vm.createContext({SCHEMA_VERSION:1,STORAGE_KEYS:{state:'state'},readState:x=>{normalized++;return x},DiagnosticsLog:{error(){}},cloneData:structuredClone});
vm.runInContext(source('const StateRepository={','const ProjectRepositoryCore=')+';this.repo=StateRepository',c);
c.repo.connect=async()=>({select:async(sql,args=[])=>{queries.push(sql);if(sql.includes('widget_json'))projections++;const st=db.prepare(sql);return args.length?st.all(Object.fromEntries(args.map((v,i)=>[`$${i+1}`,v]))):st.all()}});
const sentinel={all:'state'};c.repo.cached=sentinel;
const calendar=await c.repo.readWidget('calendar',{force:true});
check('calendar projection excludes documents and quick memos',()=>{assert.equal(calendar.projects,undefined);assert.equal(calendar.quickMemos,undefined);assert.equal(calendar.calendarEvents[0].id,'event');assert.equal(calendar.settings.mode,'dark')});
for(let i=0;i<20;i++)assert.equal(await c.repo.readWidget('calendar'),null);
check('unchanged polling performs no payload read or normalization',()=>{assert.equal(projections,1);assert.equal(normalized,1)});
data.projects[0].text='changed';db.prepare('UPDATE app_state SET state_json=?').run(JSON.stringify(data));db.exec('UPDATE sync_runtime_state SET state_change_sequence=2');assert.equal(await c.repo.readWidget('calendar'),null);
check('unrelated edit does not normalize widget again',()=>assert.equal(normalized,1));
data.calendarEvents.push({id:'new-event'});db.prepare('UPDATE app_state SET state_json=?').run(JSON.stringify(data));db.exec('UPDATE sync_runtime_state SET state_change_sequence=3');
const changed=await c.repo.readWidget('calendar');check('event changes propagate',()=>assert.equal(changed.calendarEvents.length,2));
const memo=await c.repo.readWidget('quickMemo',{force:true});check('quick memo projection retains list and settings only',()=>{assert.equal(memo.calendarEvents,undefined);assert.equal(memo.quickMemos[0].desktopWidget.enabled,true)});
data.quickMemos[0].desktopWidget.enabled=false;data.settings.mode='light';db.prepare('UPDATE app_state SET state_json=?').run(JSON.stringify(data));db.exec('UPDATE sync_runtime_state SET state_change_sequence=4');
const disabled=await c.repo.readWidget('quickMemo');check('disable and theme changes propagate',()=>{assert.equal(disabled.quickMemos[0].desktopWidget.enabled,false);assert.equal(disabled.settings.mode,'light')});
check('widget reads never replace full-state snapshot',()=>assert.equal(c.repo.cached,sentinel));
await assert.rejects(()=>c.repo.readWidget('invalid'));db.close();
const emitter=source('async function emitWorkToolsPipState(','async function closeWorkToolsPipWindow');
function pipFixture(){let builds=0;const events=[];let release;const gate=new Promise(r=>release=r);const x=vm.createContext({workToolsPipWindow:{id:'window'},workToolsPipStateEmitAt:0,workToolsPipEmitPromise:null,workToolsPipEmitRequested:false,workToolsPipState:async()=>{const revision=++builds;if(revision===1)await gate;return {revision}},window:{__TAURI__:{event:{emit:async(name,payload)=>events.push(payload)}}},DiagnosticsLog:{warn(){}}});vm.runInContext(emitter,x);return {x,events,release,builds:()=>builds}}
{
 const f=pipFixture(),jobs=Array.from({length:20},()=>f.x.emitWorkToolsPipState(false));f.release();await Promise.all(jobs);check('concurrent periodic sends build once',()=>{assert.equal(f.builds(),1);assert.equal(f.events.length,1)})
}
{
 const f=pipFixture(),jobs=Array.from({length:20},()=>f.x.emitWorkToolsPipState(true));f.release();await Promise.all(jobs);check('forced actions during send produce one fresh follow-up',()=>{assert.equal(f.builds(),2);assert.equal(f.events.at(-1).revision,2)})
}
{
 const f=pipFixture(),job=f.x.emitWorkToolsPipState(true);f.x.workToolsPipWindow=null;f.release();await job;check('closed window discards stale in-flight payload',()=>assert.equal(f.events.length,0))
}
{
 let requests=0,callback,period;const x=vm.createContext({setInterval:(fn,ms)=>{callback=fn;period=ms},lastStateReceivedAt:10000,Date:{now:()=>12000},emitCommand:()=>requests++});
 vm.runInContext('setInterval(()=>{if(Date.now()-lastStateReceivedAt>=5000)emitCommand("request-state")},5000);',x);callback();check('healthy stream does not request duplicate state',()=>assert.equal(requests,0));x.Date.now=()=>16000;callback();check('stale stream requests recovery',()=>{assert.equal(requests,1);assert.equal(period,5000)});
 assert.ok(html.includes('setInterval(()=>{if(Date.now()-lastStateReceivedAt>=5000)emitCommand("request-state")},5000);'));
}
check('quick memo polling blocks overlapping reads',()=>assert.ok(html.includes('let refreshBusy=false;setInterval(async()=>{if(refreshBusy)return;refreshBusy=true;')));
console.log(`Background optimization QA passed (${checks} checks).`);
