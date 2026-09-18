import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

const root=new URL("../",import.meta.url),html=await readFile(new URL("../mobile/web/mobile/index.html",root),"utf8"),syncSource=await readFile(new URL("web/shared/sync-state-model.js",root),"utf8"),repositorySource=await readFile(new URL("web/shared/project-repository.js",root),"utf8"),appSource=await readFile(new URL("../mobile/web/mobile/mobile-app.js",root),"utf8"),css=await readFile(new URL("../mobile/web/mobile/mobile.css",root),"utf8"),dom=new JSDOM(html,{url:"http://localhost/mobile/",runScripts:"outside-only"}),{window}=dom;
window.structuredClone=structuredClone;window.scrollTo=()=>{};window.eval(syncSource);window.eval(repositorySource);
const core=window.HamboardProjectRepository,initial={
  schemaVersion:1,folders:[],mindmaps:[],notes:[],characterRepository:[],characterFieldTemplates:[],trash:[],calendarEvents:[],quickMemos:[],tagLibrary:[],favorites:[],
  projects:[
    {id:"long-1",title:"장편 테스트",subtitle:"두 개의 화",kind:"long",color:"#a9d6ff",episodes:[
      {id:"ep-1",title:"1화",subtitle:"시작",stageDefs:[{id:"stage-1",name:"도입",hint:"첫 장면",color:"#bde7c4"}],stages:{"stage-1":[{id:"block-1",type:"detail",title:"첫 블록",summary:"첫 내용",notes:"메모",completed:true,tags:[],children:[]}] }},
      {id:"ep-2",title:"2화",subtitle:"대화",stageDefs:[{id:"stage-2",name:"전개",hint:"",color:"#cbb8ff"}],stages:{"stage-2":[{id:"block-2",type:"script",title:"대화 블록",summary:"",notes:"",completed:false,tags:[],children:[],scriptBlocks:[{id:"line-1",type:"dialogue",speaker:"신드리",text:"테스트 대사"}]}]}}
    ]},
    {id:"short-1",title:"단편 메모",subtitle:"짧은 작품",kind:"short",color:"#ffb8ae",stageDefs:[],stages:{}}
  ]
};
window.HamboardProjectRepository=Object.freeze({...core,createIndexedDbStateStorage:()=>core.createMemoryStateStorage(initial)});window.eval(appSource);await new Promise(resolve=>setTimeout(resolve,0));
const checks=[],check=(name,run)=>{run();checks.push(name)};
check("mobile list renders projects from repository",()=>assert.equal(window.document.querySelectorAll(".project-card").length,2));
check("mobile list reports project count",()=>assert.match(window.document.querySelector("#projectCount").textContent,/2개 작품/));
window.document.querySelector('[data-project-id="long-1"]').click();
check("mobile reader opens a long project",()=>{assert.equal(window.document.querySelector("#readerTitle").textContent,"장편 테스트");assert.equal(window.document.querySelectorAll(".episode-button").length,2);assert.match(window.document.querySelector("#projectContent").textContent,/첫 내용/)});
window.document.querySelectorAll(".episode-button")[1].click();
check("mobile reader switches episodes and renders scripts",()=>{const text=window.document.querySelector("#projectContent").textContent;assert.match(text,/대화 블록/);assert.match(text,/신드리/);assert.match(text,/테스트 대사/)});
window.HamboardMobileApp.closeProject();const search=window.document.querySelector("#projectSearch");search.value="단편";search.dispatchEvent(new window.Event("input",{bubbles:true}));
check("mobile project search filters the list",()=>{assert.equal(window.document.querySelectorAll(".project-card").length,1);assert.match(window.document.querySelector(".project-card").textContent,/단편 메모/)});
await window.HamboardMobileApp.importCanonicalState({...initial,projects:[{id:"imported",title:"PC에서 불러온 작품",kind:"short",stageDefs:[],stages:{}}],storyTemplates:[{id:"pc-only"}],utilities:{countdowns:[{id:"timer"}]}});
check("canonical import stores only the mobile projection",()=>{const snapshot=window.HamboardMobileApp.snapshot();assert.equal(snapshot.projects[0].title,"PC에서 불러온 작품");assert.equal(Object.prototype.hasOwnProperty.call(snapshot,"storyTemplates"),false);assert.equal(Object.prototype.hasOwnProperty.call(snapshot,"utilities"),false)});
check("mobile markup loads only shared data modules and mobile UI",()=>{assert.match(html,/shared\/project-repository\.js/);assert.doesNotMatch(html,/utility|widget/i)});
check("mobile CSS includes touch layout and dark appearance",()=>{assert.match(css,/min-height:48px|height:48px/);assert.match(css,/prefers-color-scheme:dark/)});
dom.window.close();console.log(`Hamboard mobile project app QA passed (${checks.length} checks).`);
