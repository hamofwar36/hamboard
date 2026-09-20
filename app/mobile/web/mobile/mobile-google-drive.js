(function(root){
  "use strict";

  const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.appdata";
  const DRIVE_FILES_URL="https://www.googleapis.com/drive/v3/files";
  const DRIVE_UPLOAD_URL="https://www.googleapis.com/upload/drive/v3/files";
  const MAX_SYNC_OBJECT_BYTES=16*1024*1024;
  const MAX_SYNC_OBJECTS=50000;
  const MAX_BACKUP_MANIFEST_BYTES=16*1024*1024;
  const MAX_ASSET_OBJECT_BYTES=256*1024*1024;
  const MAX_BACKUPS=100;

  let accessToken="";
  let accessTokenExpiresAt=0;
  let sessionAuthenticated=false;
  let sessionChecked=false;
  let sessionPromise=null;
  let tokenPromise=null;
  let objectIndex=null;
  let objectIndexLoadedAt=0;
  let objectIndexPromise=null;
  const OBJECT_INDEX_TTL_MS=5*60*1000;

  const configuredAuthBaseUrl=()=>String(root.HAMBOARD_MOBILE_CONFIG?.authBaseUrl||"").trim().replace(/\/$/,"");
  const clearAccessToken=()=>{accessToken="";accessTokenExpiresAt=0};
  const clearObjectIndex=()=>{objectIndex=null;objectIndexLoadedAt=0;objectIndexPromise=null};
  function status(){
    return {
      provider:"google-drive",
      configured:!!configuredAuthBaseUrl(),
      connected:!!accessToken&&accessTokenExpiresAt>Date.now(),
      authorized:sessionAuthenticated,
      checking:!sessionChecked,
      scope:"drive.appdata"
    }
  }

  async function authFetch(path,options={}){
    const base=configuredAuthBaseUrl();
    if(!base)throw new Error("hamboard-auth-base-url-not-configured");
    const response=await fetch(`${base}${path}`,{
      ...options,
      credentials:"include",
      mode:"cors",
      cache:"no-store",
      headers:{Accept:"application/json",...(options.headers||{})}
    });
    return response
  }

  async function checkSession({force=false}={}){
    if(sessionChecked&&!force)return status();
    if(sessionPromise)return sessionPromise;
    sessionPromise=(async()=>{
      try{
        const response=await authFetch("/api/session");
        if(!response.ok)throw new Error(`hamboard-auth-session-http-${response.status}`);
        const value=await response.json();
        sessionAuthenticated=value?.authenticated===true;
        sessionChecked=true;
        if(!sessionAuthenticated)clearAccessToken();
        return status()
      }finally{sessionPromise=null}
    })();
    return sessionPromise
  }

  async function requestAccessToken({force=false}={}){
    if(!force&&accessToken&&accessTokenExpiresAt>Date.now())return status();
    if(tokenPromise)return tokenPromise;
    tokenPromise=(async()=>{
      try{
        const session=await checkSession();
        if(!session.authorized)throw new Error("hamboard-auth-session-required");
        const response=await authFetch("/api/token",{method:"POST"});
        if(response.status===401){
          sessionAuthenticated=false;
          sessionChecked=true;
          clearAccessToken();
          throw new Error("hamboard-auth-session-expired")
        }
        if(!response.ok)throw new Error(`hamboard-auth-token-http-${response.status}`);
        const value=await response.json();
        const token=String(value?.access_token||"");
        if(!token)throw new Error("hamboard-auth-access-token-missing");
        accessToken=token;
        accessTokenExpiresAt=Date.now()+Math.max(0,(Number(value?.expires_in)||3600)*1000-30000);
        sessionAuthenticated=true;
        sessionChecked=true;
        return status()
      }finally{tokenPromise=null}
    })();
    return tokenPromise
  }

  async function reconnectSilently(){
    const current=status();
    if(current.connected)return current;
    const session=await checkSession();
    if(!session.authorized)return session;
    return requestAccessToken()
  }

  async function connect(){
    const base=configuredAuthBaseUrl();
    if(!base)throw new Error("hamboard-auth-base-url-not-configured");
    const returnTo=location.href;
    const target=`${base}/oauth/start?return_to=${encodeURIComponent(returnTo)}`;
    location.assign(target);
    return {...status(),redirecting:true}
  }

  async function disconnect(){
    try{
      if(configuredAuthBaseUrl())await authFetch("/api/logout",{method:"POST"})
    }finally{
      clearAccessToken();
      clearObjectIndex();
      sessionAuthenticated=false;
      sessionChecked=true
    }
    return status()
  }

  const driveError=async response=>{
    let detail="";
    try{
      const body=await response.json();
      detail=String(body?.error?.message||body?.error||"")
    }catch{}
    const error=new Error(`google-drive-http-${response.status}${detail?`: ${detail}`:""}`);
    error.status=response.status;
    throw error
  };

  async function authorizedFetch(url,options={},retry=true){
    await requestAccessToken();
    let response=await fetch(url,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${accessToken}`}});
    if(response.status===401&&retry){
      clearAccessToken();
      await requestAccessToken({force:true});
      response=await fetch(url,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${accessToken}`}})
    }
    if(response.status===401){
      clearAccessToken();
      throw new Error("google-drive-reconnect-required")
    }
    if(!response.ok)return driveError(response);
    return response
  }

  const sha256Hex=async bytes=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(value=>value.toString(16).padStart(2,"0")).join("");
  const property=(properties,name,fallback="")=>String(properties?.[`hamboard${name}`]??fallback);
  const validRemoteId=value=>/^[A-Za-z0-9_-]+$/.test(String(value||""));
  const validSha=value=>/^[0-9a-f]{64}$/.test(String(value||"").toLowerCase());

  const driveQueryValue=value=>String(value||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
  function syncObjectFromFile(file){
    const properties=file?.appProperties||{},objectKey=property(properties,"ObjectKey"),kind=property(properties,"Kind"),byteSize=Number(file?.size)||0,contentSha256=property(properties,"ContentSha256").toLowerCase();
    if(kind!=="sync"||!objectKey.startsWith("sync/")||byteSize<1||byteSize>MAX_SYNC_OBJECT_BYTES||!validSha(contentSha256)||!validRemoteId(file?.id))return null;
    return {remoteObjectId:String(file.id),objectKey,contentSha256,byteSize,syncType:property(properties,"SyncType"),revision:property(properties,"Revision"),baseRevision:property(properties,"BaseRevision"),deviceId:property(properties,"DeviceId"),displayName:property(properties,"DisplayName"),clientProfile:property(properties,"ClientProfile"),createdAtMs:property(properties,"CreatedAtMs","0"),expiresAtMs:property(properties,"ExpiresAtMs","0"),assetId:property(properties,"AssetId"),quality:property(properties,"Quality")}
  }
  async function querySyncObjects(extraQuery,{pageSize=20,orderBy="createdTime desc",maxResults=20}={}){
    const objects=[];let pageToken="";
    do{
      const url=new URL(DRIVE_FILES_URL);
      url.searchParams.set("spaces","appDataFolder");
      url.searchParams.set("pageSize",String(Math.max(1,Math.min(1000,pageSize))));
      if(orderBy)url.searchParams.set("orderBy",orderBy);
      url.searchParams.set("q",`trashed = false and appProperties has { key='hamboardKind' and value='sync' }${extraQuery?` and ${extraQuery}`:""}`);
      url.searchParams.set("fields","nextPageToken,files(id,size,createdTime,appProperties)");
      if(pageToken)url.searchParams.set("pageToken",pageToken);
      const value=await (await authorizedFetch(url)).json();
      for(const file of value.files||[]){const parsed=syncObjectFromFile(file);if(parsed)objects.push(parsed);if(objects.length>=maxResults)return objects}
      pageToken=String(value.nextPageToken||"")
    }while(pageToken);
    return objects
  }
  async function listSyncAssetDescriptors(assetId){
    const id=String(assetId||"");
    if(!id||id.length>180)return [];
    return querySyncObjects(`appProperties has { key='hamboardSyncType' and value='asset' } and appProperties has { key='hamboardAssetId' and value='${driveQueryValue(id)}' }`,{pageSize:20,maxResults:20})
  }
  async function listSyncRestoreSource(){
    const [checkpoints,latestCommits]=await Promise.all([
      querySyncObjects("appProperties has { key='hamboardSyncType' and value='checkpoint' }",{pageSize:8,maxResults:8}),
      querySyncObjects("appProperties has { key='hamboardSyncType' and value='commit' }",{pageSize:2,maxResults:2})
    ]);
    const head=latestCommits[0]||null;
    if(!head)return {objects:[],checkpoint:null,commits:[],head:null,fast:true,empty:true};
    const checkpoint=checkpoints.find(item=>String(item.revision||"")===String(head.revision||""))||checkpoints[0]||null;
    if(!checkpoint)return null;
    if(String(checkpoint.revision||"")===String(head.revision||""))return {objects:[checkpoint,head],checkpoint,commits:[],head,fast:true,empty:false};
    const tail=[],seen=new Set();let cursor=head;
    for(let step=0;step<16&&cursor;step++){
      const revision=String(cursor.revision||"");
      if(!revision||seen.has(revision))return null;
      seen.add(revision);
      if(revision===String(checkpoint.revision||""))break;
      tail.push(cursor);
      const base=String(cursor.baseRevision||"");
      if(!base)return null;
      const siblings=await querySyncObjects(`appProperties has { key='hamboardSyncType' and value='commit' } and appProperties has { key='hamboardBaseRevision' and value='${driveQueryValue(base)}' }`,{pageSize:3,maxResults:3});
      if(siblings.length>1)return null;
      if(base===String(checkpoint.revision||"")){cursor=null;break}
      const parents=await querySyncObjects(`appProperties has { key='hamboardSyncType' and value='commit' } and appProperties has { key='hamboardRevision' and value='${driveQueryValue(base)}' }`,{pageSize:2,maxResults:2});
      if(parents.length!==1)return null;
      cursor=parents[0]
    }
    if(tail.length>=16&&String(tail[tail.length-1]?.baseRevision||"")!==String(checkpoint.revision||""))return null;
    const ordered=tail.reverse();
    return {objects:[checkpoint,...ordered],checkpoint,commits:ordered,head,fast:true,empty:false}
  }

  async function listSyncObjects(){
    const objects=[];let pageToken="";
    do{
      const url=new URL(DRIVE_FILES_URL);
      url.searchParams.set("spaces","appDataFolder");
      url.searchParams.set("pageSize","1000");
      url.searchParams.set("orderBy","createdTime asc");
      url.searchParams.set("q","trashed = false and appProperties has { key='hamboardKind' and value='sync' }");
      url.searchParams.set("fields","nextPageToken,files(id,size,appProperties)");
      if(pageToken)url.searchParams.set("pageToken",pageToken);
      const value=await (await authorizedFetch(url)).json();
      for(const file of value.files||[]){
        const parsed=syncObjectFromFile(file);if(!parsed)continue;
        objects.push(parsed);
        if(objects.length>=MAX_SYNC_OBJECTS)return {objects,truncated:true}
      }
      pageToken=String(value.nextPageToken||"")
    }while(pageToken);
    return {objects,truncated:false}
  }

  async function getSyncObject(request={}){
    const remoteObjectId=String(request.remoteObjectId||""),objectKey=String(request.objectKey||""),expectedSha=String(request.contentSha256||"").toLowerCase(),expectedSize=Number(request.byteSize)||0;
    if(!validRemoteId(remoteObjectId)||!objectKey.startsWith("sync/")||!validSha(expectedSha)||expectedSize<1||expectedSize>MAX_SYNC_OBJECT_BYTES)throw new Error("google-drive-sync-object-request-invalid");
    const response=await authorizedFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(remoteObjectId)}?alt=media`),bytes=await response.arrayBuffer();
    if(bytes.byteLength!==expectedSize||await sha256Hex(bytes)!==expectedSha)throw new Error("google-drive-download-integrity-mismatch");
    let content;try{content=new TextDecoder("utf-8",{fatal:true}).decode(bytes)}catch{throw new Error("google-drive-sync-text-invalid")}
    return {objectKey,content,contentSha256:expectedSha,byteSize:expectedSize}
  }

  async function loadObjectIndex({force=false}={}){
    if(!force&&objectIndex&&Date.now()-objectIndexLoadedAt<OBJECT_INDEX_TTL_MS)return objectIndex;
    if(objectIndexPromise)return objectIndexPromise;
    objectIndexPromise=(async()=>{
      const entries=new Map();let pageToken="";
      do{
        const url=new URL(DRIVE_FILES_URL);
        url.searchParams.set("spaces","appDataFolder");
        url.searchParams.set("pageSize","1000");
        url.searchParams.set("q","trashed = false");
        url.searchParams.set("fields","nextPageToken,files(id,size,mimeType,appProperties)");
        if(pageToken)url.searchParams.set("pageToken",pageToken);
        const value=await (await authorizedFetch(url)).json();
        for(const file of value.files||[]){
          const properties=file.appProperties||{},objectKey=property(properties,"ObjectKey"),contentSha256=property(properties,"ContentSha256").toLowerCase(),byteSize=Math.max(0,Number(property(properties,"ByteSize"))||Number(file.size)||0);
          if(!objectKey||!validRemoteId(file.id)||!validSha(contentSha256)||byteSize<1)continue;
          entries.set(objectKey,{remoteObjectId:String(file.id),objectKey,contentSha256,byteSize,mimeType:String(file.mimeType||"application/octet-stream")})
        }
        pageToken=String(value.nextPageToken||"")
      }while(pageToken);
      objectIndex=entries;
      objectIndexLoadedAt=Date.now();
      return entries
    })().finally(()=>{objectIndexPromise=null});
    return objectIndexPromise
  }

  async function findObjectByKeyDirect(objectKey,expectedSha,expectedSize){
    const url=new URL(DRIVE_FILES_URL);
    url.searchParams.set("spaces","appDataFolder");
    url.searchParams.set("pageSize","20");
    url.searchParams.set("q",`trashed = false and appProperties has { key='hamboardObjectKey' and value='${driveQueryValue(objectKey)}' }`);
    url.searchParams.set("fields","files(id,size,mimeType,appProperties)");
    const value=await (await authorizedFetch(url)).json();
    for(const file of value.files||[]){
      const properties=file.appProperties||{},key=property(properties,"ObjectKey"),sha=property(properties,"ContentSha256").toLowerCase(),size=Math.max(0,Number(property(properties,"ByteSize"))||Number(file.size)||0);
      if(key===objectKey&&sha===expectedSha&&size===expectedSize&&validRemoteId(file.id))return {remoteObjectId:String(file.id),objectKey:key,contentSha256:sha,byteSize:size,mimeType:String(file.mimeType||"application/octet-stream")}
    }
    return null
  }

  async function getObjectByKey(request={}){
    const objectKey=String(request.objectKey||""),expectedSha=String(request.contentSha256||"").toLowerCase(),expectedSize=Math.max(0,Number(request.byteSize)||0),requestedMime=String(request.mimeType||"application/octet-stream");
    if(!/^[A-Za-z0-9._/-]{1,180}$/.test(objectKey)||!validSha(expectedSha)||expectedSize<1||expectedSize>MAX_ASSET_OBJECT_BYTES)throw new Error("google-drive-asset-object-request-invalid");
    let file=null;
    if(objectIndex&&Date.now()-objectIndexLoadedAt<OBJECT_INDEX_TTL_MS)file=objectIndex.get(objectKey)||null;
    if(!file)file=await findObjectByKeyDirect(objectKey,expectedSha,expectedSize);
    if(!file){
      const index=await loadObjectIndex({force:true});
      file=index.get(objectKey)||null
    }
    if(!file)throw new Error("google-drive-asset-object-not-found");
    if(file.contentSha256!==expectedSha||file.byteSize!==expectedSize)throw new Error("google-drive-asset-object-metadata-mismatch");
    const response=await authorizedFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(file.remoteObjectId)}?alt=media`),bytes=await response.arrayBuffer();
    if(bytes.byteLength!==expectedSize||await sha256Hex(bytes)!==expectedSha)throw new Error("google-drive-download-integrity-mismatch");
    const mimeType=String(requestedMime&&requestedMime!=="application/octet-stream"?requestedMime:file.mimeType||requestedMime||"application/octet-stream");
    return {objectKey,blob:new Blob([bytes],{type:mimeType}),contentSha256:expectedSha,byteSize:expectedSize,mimeType}
  }

  async function putSyncCheckpoint({revision,state,createdAtMs=Date.now()}={}){
    const safeRevision=String(revision||"");
    if(!/^[A-Za-z0-9._:-]{1,120}$/.test(safeRevision)||!state||typeof state!=="object"||Array.isArray(state)||Number(state.schemaVersion)!==1)throw new Error("google-drive-sync-checkpoint-request-invalid");
    const checkpoint={format:"hamboard-sync-checkpoint",formatVersion:1,stateSchemaVersion:1,revision:safeRevision,createdAtMs:Number(createdAtMs)||Date.now(),state};
    const content=JSON.stringify(checkpoint),bytes=new TextEncoder().encode(content);
    if(bytes.byteLength<1||bytes.byteLength>MAX_SYNC_OBJECT_BYTES)throw new Error("google-drive-sync-checkpoint-too-large");
    const contentSha256=await sha256Hex(bytes),objectKey=`sync/checkpoints/${safeRevision}.json`,boundary=`hamboard-${contentSha256.slice(0,24)}`;
    const metadata={name:`hamboard-sync-checkpoint-${contentSha256.slice(0,24)}.json`,parents:["appDataFolder"],mimeType:"application/json",appProperties:{
      hamboardObjectKey:objectKey,hamboardContentSha256:contentSha256,hamboardByteSize:String(bytes.byteLength),hamboardFormatVersion:"1",hamboardKind:"sync",
      hamboardSyncType:"checkpoint",hamboardRevision:safeRevision,hamboardBaseRevision:"",hamboardDeviceId:"mobile-web",hamboardClientProfile:"canonical",hamboardCreatedAtMs:String(checkpoint.createdAtMs),hamboardExpiresAtMs:"0"
    }};
    const body=new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      content,
      `\r\n--${boundary}--\r\n`
    ],{type:`multipart/related; boundary=${boundary}`});
    const url=new URL(DRIVE_UPLOAD_URL);
    url.searchParams.set("uploadType","multipart");
    url.searchParams.set("fields","id,size,appProperties");
    const response=await authorizedFetch(url,{method:"POST",headers:{"Content-Type":`multipart/related; boundary=${boundary}`},body}),value=await response.json();
    if(!validRemoteId(value.id))throw new Error("google-drive-sync-checkpoint-upload-invalid");
    clearObjectIndex();
    return {remoteObjectId:String(value.id),objectKey,contentSha256,byteSize:bytes.byteLength,syncType:"checkpoint",revision:safeRevision,baseRevision:"",deviceId:"mobile-web",clientProfile:"canonical",createdAtMs:String(checkpoint.createdAtMs),expiresAtMs:"0",assetId:"",quality:""}
  }

  async function listBackups(){
    const backups=[];let pageToken="";
    do{
      const url=new URL(DRIVE_FILES_URL);
      url.searchParams.set("spaces","appDataFolder");
      url.searchParams.set("pageSize","100");
      url.searchParams.set("orderBy","createdTime desc");
      url.searchParams.set("q","trashed = false and appProperties has { key='hamboardKind' and value='manifest' }");
      url.searchParams.set("fields","nextPageToken,files(id,size,createdTime,appProperties)");
      if(pageToken)url.searchParams.set("pageToken",pageToken);
      const value=await (await authorizedFetch(url)).json();
      for(const file of value.files||[]){
        const properties=file.appProperties||{},objectKey=property(properties,"ObjectKey"),kind=property(properties,"Kind"),byteSize=Number(file.size)||0,contentSha256=property(properties,"ContentSha256").toLowerCase();
        if(kind!=="manifest"||!objectKey.startsWith("backups/")||!objectKey.endsWith("/manifest.json")||byteSize<1||byteSize>MAX_BACKUP_MANIFEST_BYTES||!validSha(contentSha256)||!validRemoteId(file.id))continue;
        backups.push({
          remoteObjectId:String(file.id),
          objectKey,
          contentSha256,
          byteSize,
          createdTime:String(file.createdTime||"")
        });
        if(backups.length>=MAX_BACKUPS)return {backups,truncated:true}
      }
      pageToken=String(value.nextPageToken||"")
    }while(pageToken);
    return {backups,truncated:false}
  }

  async function getBackupManifest(request={}){
    const remoteObjectId=String(request.remoteObjectId||""),objectKey=String(request.objectKey||""),expectedSha=String(request.contentSha256||"").toLowerCase(),expectedSize=Number(request.byteSize)||0;
    if(!validRemoteId(remoteObjectId)||!objectKey.startsWith("backups/")||!objectKey.endsWith("/manifest.json")||!validSha(expectedSha)||expectedSize<1||expectedSize>MAX_BACKUP_MANIFEST_BYTES)throw new Error("google-drive-backup-object-request-invalid");
    const response=await authorizedFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(remoteObjectId)}?alt=media`),bytes=await response.arrayBuffer();
    if(bytes.byteLength!==expectedSize||await sha256Hex(bytes)!==expectedSha)throw new Error("google-drive-download-integrity-mismatch");
    let content;try{content=new TextDecoder("utf-8",{fatal:true}).decode(bytes)}catch{throw new Error("google-drive-backup-text-invalid")}
    let manifest;try{manifest=JSON.parse(content)}catch{throw new Error("google-drive-backup-json-invalid")}
    if(manifest?.format!=="hamboard-cloud-backup"||manifest?.formatVersion!==1||manifest?.complete!==true||manifest?.stateSchemaVersion!==1||manifest?.state?.schemaVersion!==1)throw new Error("google-drive-backup-header-invalid");
    return manifest
  }

  root.HamboardMobileGoogleDrive=Object.freeze({
    status,connect,reconnectSilently,disconnect,checkSession,requestAccessToken,listSyncRestoreSource,listSyncObjects,listSyncAssetDescriptors,getSyncObject,putSyncCheckpoint,loadObjectIndex,getObjectByKey,listBackups,getBackupManifest,configuredAuthBaseUrl,sha256Hex
  });
})(typeof globalThis!=="undefined"?globalThis:this);
