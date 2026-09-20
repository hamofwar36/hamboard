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

  root.HamboardMobileAssetRepository=Object.freeze({createIndexedDbAssetRepository});
})(typeof globalThis!=="undefined"?globalThis:this);
