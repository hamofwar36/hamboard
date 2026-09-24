(function(root){
  "use strict";
  const CHUNK_BYTES=1024*1024,FORMAT="hamboard-json-envelope",ENCODING="utf8-json-chunks-v1";
  const clone=value=>value===undefined?undefined:structuredClone(value);
  const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
  const TREE_ENCODING="json-tree-v1",SYNC_PAGES_FORMAT="hamboard-sync-pages";
  function idMap(items){const map=new Map();for(const item of items){if(!object(item)||typeof item.id!=="string"||!item.id||map.has(item.id))return null;map.set(item.id,item)}return map}
  // Reversible structural delta: identical documents and settings are not duplicated.
  function difference(current,base){
    if(current===base)return null;
    if(Array.isArray(current)&&Array.isArray(base)){
      const left=idMap(current),right=idMap(base);
      if(left&&right){const order=base.map(item=>item.id),edits=[];for(const [id,item] of right){const delta=difference(left.get(id),item);if(delta!==null)edits.push([id,delta])}return !edits.length&&current.length===base.length&&current.every((item,i)=>item.id===order[i])?null:["id-array",order,edits]}
      const edits=[];for(let i=0;i<base.length;i++){const patch=difference(current[i],base[i]);if(patch!==null)edits.push([i,patch])}
      return current.length===base.length&&!edits.length?null:["array",base.length,edits];
    }
    if(object(current)&&object(base)){
      const removed=Object.keys(current).filter(key=>!Object.hasOwn(base,key)),edits=[];
      for(const key of Object.keys(base)){const patch=difference(Object.hasOwn(current,key)?current[key]:undefined,base[key]);if(patch!==null)edits.push([key,patch])}
      return !removed.length&&!edits.length?null:["object",removed,edits];
    }
    return ["set",base];
  }
  function applyDifference(current,patch){
    const apply=(target,delta)=>{
      if(delta===null)return target;
      if(!Array.isArray(delta))throw new Error("backup-baseline-delta-invalid");
      if(delta[0]==="set"&&delta.length===2)return clone(delta[1]);
      if(delta[0]==="id-array"&&delta.length===3&&Array.isArray(target)&&Array.isArray(delta[1])&&Array.isArray(delta[2])){
        const items=idMap(target),order=delta[1],ids=new Set(order),edited=new Set();if(!items||ids.size!==order.length||order.some(id=>typeof id!=="string"||!id))throw new Error("backup-id-delta-invalid");
        for(const row of delta[2]){if(!Array.isArray(row)||row.length!==2||!ids.has(row[0])||edited.has(row[0]))throw new Error("backup-id-delta-invalid");edited.add(row[0]);const item=apply(items.get(row[0]),row[1]);if(!object(item)||item.id!==row[0])throw new Error("backup-id-delta-invalid");items.set(row[0],item)}
        return order.map(id=>{if(!items.has(id))throw new Error("backup-id-delta-missing");return items.get(id)});
      }
      if(delta[0]==="array"&&delta.length===3&&Array.isArray(target)&&Number.isSafeInteger(delta[1])&&delta[1]>=0&&Array.isArray(delta[2])){
        target.length=delta[1];const seen=new Set();for(const row of delta[2]){if(!Array.isArray(row)||row.length!==2||!Number.isSafeInteger(row[0])||row[0]<0||row[0]>=target.length||seen.has(row[0]))throw new Error("backup-baseline-delta-invalid");seen.add(row[0]);target[row[0]]=apply(target[row[0]],row[1])}return target;
      }
      if(delta[0]==="object"&&delta.length===3&&object(target)&&Array.isArray(delta[1])&&Array.isArray(delta[2])){
        for(const key of delta[1]){if(typeof key!=="string")throw new Error("backup-baseline-delta-invalid");delete target[key]}
        const seen=new Set();for(const row of delta[2]){if(!Array.isArray(row)||row.length!==2||typeof row[0]!=="string"||seen.has(row[0]))throw new Error("backup-baseline-delta-invalid");seen.add(row[0]);Object.defineProperty(target,row[0],{value:apply(Object.hasOwn(target,row[0])?target[row[0]]:undefined,row[1]),writable:true,enumerable:true,configurable:true})}return target;
      }
      throw new Error("backup-baseline-delta-invalid");
    };
    return apply(clone(current),patch);
  }
  function packSyncContext(state,context){return context?.baseState?{baseRevision:String(context.baseRevision||""),baseEncoding:"state-delta-v2",baseStateDelta:difference(state,context.baseState)}:null}
  function unpackSyncContext(state,context){
    if(!context)return null;
    if(context.baseEncoding!==undefined){if(!["state-delta-v1","state-delta-v2"].includes(context.baseEncoding)||!Object.hasOwn(context,"baseStateDelta"))throw new Error("backup-baseline-encoding-invalid");const baseState=applyDifference(state,context.baseStateDelta);if(!object(baseState)||baseState.schemaVersion!==1)throw new Error("backup-baseline-schema-invalid");return {baseRevision:String(context.baseRevision||""),baseState}}
    return object(context.baseState)?{baseRevision:String(context.baseRevision||""),baseState:clone(context.baseState)}:null;
  }
  function backupSummary(manifest){return {format:"hamboard-cloud-backup",formatVersion:manifest.formatVersion,backupId:manifest.backupId,complete:manifest.complete===true,createdAt:manifest.createdAt,stateSchemaVersion:manifest.stateSchemaVersion,imagePolicy:manifest.imagePolicy,missingAssetCount:manifest.missingAssetCount??manifest.missingAssets?.length??0,assetCount:manifest.assetCount??manifest.assets?.length??0,...(manifest.formatVersion<3?{objects:(manifest.objects||[]).map(item=>({objectKey:item.objectKey}))}:{})}}
  function packUserState(state,model){
    model.assertCloudClassification(state);
    const cloudUserData=model.projectCloudUserData(state,model.CLIENT_PROFILES.desktop),base=model.applyCloudUserData({},cloudUserData,model.CLIENT_PROFILES.desktop);
    return {cloudUserDataVersion:model.CLOUD_USER_DATA_VERSION,cloudUserData,deviceStateEncoding:"cloud-state-delta-v2",deviceStateDelta:difference(base,state)};
  }
  function unpackUserState(backup,model){
    if(backup.deviceStateEncoding!==undefined){
      if(!["cloud-state-delta-v1","cloud-state-delta-v2"].includes(backup.deviceStateEncoding)||backup.cloudUserDataVersion!==model.CLOUD_USER_DATA_VERSION||!object(backup.cloudUserData)||!Object.hasOwn(backup,"deviceStateDelta"))throw new Error("backup-device-state-invalid");
      return applyDifference(model.applyCloudUserData({},backup.cloudUserData,model.CLIENT_PROFILES.desktop),backup.deviceStateDelta);
    }
    return backup.cloudUserData?model.applyCloudUserData(backup.state||{},backup.cloudUserData,model.CLIENT_PROFILES.desktop):clone(backup.state);
  }
  // Serialize one record at a time. A single unusually large record is its own page.
  async function* jsonPages(records,target=CHUNK_BYTES){
    let parts=[],bytes=2;
    for await(const record of records){const text=JSON.stringify(record),size=new TextEncoder().encode(text).byteLength;
      if(parts.length&&bytes+size+1>target){yield "["+parts.join(",")+"]";parts=[];bytes=2}
      parts.push(text);bytes+=size+1;
    }
    if(parts.length)yield "["+parts.join(",")+"]";
  }
  // Tree tokens avoid serializing an entire entity/delta, including a very large string.
  function* treeRecords(value){
    if(typeof value==="string"){yield ["string"];for(let i=0;i<value.length;i+=32768)yield ["text",value.slice(i,i+32768)];yield ["end"];return}
    if(Array.isArray(value)){yield ["array"];for(const item of value)yield* treeRecords(item===undefined?null:item);yield ["end"];return}
    if(object(value)){yield ["object"];for(const key of Object.keys(value)){if(value[key]===undefined)continue;yield ["key",key];yield* treeRecords(value[key])}yield ["end"];return}
    if(value!==null&&typeof value!=="boolean"&&typeof value!=="number")throw new Error("json-tree-value-invalid");yield ["value",typeof value==="number"&&!Number.isFinite(value)?null:value];
  }
  function treeDecoder(){
    const stack=[];let result,complete=false;
    const add=value=>{if(!stack.length){if(complete)throw new Error("json-tree-extra-root");result=value;complete=true;return}const parent=stack[stack.length-1];if(parent.type==="array")parent.value.push(value);else if(parent.type==="object"&&parent.key!==null){Object.defineProperty(parent.value,parent.key,{value,writable:true,enumerable:true,configurable:true});parent.key=null}else throw new Error("json-tree-order-invalid")};
    return {push(row){if(!Array.isArray(row))throw new Error("json-tree-token-invalid");const [type,value]=row,parent=stack[stack.length-1];
      if(type==="key"&&row.length===2&&typeof value==="string"&&parent?.type==="object"&&parent.key===null&&!Object.hasOwn(parent.value,value)){parent.key=value;return}
      if(type==="text"&&row.length===2&&typeof value==="string"&&parent?.type==="string"){parent.value.push(value);return}
      if(type==="end"&&row.length===1&&parent){if(parent.type==="object"&&parent.key!==null)throw new Error("json-tree-key-without-value");stack.pop();add(parent.type==="string"?parent.value.join(""):parent.value);return}
      if(parent?.type==="string")throw new Error("json-tree-string-invalid");
      if(["object","array","string"].includes(type)&&row.length===1){if(complete&&!stack.length||parent?.type==="object"&&parent.key===null)throw new Error("json-tree-order-invalid");stack.push({type,key:null,value:type==="object"?{}:[]});return}
      if(type==="value"&&row.length===2&&(value===null||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value))){add(value);return}
      throw new Error("json-tree-token-invalid");
    },finish(){if(stack.length||!complete)throw new Error("json-tree-incomplete");return result}};
  }
  function validatePageReferences(pages){if(!Array.isArray(pages)||!pages.length)throw new Error("sync-pages-invalid");for(const page of pages)if(!Number.isSafeInteger(page.byteSize)||page.byteSize<=0||!/^[0-9a-f]{64}$/.test(page.contentSha256||"")||page.objectKey!==`objects/content-v1/${page.contentSha256}`)throw new Error("sync-page-invalid");return pages}
  async function decodeTreePages(pages,readPage){const decoder=treeDecoder();for(const page of pages){const rows=await readPage(page);if(!Array.isArray(rows))throw new Error("json-tree-page-invalid");for(const row of rows)decoder.push(row)}return decoder.finish()}
  function validateSections(sections){
    if(!Array.isArray(sections))throw new Error("backup-sections-invalid");
    const allowed=new Set(["cloudUserData","deviceStateDelta","syncContext","versions","workTracking","assets","objects","missingAssets"]),seen=new Set();
    for(const section of sections){if(!allowed.has(section?.name)||seen.has(section.name)||!Array.isArray(section.pages))throw new Error("backup-section-invalid");seen.add(section.name);if(section.encoding!==undefined&&section.encoding!==TREE_ENCODING)throw new Error("backup-section-encoding-invalid");
      for(const page of section.pages)if(!Number.isSafeInteger(page.byteSize)||page.byteSize<=0||!/^[0-9a-f]{64}$/.test(page.contentSha256||"")||page.objectKey!==`objects/content-v1/${page.contentSha256}`)throw new Error("backup-page-invalid");
    }
    for(const name of ["cloudUserData","deviceStateDelta","syncContext","versions","workTracking","assets","objects","missingAssets"])if(!seen.has(name))throw new Error("backup-section-missing");
    return sections;
  }
  async function hydrateSections(root,readPage,{skipSections=[]}={}){
    const result={...root};delete result.sections;
    for(const section of validateSections(root.sections)){
      if(skipSections.includes(section.name)){result[section.name]=[];continue}
      if(section.encoding===TREE_ENCODING){result[section.name]=await decodeTreePages(section.pages,readPage);continue}
      const rows=[];for(const page of section.pages){const values=await readPage(page);if(!Array.isArray(values))throw new Error("backup-page-invalid");for(const value of values)rows.push(value)}
      if(["cloudUserData","workTracking"].includes(section.name)){
        const value={};for(const row of rows){if(!Array.isArray(row)||row.length!==3||typeof row[0]!=="string"||!["value","item","array"].includes(row[1]))throw new Error("backup-field-invalid");const [key,kind,data]=row;
          if(kind==="item"){if(!Object.hasOwn(value,key)||!Array.isArray(value[key]))throw new Error("backup-field-order-invalid");value[key].push(data)}
          else{if(Object.hasOwn(value,key))throw new Error("backup-field-duplicate");Object.defineProperty(value,key,{value:kind==="array"?[]:data,enumerable:true,writable:true,configurable:true})}}
        result[section.name]=value;
      }else if(["deviceStateDelta","syncContext"].includes(section.name)){if(rows.length!==1)throw new Error("backup-scalar-invalid");result[section.name]=rows[0]}
      else result[section.name]=rows;
    }
    return result;
  }
  function* fieldRecords(value){for(const [key,data] of Object.entries(value)){if(Array.isArray(data)){yield [key,"array",null];for(const item of data)yield [key,"item",item]}else yield [key,"value",data]}}
  function validatePayload(payload){
    if(payload?.encoding!==ENCODING||!Number.isSafeInteger(payload.byteSize)||payload.byteSize<=0||!Array.isArray(payload.chunks)||payload.chunks.length!==Math.ceil(payload.byteSize/CHUNK_BYTES)||!/^[0-9a-f]{64}$/.test(payload.contentSha256||""))throw new Error("cloud-payload-invalid");
    let total=0;for(let i=0;i<payload.chunks.length;i++){const chunk=payload.chunks[i],expected=Math.min(CHUNK_BYTES,payload.byteSize-total);if(chunk?.byteSize!==expected||!/^[0-9a-f]{64}$/.test(chunk.contentSha256||"")||chunk.objectKey!==`objects/content-v1/${chunk.contentSha256}`)throw new Error("cloud-payload-chunk-invalid");total+=chunk.byteSize}return payload;
  }
  async function parseJson(text){
    // Parsing a large snapshot runs outside the editor event loop when available.
    if(text.length<CHUNK_BYTES||typeof root.Worker!=="function")return JSON.parse(text);
    const url=URL.createObjectURL(new Blob(['onmessage=e=>{try{postMessage({value:JSON.parse(e.data)})}catch(error){postMessage({error:String(error.message)})}}'],{type:"text/javascript"}));
    let worker;try{worker=new root.Worker(url);return await new Promise((resolve,reject)=>{worker.onmessage=e=>e.data.error?reject(new Error(e.data.error)):resolve(e.data.value);worker.onerror=()=>reject(new Error("cloud-json-worker-failed"));worker.postMessage(text)})}finally{worker?.terminate();URL.revokeObjectURL(url)}
  }
  async function stringifyJson(value){
    if(typeof root.Worker!=="function")return JSON.stringify(value);
    const url=URL.createObjectURL(new Blob(['onmessage=e=>{try{postMessage({value:JSON.stringify(e.data)})}catch(error){postMessage({error:String(error.message)})}}'],{type:"text/javascript"}));
    let worker;try{worker=new root.Worker(url);return await new Promise((resolve,reject)=>{worker.onmessage=e=>e.data.error?reject(new Error(e.data.error)):resolve(e.data.value);worker.onerror=()=>reject(new Error("cloud-json-worker-failed"));worker.postMessage(value)})}finally{worker?.terminate();URL.revokeObjectURL(url)}
  }
  function createTransport({putRaw,putChunk,readBytes,sha256,pin=async()=>{},unpin=async()=>{},guard=async()=>{}}){
    async function upload(request){
      if(request.kind==="sync"&&request.source==="value")return uploadValue(request);
      if(!["manifest","sync"].includes(request.kind)||request.source!=="text")return putRaw(request);
      const blob=new Blob([request.content],{type:"application/json"});
      if(request.kind==="manifest"&&request.summary?.formatVersion===3){const result=await putRaw(request);await unpin(request.objectKey);return result}
      if((request.kind!=="manifest"&&blob.size<=CHUNK_BYTES)||(request.kind==="manifest"&&request.summary?.formatVersion===1))return putRaw(request);
      if(await sha256(blob)!==request.contentSha256||blob.size!==request.byteSize)throw new Error("cloud-payload-source-mismatch");
      const chunks=[];
      for(let offset=0;offset<blob.size;offset+=CHUNK_BYTES){const part=blob.slice(offset,offset+CHUNK_BYTES),contentSha256=await sha256(part),chunk={objectKey:`objects/content-v1/${contentSha256}`,contentSha256,byteSize:part.size};await pin(request.objectKey,chunk.objectKey);await putChunk(part,chunk);chunks.push(chunk)}
      const payload={encoding:ENCODING,byteSize:blob.size,contentSha256:request.contentSha256,chunks};
      const envelope={format:FORMAT,formatVersion:1,objectKind:request.kind,payload};
      if(request.kind==="manifest"){if(!request.summary)throw new Error("cloud-backup-summary-required");envelope.summary=request.summary}
      const content=JSON.stringify(envelope),contentBlob=new Blob([content]),contentSha256=await sha256(contentBlob);
      // The discoverable root is the commit point; no partial payload is published.
      const result=await putRaw({...request,content,contentSha256,byteSize:contentBlob.size});
      await unpin(request.objectKey);return {...result,transportPayload:payload};
    }
    async function uploadValue(request){
      if(!["hamboard-sync-checkpoint","hamboard-sync-commit"].includes(request.value?.format))throw new Error("sync-page-source-invalid");
      const pages=[];
      for await(const content of jsonPages(treeRecords(request.value))){const blob=new Blob([content]),contentSha256=await sha256(blob),page={objectKey:`objects/content-v1/${contentSha256}`,contentSha256,byteSize:blob.size};await pin(request.objectKey,page.objectKey);await putChunk(blob,page);pages.push(page)}
      const envelope={format:SYNC_PAGES_FORMAT,formatVersion:1,encoding:TREE_ENCODING,pages},content=JSON.stringify(envelope),blob=new Blob([content]),contentSha256=await sha256(blob),{value,...metadata}=request;
      const result=await putRaw({...metadata,source:"text",content,contentSha256,byteSize:blob.size});await unpin(request.objectKey);return result;
    }
    async function downloadPayload(raw,onProgress=()=>{}){
      const payload=validatePayload(raw),parts=[];await guard(payload.byteSize);let received=0;
      for(const chunk of payload.chunks){const bytes=await readBytes(chunk);if(bytes.byteLength!==chunk.byteSize||await sha256(new Blob([bytes]))!==chunk.contentSha256)throw new Error("cloud-payload-chunk-integrity-mismatch");parts.push(new Blob([bytes]));received+=bytes.byteLength;onProgress(received/payload.byteSize)}
      const blob=new Blob(parts);parts.length=0;
      if(blob.size!==payload.byteSize||await sha256(blob)!==payload.contentSha256)throw new Error("cloud-payload-integrity-mismatch");
      return parseJson(await blob.text());
    }
    async function download(request,onProgress=()=>{}){
      const bytes=await readBytes(request);if(bytes.byteLength!==request.byteSize||await sha256(new Blob([bytes]))!==request.contentSha256)throw new Error("cloud-json-integrity-mismatch");
      const value=await parseJson(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
      if(value?.format===SYNC_PAGES_FORMAT){if(value.formatVersion!==1||value.encoding!==TREE_ENCODING)throw new Error("sync-pages-version-invalid");const pages=validatePageReferences(value.pages);let received=0;const result=await decodeTreePages(pages,async page=>{const bytes=await readBytes(page);if(bytes.byteLength!==page.byteSize||await sha256(new Blob([bytes]))!==page.contentSha256)throw new Error("sync-page-integrity-mismatch");onProgress(++received/pages.length);return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes))});if(!["hamboard-sync-checkpoint","hamboard-sync-commit"].includes(result?.format))throw new Error("sync-page-content-invalid");return result}
      if(value?.format!==FORMAT){onProgress(1);return value;}
      if(value.formatVersion!==1||!["manifest","sync"].includes(value.objectKind))throw new Error("cloud-envelope-invalid");
      return downloadPayload(value.payload,onProgress);
    }
    return Object.freeze({upload,download,downloadPayload});
  }
  root.HamboardCloudPayload=Object.freeze({CHUNK_BYTES,FORMAT,ENCODING,TREE_ENCODING,SYNC_PAGES_FORMAT,treeRecords,treeDecoder,decodeTreePages,validatePageReferences,difference,applyDifference,packUserState,unpackUserState,jsonPages,fieldRecords,hydrateSections,validateSections,packSyncContext,unpackSyncContext,backupSummary,validatePayload,parseJson,stringifyJson,createTransport});
})(typeof globalThis!=="undefined"?globalThis:this);
