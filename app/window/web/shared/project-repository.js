(function(root){
  "use strict";

  function clone(value){
    if(value===undefined)return undefined;
    if(typeof structuredClone==="function")return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function validState(value){return value&&typeof value==="object"&&!Array.isArray(value)}
  function normalizeState(value){const next=validState(value)?clone(value):{};next.schemaVersion=Math.max(1,Number(next.schemaVersion)||1);next.projects=Array.isArray(next.projects)?next.projects:[];return next}
  function normalizeProjectValue(value,normalizer){if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("project-repository-project-invalid");const next=normalizer?normalizer(clone(value)):clone(value),id=String(next?.id||"");if(!id)throw new Error("project-repository-project-id-missing");next.id=id;return next}
  function createStateStorageAdapter({read,write}){if(typeof read!=="function"||typeof write!=="function")throw new Error("project-repository-storage-invalid");return Object.freeze({read,write})}
  function createMemoryStateStorage(initialState={schemaVersion:1,projects:[]}){let value=normalizeState(initialState),writes=0;return Object.freeze({async read(){return clone(value)},async write(next){value=normalizeState(next);writes++;return {writes}},snapshot(){return clone(value)},writeCount(){return writes}})}
  function createIndexedDbStateStorage({indexedDB=root.indexedDB,databaseName="hamboard-mobile",storeName="state",stateKey="mobile-core"}={}){
    let databasePromise=null;
    const database=()=>{if(!indexedDB?.open)throw new Error("project-repository-indexeddb-unavailable");if(databasePromise)return databasePromise;databasePromise=new Promise((resolve,reject)=>{const request=indexedDB.open(String(databaseName),1);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(String(storeName)))db.createObjectStore(String(storeName))};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error("project-repository-indexeddb-open-failed"));request.onblocked=()=>reject(new Error("project-repository-indexeddb-blocked"))}).catch(error=>{databasePromise=null;throw error});return databasePromise};
    const transaction=(mode,run)=>database().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction(String(storeName),mode),store=tx.objectStore(String(storeName));let result;try{result=run(store)}catch(error){reject(error);return}tx.oncomplete=()=>resolve(result?.result);tx.onerror=()=>reject(tx.error||result?.error||new Error("project-repository-indexeddb-transaction-failed"));tx.onabort=()=>reject(tx.error||new Error("project-repository-indexeddb-transaction-aborted"))}));
    return Object.freeze({async read(){const value=await transaction("readonly",store=>store.get(String(stateKey)));return normalizeState(value)},async write(next){const value=normalizeState(next);await transaction("readwrite",store=>store.put(value,String(stateKey)));return {stored:true}}})
  }
  function createProjectRepository({storage,syncModel=null,clientProfile="mobile-core",normalizeProject=null}={}){
    if(!storage||typeof storage.read!=="function"||typeof storage.write!=="function")throw new Error("project-repository-storage-invalid");
    let current=null,baseline=null;
    const ensure=()=>{if(!current)throw new Error("project-repository-not-loaded")};
    const adopt=(value,{markBaseline=false}={})=>{current=normalizeState(value);if(markBaseline||!baseline)baseline=clone(current);return clone(current.projects)};
    const list=()=>{ensure();return clone(current.projects)};
    const get=id=>{ensure();const found=current.projects.find(project=>String(project?.id||"")===String(id||""));return found?clone(found):null};
    const persist=async options=>storage.write(clone(current),options||{});
    const save=async(project,options={})=>{ensure();const next=normalizeProjectValue(project,normalizeProject),index=current.projects.findIndex(item=>String(item?.id||"")===next.id);if(index>=0)current.projects[index]=next;else current.projects.push(next);await persist(options);return clone(next)};
    const remove=async(id,options={})=>{ensure();const key=String(id||""),index=current.projects.findIndex(project=>String(project?.id||"")===key);if(index<0)return false;current.projects.splice(index,1);await persist(options);return true};
    const replaceState=async(value,{markBaseline=false,...options}={})=>{current=normalizeState(value);await persist(options);if(markBaseline||!baseline)baseline=clone(current);return clone(current.projects)};
    const applyCommit=async(commit,{markBaseline=false,...options}={})=>{ensure();if(!syncModel?.applyCommitToClientState)throw new Error("project-repository-sync-model-unavailable");const result=syncModel.applyCommitToClientState(current,commit,clientProfile);current=normalizeState(result.state);await persist(options);if(markBaseline)baseline=clone(current);return {...result,state:clone(current),changes:clone(result.changes)}};
    const changes=()=>{ensure();const before=new Map((baseline?.projects||[]).map(project=>[String(project?.id||""),project]).filter(([id])=>id)),after=new Map(current.projects.map(project=>[String(project?.id||""),project]).filter(([id])=>id)),out=[];for(const id of [...new Set([...before.keys(),...after.keys()])].sort()){const left=before.get(id),right=after.get(id);if(JSON.stringify(left)===JSON.stringify(right))continue;out.push({entityType:"project",entityId:id,operation:right?"upsert":"delete",payload:right?clone(right):null})}if(syncModel?.validateClientChanges)syncModel.validateClientChanges(out,clientProfile);return out};
    const markSynced=value=>{if(value!==undefined)current=normalizeState(value);ensure();baseline=clone(current);return clone(current.projects)};
    return Object.freeze({async load(options={}){return adopt(await storage.read(),{markBaseline:options.markBaseline!==false})},adopt,list,get,save,remove,replaceState,applyCommit,changes,markSynced,snapshot(){ensure();return clone(current)}})
  }

  root.HamboardProjectRepository=Object.freeze({createStateStorageAdapter,createMemoryStateStorage,createIndexedDbStateStorage,createProjectRepository});
})(typeof globalThis!=="undefined"?globalThis:this);
