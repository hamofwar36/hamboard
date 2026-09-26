(function(root){
  "use strict";
  function validateCloudObjectSize(kind,byteSize){
    if(kind!=="manifest"&&kind!=="sync")return byteSize;
    if(!Number.isSafeInteger(byteSize)||byteSize<=0)throw new Error("cloud-json-size-invalid");
    return byteSize;
  }
  // Reserve synchronously; a failed task must not poison the next operation.
  function createCoordinator(){
    let tail=Promise.resolve(),active=null,pending=0,backgroundBarrier=null,exclusiveBarrier=null;
    const enqueue=(kind,task)=>{
      pending++;
      const operation=tail.then(async()=>{
        active=kind;
        try{return await task()}finally{active=null;pending--}
      });
      tail=operation.catch(()=>{});
      return operation
    };
    return Object.freeze({
      get active(){return active},
      get busy(){return pending>0},
      run(kind,task){
        // A restore or cleanup must wait for every segment of a staged cloud backup.
        // A normal sync can use the gaps between segments.
        if(backgroundBarrier&&["restore","sync-import","backup-cleanup"].includes(kind)){
          pending++;
          const barrier=backgroundBarrier;
          const delayed=barrier.then(()=>enqueue(kind,task)).finally(()=>{pending--});
          exclusiveBarrier=delayed.catch(()=>{});
          return delayed
        }
        const operation=enqueue(kind,task);
        if(["restore","sync-import","backup-cleanup"].includes(kind))exclusiveBarrier=operation.catch(()=>{});
        return operation
      },
      runBackground(kind,task){
        const previous=Promise.all([backgroundBarrier,exclusiveBarrier].filter(Boolean));
        let release;
        const barrier=new Promise(resolve=>{release=resolve});
        backgroundBarrier=barrier;
        return previous.then(()=>task(segment=>enqueue(kind,segment))).finally(()=>{
          if(backgroundBarrier===barrier)backgroundBarrier=null;
          release()
        })
      }
    });
  }
  function validateReplayPath(path,baseRevision=""){
    let parent=String(baseRevision||"");const seen=new Set(parent?[parent]:[]);
    for(const object of path){
      const revision=String(object?.revision||"");
      if(!revision||seen.has(revision)||String(object?.baseRevision||"")!==parent)throw new Error("sync-history-incomplete");
      seen.add(revision);parent=revision;
    }
    return parent;
  }
  root.HamboardTransferSafety=Object.freeze({validateCloudObjectSize,createCoordinator,validateReplayPath});
})(typeof globalThis!=="undefined"?globalThis:this);
