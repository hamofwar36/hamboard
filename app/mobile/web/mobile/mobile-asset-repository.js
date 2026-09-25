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
    let recentUploads=true; // unknown after a reload; cleared once a scan finds nothing left to verify

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
      const main=await drive.putAssetObject({blob:record.blob,contentSha256:sourceSha256,byteSize:record.blob.size,mimeType:record.mimeType||record.blob.type});
      let thumbnail=String(record.mimeType||record.blob.type||"").startsWith("image/")?main:null;
      if(record.thumbnail?.blob){
        const thumbSha=await blobSha(record.thumbnail.blob);
        thumbnail=await drive.putAssetObject({blob:record.thumbnail.blob,contentSha256:thumbSha,byteSize:record.thumbnail.blob.size,mimeType:record.thumbnail.mimeType||record.thumbnail.blob.type})
      }
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
      const pending=(await assetRepository.listPendingUploads()).filter(record=>record.uploadState==="pending"&&wanted.has(String(record.id)));
      for(const record of pending)await uploadOne(record);
      return {uploaded:pending.length}
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
    return Object.freeze({uploadReferenced,verifyRecent,quality:SYNC_ASSET_QUALITY})
  }

  root.HamboardMobileAssetRepository=Object.freeze({createIndexedDbAssetRepository,createMobileAssetUploader});
})(typeof globalThis!=="undefined"?globalThis:this);
