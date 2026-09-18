(function(root){
  "use strict";

  const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.appdata";
  const DRIVE_FILES_URL="https://www.googleapis.com/drive/v3/files";
  const MAX_SYNC_OBJECT_BYTES=16*1024*1024;
  const MAX_SYNC_OBJECTS=50000;
  const MAX_BACKUP_MANIFEST_BYTES=16*1024*1024;
  const MAX_BACKUPS=100;

  let accessToken="";
  let accessTokenExpiresAt=0;
  let sessionAuthenticated=false;
  let sessionChecked=false;
  let sessionPromise=null;
  let tokenPromise=null;

  const configuredAuthBaseUrl=()=>String(root.HAMBOARD_MOBILE_CONFIG?.authBaseUrl||"").trim().replace(/\/$/,"");
  const clearAccessToken=()=>{accessToken="";accessTokenExpiresAt=0};
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
        const properties=file.appProperties||{},objectKey=property(properties,"ObjectKey"),kind=property(properties,"Kind"),byteSize=Number(file.size)||0,contentSha256=property(properties,"ContentSha256").toLowerCase();
        if(kind!=="sync"||!objectKey.startsWith("sync/")||byteSize<1||byteSize>MAX_SYNC_OBJECT_BYTES||!validSha(contentSha256))continue;
        objects.push({
          remoteObjectId:String(file.id||""),
          objectKey,
          contentSha256,
          byteSize,
          syncType:property(properties,"SyncType"),
          revision:property(properties,"Revision"),
          baseRevision:property(properties,"BaseRevision"),
          deviceId:property(properties,"DeviceId"),
          displayName:property(properties,"DisplayName"),
          clientProfile:property(properties,"ClientProfile"),
          createdAtMs:property(properties,"CreatedAtMs","0"),
          expiresAtMs:property(properties,"ExpiresAtMs","0"),
          assetId:property(properties,"AssetId"),
          quality:property(properties,"Quality")
        });
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
    status,connect,reconnectSilently,disconnect,checkSession,requestAccessToken,listSyncObjects,getSyncObject,listBackups,getBackupManifest,configuredAuthBaseUrl,sha256Hex
  });
})(typeof globalThis!=="undefined"?globalThis:this);
