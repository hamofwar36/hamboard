import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const root=new URL("../",import.meta.url),syncSource=await readFile(new URL("web/shared/sync-state-model.js",root),"utf8"),repositorySource=await readFile(new URL("web/shared/project-repository.js",root),"utf8"),html=await readFile(new URL("web/index.html",root),"utf8"),context=vm.createContext({structuredClone});
vm.runInContext(syncSource,context,{filename:"sync-state-model.js"});
vm.runInContext(repositorySource,context,{filename:"project-repository.js"});
const core=context.HamboardProjectRepository,syncModel=context.HamboardSyncStateModel,checks=[];
const check=async(name,run)=>{await run();checks.push(name)};

const canonical={schemaVersion:1,projects:[{id:"project-1",title:"Before",parts:[{id:"part-1",text:"Keep"}]}],notes:[{id:"note-1",title:"Untouched"}],settings:{theme:"dark",desktopOnly:true},utilities:{countdowns:[{id:"timer-1"}]},futureDesktopField:{keep:true}};
const storage=core.createMemoryStateStorage(canonical),repository=core.createProjectRepository({storage,syncModel,clientProfile:"desktop"});
await repository.load();
await check("project repository lists stored projects",()=>assert.equal(repository.list()[0].title,"Before"));
await check("project repository reads defensive copies",()=>{const value=repository.get("project-1");value.title="Mutated outside";assert.equal(repository.get("project-1").title,"Before")});
await repository.save({id:"project-1",title:"After",parts:[{id:"part-1",text:"Edited"}]});
await check("desktop adapter save updates the requested project",()=>assert.equal(storage.snapshot().projects[0].title,"After"));
await check("desktop adapter save preserves unrelated canonical state",()=>{const saved=storage.snapshot();assert.equal(saved.notes[0].title,"Untouched");assert.equal(saved.settings.desktopOnly,true);assert.equal(saved.utilities.countdowns[0].id,"timer-1");assert.equal(saved.futureDesktopField.keep,true)});
await check("project repository emits one project upsert",()=>{const changes=Array.from(repository.changes());assert.equal(changes.length,1);assert.equal(changes[0].entityType,"project");assert.equal(changes[0].entityId,"project-1");assert.equal(changes[0].operation,"upsert");assert.equal(changes[0].payload.title,"After")});
repository.markSynced();
await check("markSynced advances the local project baseline",()=>assert.equal(repository.changes().length,0));
await repository.remove("project-1");
await check("project removal emits a delete without touching other data",()=>{const changes=Array.from(repository.changes());assert.equal(changes.length,1);assert.equal(changes[0].operation,"delete");assert.equal(changes[0].payload,null);assert.equal(storage.snapshot().settings.theme,"dark")});
await check("project repository rejects records without IDs",async()=>await assert.rejects(repository.save({title:"Missing ID"}),/project-repository-project-id-missing/));

const mobileStorage=core.createMemoryStateStorage({schemaVersion:1,projects:[{id:"mobile-project",title:"Mobile"}],folders:[],notes:[],mindmaps:[],calendarEvents:[],characterRepository:[],characterFieldTemplates:[],trash:[],quickMemos:[],tagLibrary:[],favorites:[]}),mobileRepository=core.createProjectRepository({storage:mobileStorage,syncModel,clientProfile:"mobile-core"});
await mobileRepository.load();await mobileRepository.save({id:"mobile-project",title:"Edited on mobile"});
await check("mobile repository creates mobile-core compatible changes",()=>assert.equal(mobileRepository.changes()[0].payload.title,"Edited on mobile"));
await mobileRepository.applyCommit({clientProfile:"desktop",changes:[{entityType:"project",entityId:"mobile-project",operation:"upsert",payload:{id:"mobile-project",title:"Updated from cloud"}},{entityType:"story-template",entityId:"pc-only",operation:"upsert",payload:{id:"pc-only",name:"PC"}}]});
await check("mobile repository applies cloud commits through mobile projection",()=>{assert.equal(mobileRepository.get("mobile-project").title,"Updated from cloud");assert.equal(Object.prototype.hasOwnProperty.call(mobileRepository.snapshot(),"storyTemplates"),false)});
await mobileRepository.replaceState({schemaVersion:1,projects:[{id:"replacement",title:"Replacement"}],futureDesktopField:{omit:"outside projection"}},{markBaseline:true});
await check("mobile repository can replace its projected baseline",()=>{assert.equal(mobileRepository.list()[0].id,"replacement");assert.equal(mobileRepository.changes().length,0)});
await check("IndexedDB storage fails explicitly when unavailable",async()=>await assert.rejects(core.createIndexedDbStateStorage({indexedDB:null}).read(),/project-repository-indexeddb-unavailable/));

const integrationChecks={
  "desktop loads the shared project repository":"<script src=\"./shared/project-repository.js\"></script>",
  "desktop project storage delegates to StateRepository":"const DesktopProjectStateStorage=ProjectRepositoryCore.createStateStorageAdapter",
  "desktop writes refresh the project repository view":"syncProjectRepositoryView(value)",
  "mobile project repository uses IndexedDB":"ProjectRepositoryCore.createIndexedDbStateStorage(options)",
  "mobile project repository writes as mobile-core":"clientProfile:\"mobile-core\"",
};
for(const [name,token] of Object.entries(integrationChecks))await check(name,()=>assert.ok(html.includes(token),token));

console.log(`Hamboard project repository QA passed (${checks.length} checks).`);
