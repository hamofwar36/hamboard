import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root=new URL("../",import.meta.url);
const source=await readFile(new URL("web/shared/sync-state-model.js",root),"utf8");
const context=vm.createContext({structuredClone});
vm.runInContext(source,context,{filename:"sync-state-model.js"});
const model=context.HamboardSyncStateModel;
const checks=[];
const check=(name,run)=>{run();checks.push(name)};
const dataEqual=(actual,expected)=>assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)));

const canonical={
  schemaVersion:1,
  folders:[{id:"folder-1",name:"Shared"}],projects:[{id:"project-1",title:"Before"}],mindmaps:[{id:"map-1",title:"Map"}],notes:[{id:"note-1",title:"Delete me"}],
  characterRepository:[{id:"character-1",name:"Character"}],characterFieldTemplates:[{id:"field-1",label:"Age"}],trash:[{id:"trash-1",type:"note"}],storyTemplates:[{id:"template-1",name:"PC only"}],calendarEvents:[{id:"event-1",title:"Event"}],quickMemos:[{id:"memo-1",text:"Memo"}],
  tagLibrary:["old"],favorites:[{type:"project",id:"project-1"}],workTrackingSync:{programs:[{id:"program-1",executable_path:"C:/writer.exe"}],daily:[{program_id:"program-1",work_date:"2026-09-18",seconds:300}]},
  homeWidgets:["recent","schedule"],homeWidgetPositions:{recent:{column:1,row:1}},homeScheduleWidget:{enabled:true,range:"week"},homeDdayWidget:{eventId:"event-1"},collapsedFolderIds:["folder-1"],newsReadIds:["news-1"],
  utilities:{countdowns:[{id:"timer-1",remainingSeconds:60}],mascots:[{id:"pet-1"}]},settings:{theme:"cotton-candy",calendarDesktopWidget:{enabled:true,x:10},workToolModules:["timer","worktimer"],defaultStoryTemplateId:"template-1"},
  futureDesktopField:{keep:"opaque"}
};
const original=structuredClone(canonical),mobile=model.projectCanonicalState(canonical,model.CLIENT_PROFILES.mobileCore);

check("mobile projection contains primary and support collections",()=>{for(const field of ["projects","notes","mindmaps","calendarEvents","characterRepository","quickMemos","folders","characterFieldTemplates","trash"])assert.ok(Array.isArray(mobile[field]),field)});
check("mobile projection omits deferred desktop state but retains shared display settings",()=>{for(const field of ["storyTemplates","workTrackingSync","homeWidgets","homeWidgetPositions","homeScheduleWidget","homeDdayWidget","utilities","futureDesktopField"])assert.equal(Object.prototype.hasOwnProperty.call(mobile,field),false,field);dataEqual(mobile.settings,{theme:"cotton-candy"});assert.equal(Object.prototype.hasOwnProperty.call(mobile.settings,"calendarDesktopWidget"),false)});
check("projection does not mutate canonical state",()=>dataEqual(canonical,original));

const edited=structuredClone(mobile);edited.projects[0].title="After";edited.notes=[];edited.tagLibrary=["old","new"];
const merged=model.mergeClientProjection(canonical,mobile,edited,model.CLIENT_PROFILES.mobileCore);
check("mobile diff emits only edited owned entities",()=>dataEqual([...merged.changes].map(change=>`${change.entityType}:${change.entityId}:${change.operation}`),["project:project-1:upsert","note:note-1:delete","user-library:main:upsert"]));
check("mobile edits are merged into canonical state",()=>{assert.equal(merged.canonicalState.projects[0].title,"After");assert.equal(merged.canonicalState.notes.length,0);dataEqual(merged.canonicalState.tagLibrary,["old","new"])});
check("opaque desktop half survives mobile merge byte-for-byte",()=>{for(const field of ["storyTemplates","workTrackingSync","homeWidgets","homeWidgetPositions","homeScheduleWidget","homeDdayWidget","utilities","settings","futureDesktopField"])dataEqual(merged.canonicalState[field],canonical[field],field)});
check("mobile merge leaves input canonical untouched",()=>dataEqual(canonical,original));
const desktopReceived=model.applyRemoteChangesToCanonical(canonical,merged.changes);
check("desktop applies mobile changes without losing its unused half",()=>{assert.equal(desktopReceived.projects[0].title,"After");assert.equal(desktopReceived.notes.length,0);dataEqual(desktopReceived.tagLibrary,["old","new"]);for(const field of ["storyTemplates","workTrackingSync","homeWidgets","homeWidgetPositions","homeScheduleWidget","homeDdayWidget","utilities","settings","futureDesktopField"])dataEqual(desktopReceived[field],canonical[field],field)});
check("mobile cannot write a deferred entity",()=>assert.throws(()=>model.applyClientChangesToCanonical(canonical,[{entityType:"story-template",entityId:"template-1",operation:"delete",payload:null}],model.CLIENT_PROFILES.mobileCore),/sync-change-not-writable-by-client/));
check("mobile cannot write work tracking",()=>assert.throws(()=>model.applyClientChangesToCanonical(canonical,[{entityType:"work-tracking",entityId:"main",operation:"upsert",payload:{programs:[],daily:[]}}],model.CLIENT_PROFILES.mobileCore),/sync-change-not-writable-by-client/));

