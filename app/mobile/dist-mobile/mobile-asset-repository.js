(function(root){
  "use strict";

  function createIndexedDbAssetRepository({indexedDB=root.indexedDB,databaseName="hamboard-mobile-assets",storeName="assets"}={}){
    let databasePromise=null;
    const database=()=>{
      if(!indexedDB?.open)throw new Error("mobile-asset-indexeddb-unavailable");
      if(databasePromise)return databasePromise;
      databasePromise=new Promise((resolve,reject)=>{
        const request=indexedDB.open(String(databaseName),1);
        request.onupgradeneeded=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains(String(storeName)))db.createObjectStore(String(storeName),{keyPath:"id"})
        };
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error||new Error("mobile-asset-indexeddb-open-failed"));
        request.onblocked=()=>reject(new Error("mobile-asset-indexeddb-blocked"))
      }).catch(error=>{databasePromise=null;throw error});
      return databasePromise
    };
    const normalize=record=>{
      const id=String(record?.id||"");
      if(!id)throw new Error("mobile-asset-id-missing");
      if(!(record?.blob instanceof Blob))throw new Error("mobile-asset-blob-invalid");
      return {
        id,
        ownerId:String(record.ownerId||""),
        blob:record.blob,
        mimeType:String(record.mimeType||record.blob.type||"application/octet-stream"),
        byteSize:Math.max(0,Number(record.byteSize)||Number(record.blob.size)||0),
        sourceSha256:String(record.sourceSha256||""),
        contentSha256:String(record.contentSha256||""),
        quality:String(record.quality||""),
        width:Math.max(0,Math.floor(Number(record.width)||0)),
        height:Math.max(0,Math.floor(Number(record.height)||0)),
        // Images added on this phone wait here as "pending" until the uploader has put them on Drive.
        uploadState:["pending","uploaded","verified"].includes(record.uploadState)?record.uploadState:"",
        uploadedAtMs:Math.max(0,Number(record.uploadedAtMs)||0),
        verifiedAtMs:Math.max(0,Number(record.verifiedAtMs)||0),
        committedAtMs:Math.max(0,Number(record.committedAtMs)||0),
        thumbnail:record.thumbnail?.blob instanceof Blob?{blob:record.thumbnail.blob,mimeType:String(record.thumbnail.mimeType||record.thumbnail.blob.type||"application/octet-stream"),byteSize:Math.max(0,Number(record.thumbnail.byteSize)||Number(record.thumbnail.blob.size)||0),contentSha256:String(record.thumbnail.contentSha256||"")}:null,
        descriptor:record.descriptor&&typeof record.descriptor==="object"?record.descriptor:null,
        updatedAtMs:Date.now()
      }
    };
    const withStore=(mode,run)=>database().then(db=>new Promise((resolve,reject)=>{
      const tx=db.transaction(String(storeName),mode),store=tx.objectStore(String(storeName));
      let value;
      try{value=run(store,tx)}catch(error){reject(error);return}
      tx.oncomplete=()=>resolve(value);
      tx.onerror=()=>reject(tx.error||new Error("mobile-asset-indexeddb-transaction-failed"));
      tx.onabort=()=>reject(tx.error||new Error("mobile-asset-indexeddb-transaction-aborted"))
    }));
    return Object.freeze({
      async get(id){
        const key=String(id||"");
        if(!key)return null;
        const db=await database();
        return new Promise((resolve,reject)=>{
          const tx=db.transaction(String(storeName),"readonly"),request=tx.objectStore(String(storeName)).get(key);
          request.onsuccess=()=>resolve(request.result||null);
          request.onerror=()=>reject(request.error||new Error("mobile-asset-read-failed"))
        })
      },
      async put(record){
        const value=normalize(record);
        await withStore("readwrite",store=>store.put(value));
        return value
      },
      async putMany(records=[]){
        const values=records.map(normalize);
        if(!values.length)return {stored:0};
        await withStore("readwrite",store=>{for(const value of values)store.put(value)});
        return {stored:values.length}
      },
      async update(id,patch={}){
        const key=String(id||"");
        if(!key)throw new Error("mobile-asset-id-missing");
        return withStore("readwrite",store=>{
          const request=store.get(key);
          request.onsuccess=()=>{if(request.result)store.put(normalize({...request.result,...patch,id:key}))}
        })
      },
      async listPendingUploads(){
        const db=await database();
        return new Promise((resolve,reject)=>{
          const tx=db.transaction(String(storeName),"readonly"),request=tx.objectStore(String(storeName)).openCursor(),rows=[];
          request.onsuccess=()=>{
            const cursor=request.result;
            if(!cursor)return;
            const state=cursor.value?.uploadState;
            if(state==="pending"||state==="uploaded")rows.push(cursor.value);
            cursor.continue()
          };
          tx.oncomplete=()=>resolve(rows);
          tx.onerror=()=>reject(tx.error||new Error("mobile-asset-pending-list-failed"))
        })
      },
      async missing(ids=[]){
        const keys=[...new Set((ids||[]).map(String).filter(Boolean))];
        if(!keys.length)return [];
        const db=await database();
        return new Promise((resolve,reject)=>{
          const tx=db.transaction(String(storeName),"readonly"),store=tx.objectStore(String(storeName)),missing=[];
          for(const key of keys){
            const request=store.get(key);
            request.onsuccess=()=>{
              const record=request.result;
              if(!record||!(record.blob instanceof Blob)||record.blob.size<1)missing.push(key)
            };
            request.onerror=()=>{try{tx.abort()}catch{}}
          }
          tx.oncomplete=()=>resolve(missing);
          tx.onerror=()=>reject(tx.error||new Error("mobile-asset-missing-check-failed"));
          tx.onabort=()=>reject(tx.error||new Error("mobile-asset-missing-check-aborted"))
        })
      }
    })
  }

  // Image ids a state references, without a DOM so the service worker can use it too.
  // Mirrors the Windows syncStateAssetIds rules for the collections the phone syncs.
  function collectNoteHtmlAssetIds(html,set=new Set()){
    const decode=value=>String(value).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
    for(const match of String(html||"").matchAll(/<img\b[^>]*?\sdata-note-image\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi)){const id=decode(match[1]??match[2]??match[3]??"").trim();if(id)set.add(id)}
    return set
  }
  function collectDocumentAssetIds(type,documentValue,set=new Set()){
    if(!documentValue)return set;
    const add=value=>{const id=String(value||"");if(id)set.add(id)};
    add(documentValue.cardImageAssetId);
    if(type==="project"||type==="note"){
      for(const resource of documentValue.resources||[]){const mime=String(resource?.type||"");if(resource?.inline===true||!mime||mime.startsWith("image/"))add(resource?.id)}
      for(const character of documentValue.characters||[]){add(character?.avatarAssetId);for(const id of character?.imageAssetIds||[])add(id)}
    }
    if(type==="note")collectNoteHtmlAssetIds(documentValue.content,set);
    if(type==="mindmap")for(const node of documentValue.nodes||[])if(node?.type==="image"&&node.assetId)add(node.assetId);
    return set
  }
  function collectTrashAssetIds(item,set=new Set()){
    if(!item)return set;
    const payload=item.payload;
    if(["project","note","mindmap"].includes(item.type))collectDocumentAssetIds(item.type,payload,set);
    else if(item.type==="resource"&&payload?.id)set.add(String(payload.id));
    else if(item.type==="quickMemo")for(const id of payload?.imageAssetIds||[])if(id)set.add(String(id));
    else if(item.type==="character"){if(payload?.avatarAssetId)set.add(String(payload.avatarAssetId));for(const id of payload?.imageAssetIds||[])if(id)set.add(String(id))}
    else if(item.type==="folder"){
      for(const row of payload?.projects||[])collectDocumentAssetIds("project",row?.data,set);
      for(const row of payload?.notes||[])collectDocumentAssetIds("note",row?.data,set);
      for(const row of payload?.mindmaps||[])collectDocumentAssetIds("mindmap",row?.data,set)
    }
    return set
  }
  function collectStateAssetIds(state){
    const ids=new Set();if(!state||typeof state!=="object")return ids;
    for(const project of state.projects||[])collectDocumentAssetIds("project",project,ids);
    for(const note of state.notes||[])collectDocumentAssetIds("note",note,ids);
    for(const mindmap of state.mindmaps||[])collectDocumentAssetIds("mindmap",mindmap,ids);
    for(const character of state.characterRepository||[]){if(character?.avatarAssetId)ids.add(String(character.avatarAssetId));for(const id of character?.imageAssetIds||[])if(id)ids.add(String(id))}
    for(const memo of state.quickMemos||[])for(const id of memo?.imageAssetIds||[])if(id)ids.add(String(id));
    for(const item of state.trash||[])collectTrashAssetIds(item,ids);
    return ids
  }

  // Uploads images added on this phone in the exact layout the Windows app writes and reads:
  // the bytes go to objects/content-v1/<sha256> and a descriptor sync/assets/<sha256(id:quality)>.json
  // names them. Descriptors must exist before a commit that references the image is published.
  const SYNC_ASSET_QUALITY="balanced";
  const VERIFY_WINDOW_MS=30*60*1000,VERIFY_INTERVAL_MS=2*60*1000;
  function createMobileAssetUploader({drive,assetRepository,sha256Hex,log=()=>{},now=()=>Date.now()}={}){
    if(!drive||!assetRepository||!sha256Hex)throw new Error("mobile-asset-uploader-dependencies-missing");
    const textSha=value=>sha256Hex(new TextEncoder().encode(String(value)));
    const blobSha=async blob=>sha256Hex(await blob.arrayBuffer());
    const lastChecked=new Map();
    let recentUploads=true,awaitingCommit=new Set(); // unknown after a reload; cleared once a scan finds nothing left to verify

    async function putDescriptor(descriptor){
      const identity=await textSha(`${descriptor.assetId}:${descriptor.quality}`),content=JSON.stringify(descriptor);
      return drive.putSyncText({objectKey:`sync/assets/${identity}.json`,content,syncMetadata:{syncType:"asset",revision:`asset-${identity.slice(0,24)}`,baseRevision:"",deviceId:"",createdAtMs:String(descriptor.createdAtMs),expiresAtMs:"0",assetId:descriptor.assetId,quality:descriptor.quality}})
    }
    async function hasDescriptor(assetId){
      const objects=await drive.listSyncAssetDescriptors(assetId);
      return (objects||[]).some(item=>item?.syncType==="asset"&&String(item.assetId||"")===String(assetId)&&String(item.quality||"")===SYNC_ASSET_QUALITY)
    }
    async function uploadOne(record){
      const assetId=String(record.id),sourceSha256=await blobSha(record.blob);
      if(record.sourceSha256&&record.sourceSha256!==sourceSha256)throw new Error("mobile-asset-changed-before-upload");
      // Main image and thumbnail go up side by side: every sequential round trip is time the phone may not have.
      const thumbBlob=record.thumbnail?.blob||null;
      const [main,uploadedThumbnail]=await Promise.all([
        drive.putAssetObject({blob:record.blob,contentSha256:sourceSha256,byteSize:record.blob.size,mimeType:record.mimeType||record.blob.type}),
        thumbBlob?blobSha(thumbBlob).then(thumbSha=>drive.putAssetObject({blob:thumbBlob,contentSha256:thumbSha,byteSize:thumbBlob.size,mimeType:record.thumbnail.mimeType||thumbBlob.type})):null
      ]);
      const thumbnail=uploadedThumbnail||(String(record.mimeType||record.blob.type||"").startsWith("image/")?main:null);
      const pick=object=>({objectKey:object.objectKey,contentSha256:object.contentSha256,byteSize:object.byteSize,mimeType:object.mimeType});
      const descriptor={format:"hamboard-sync-asset",formatVersion:1,assetId,ownerId:String(record.ownerId||""),sourceSha256,quality:SYNC_ASSET_QUALITY,createdAtMs:now(),width:Number(record.width)||0,height:Number(record.height)||0,main:pick(main),thumbnail:thumbnail?pick(thumbnail):null};
      await putDescriptor(descriptor);
      await assetRepository.update(assetId,{uploadState:"uploaded",uploadedAtMs:now(),sourceSha256,contentSha256:sourceSha256,quality:SYNC_ASSET_QUALITY,descriptor});
      lastChecked.set(assetId,now());recentUploads=true;
      log("info","asset-uploaded",{assetId,byteSize:main.byteSize,reused:main.reused===true})
    }

    // Before a commit: every pending image the commit's state references must be on Drive.
    // A failure throws so the commit is not published with a dangling image reference.
    async function uploadReferenced(referencedIds){
      const wanted=new Set([...(referencedIds||[])].map(String));
      const rows=(await assetRepository.listPendingUploads()).filter(record=>wanted.has(String(record.id)));
      const pending=rows.filter(record=>record.uploadState==="pending");
      for(const record of pending)await uploadOne(record);
      // Uploaded earlier but not yet part of a published commit: make sure the descriptor is still
      // on Drive right before the commit that will point at it (older Windows cleanup drops it).
      let restored=0;
      for(const record of rows.filter(row=>row.uploadState==="uploaded"&&!row.committedAtMs)){
        const assetId=String(record.id);
        if(await hasDescriptor(assetId))continue;
        if(!record.descriptor){await uploadOne({...record,uploadState:"pending"});continue}
        await putDescriptor({...record.descriptor,createdAtMs:now()});restored++;
        log("warn","asset-descriptor-restored",{assetId,stage:"before-commit"})
      }
      awaitingCommit=new Set(rows.map(record=>String(record.id)));
      return {uploaded:pending.length,restored}
    }
    // The commit that references these images is published; from now on the reference itself protects them.
    async function markCommitted(){
      const ids=[...awaitingCommit];awaitingCommit=new Set();
      for(const id of ids){const record=await assetRepository.get(id);if(record&&record.uploadState!=="pending"&&!record.committedAtMs)await assetRepository.update(id,{committedAtMs:now()})}
      return {committed:ids.length}
    }

    // Windows cleanup drops descriptors of images its state does not reference yet, so a descriptor
    // uploaded just before our commit can vanish. Recheck recent uploads for a while and put them back.
    async function verifyRecent(referencedIds){
      if(!recentUploads)return {checked:0,restored:0};
      const wanted=new Set([...(referencedIds||[])].map(String)),at=now();
      const uploaded=(await assetRepository.listPendingUploads()).filter(record=>record.uploadState==="uploaded");
      if(!uploaded.length){recentUploads=false;return {checked:0,restored:0}}
      const recent=uploaded.filter(record=>wanted.has(String(record.id)));
      for(const record of uploaded)if(!wanted.has(String(record.id))&&at-(Number(record.uploadedAtMs)||0)>=VERIFY_WINDOW_MS)await assetRepository.update(record.id,{uploadState:"verified",verifiedAtMs:at});
      let restored=0;
      for(const record of recent){
        const assetId=String(record.id);
        if(at-(lastChecked.get(assetId)||0)<VERIFY_INTERVAL_MS)continue;
        lastChecked.set(assetId,at);
        if(!await hasDescriptor(assetId)){
          if(!record.descriptor){await assetRepository.update(assetId,{uploadState:"pending"});continue}
          await putDescriptor({...record.descriptor,createdAtMs:at});restored++;
          log("warn","asset-descriptor-restored",{assetId})
        }
        if(at-(Number(record.uploadedAtMs)||0)>=VERIFY_WINDOW_MS)await assetRepository.update(assetId,{uploadState:"verified",verifiedAtMs:at})
      }
      return {checked:recent.length,restored}
    }
    return Object.freeze({uploadReferenced,markCommitted,verifyRecent,quality:SYNC_ASSET_QUALITY})
  }

  root.HamboardMobileAssetRepository=Object.freeze({createIndexedDbAssetRepository,createMobileAssetUploader,collectStateAssetIds,collectDocumentAssetIds,collectNoteHtmlAssetIds});
})(typeof globalThis!=="undefined"?globalThis:this);
