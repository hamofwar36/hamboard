(function(root){
  "use strict";
  function validateCloudObjectSize(kind,byteSize){
    if(kind!=="manifest"&&kind!=="sync")return byteSize;
    if(!Number.isSafeInteger(byteSize)||byteSize<=0)throw new Error("cloud-json-size-invalid");
    return byteSize;
  }
  // Reserve synchronously; a failed task must not poison the next operation.
  function createCoordinator(){
    let tail=Promise.resolve(),active=null,pending=0;
    return Object.freeze({
      get active(){return active},
      get busy(){return pending>0},
      run(kind,task){
        pending++;
        const operation=tail.then(async()=>{
          active=kind;
          try{return await task()}finally{active=null;pending--}
        });
        tail=operation.catch(()=>{});
        return operation;
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