const remote=model.applyRemoteChangesToCanonical(merged.canonicalState,[
  {entityType:"story-template",entityId:"template-1",operation:"upsert",payload:{id:"template-1",name:"Updated on PC"}},
  {entityType:"work-tracking",entityId:"main",operation:"upsert",payload:{programs:[{id:"program-2",executable_path:"C:/paint.exe"}],daily:[]}},
  {entityType:"user-library",entityId:"main",operation:"upsert",payload:{tagLibrary:["remote"],favorites:[],workspace:{homeWidgets:["remote-widget"],settings:{theme:"dark",calendarDesktopWidget:{enabled:false}}}}}
]);
check("canonical accepts and preserves remote desktop-only updates",()=>{assert.equal(remote.storyTemplates[0].name,"Updated on PC");assert.equal(remote.workTrackingSync.programs[0].id,"program-2");dataEqual(remote.homeWidgets,["remote-widget"]);assert.equal(remote.settings.theme,"dark")});
const projectedAfterRemote=model.projectCanonicalState(remote,model.CLIENT_PROFILES.mobileCore);
check("desktop-only remote updates remain hidden from mobile UI",()=>{assert.equal(Object.prototype.hasOwnProperty.call(projectedAfterRemote,"storyTemplates"),false);assert.equal(Object.prototype.hasOwnProperty.call(projectedAfterRemote,"workTrackingSync"),false);dataEqual(projectedAfterRemote.tagLibrary,["remote"])});

const desktopChanges=[
  {entityType:"project",entityId:"project-1",operation:"upsert",payload:{id:"project-1",title:"Desktop update"}},
  {entityType:"story-template",entityId:"template-1",operation:"upsert",payload:{id:"template-1",name:"Desktop only"}},
  {entityType:"work-tracking",entityId:"main",operation:"upsert",payload:{programs:[{id:"program-3"}],daily:[]}},
  {entityType:"user-library",entityId:"main",operation:"upsert",payload:{tagLibrary:["shared"],favorites:[],workspace:{homeWidgets:["private-widget"],settings:{theme:"dark"}}}},
];
const mobileDownload=model.projectChangesForClient(desktopChanges,model.CLIENT_PROFILES.mobileCore);
check("mobile download projects only readable cloud changes",()=>dataEqual(Array.from(mobileDownload,change=>change.entityType),["project","user-library"]));
check("mobile download keeps shared settings but strips desktop workspace",()=>{dataEqual(mobileDownload[1].payload.workspace,{settings:{theme:"dark"}});assert.equal(Object.prototype.hasOwnProperty.call(mobileDownload[1].payload.workspace,"homeWidgets"),false)});
const mobileReplay=model.applyCommitToClientState(mobile,{clientProfile:"desktop",changes:desktopChanges},model.CLIENT_PROFILES.mobileCore);
check("mobile replays a desktop cloud commit through its projection",()=>{assert.equal(mobileReplay.state.projects[0].title,"Desktop update");dataEqual(Array.from(mobileReplay.state.tagLibrary),["shared"]);assert.equal(Object.prototype.hasOwnProperty.call(mobileReplay.state,"storyTemplates"),false);assert.equal(mobileReplay.sourceProfile,"desktop")});
check("legacy commits without a profile remain desktop commits",()=>assert.equal(model.clientProfileForCommit({changes:[]}).id,"desktop"));
check("unknown cloud client profiles are rejected",()=>assert.throws(()=>model.clientProfileForCommit({clientProfile:"future-client",changes:[]}),/sync-client-profile-unsupported/));
check("mobile cloud commits cannot mutate deferred desktop entities",()=>assert.throws(()=>model.applyCommitToCanonical(canonical,{clientProfile:"mobile-core",changes:[{entityType:"story-template",entityId:"template-1",operation:"delete",payload:null}]}),/sync-change-not-writable-by-client/));
check("mobile replay rejects a commit outside its declared writer scope",()=>assert.throws(()=>model.applyCommitToClientState(mobile,{clientProfile:"mobile-core",changes:[{entityType:"story-template",entityId:"template-1",operation:"delete",payload:null}]},model.CLIENT_PROFILES.mobileCore),/sync-change-not-writable-by-client/));
const mobileCommitApplied=model.applyCommitToCanonical(canonical,{clientProfile:"mobile-core",changes:[{entityType:"project",entityId:"project-1",operation:"upsert",payload:{id:"project-1",title:"From mobile"}}]});
check("valid mobile cloud commits preserve desktop-only state",()=>{assert.equal(mobileCommitApplied.projects[0].title,"From mobile");for(const field of ["storyTemplates","workTrackingSync","homeWidgets","utilities","settings","futureDesktopField"])dataEqual(mobileCommitApplied[field],canonical[field],field)});

console.log(`Hamboard mobile canonical sync QA passed (${checks.length} checks).`);
