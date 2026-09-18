(function(root){
  "use strict";

  const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.appdata";
  const DRIVE_FILES_URL="https://www.googleapis.com/drive/v3/files";
  const MAX_SYNC_OBJECT_BYTES=16*1024*1024;
  const MAX_SYNC_OBJECTS=50000;
  const MAX_BACKUP_MANIFEST_BYTES=16*1024*1024;
  const MAX_BACKUPS=100;
  const AUTHORIZED_HINT_KEY="hamboard.mobile.googleAuthorized";
  const ACCESS_TOKEN_KEY="hamboard.mobile.googleAccessToken";
  const ACCESS_TOKEN_EXPIRES_KEY="hamboard.mobile.googleAccessTokenExpiresAt";
  let accessToken="",accessTokenExpiresAt=0,tokenClient=null,scriptPromise=null;

  const configuredClientId=()=>String(root.HAMBOARD_MOBILE_CONFIG?.googleOAuthClientId||"").trim();
  const authorizedHint=()=>{try{return localStorage.getItem(AUTHORIZED_HINT_KEY)==="1"}catch{return false}};
  const setAuthorizedHint=value=>{try{if(value)localStorage.setItem(AUTHORIZED_HINT_KEY,"1");else localStorage.removeItem(AUTHORIZED_HINT_KEY)}catch{}};
  const clearStoredToken=()=>{
    accessToken="";
    accessTokenExpiresAt=0;
    try{localStorage.removeItem(ACCESS_TOKEN_KEY);localStorage.removeItem(ACCESS_TOKEN_EXPIRES_KEY)}catch{}
  };
  const persistStoredToken=(token,expiresInSeconds)=>{
    accessToken=String(token||"");
    const ttl=Math.max(0,Number(expiresInSeconds)||0);
    accessTokenExpiresAt=Date.now()+Math.max(0,ttl*1000-30000);
    try{
      if(accessToken&&accessTokenExpiresAt>Date.now()){
        localStorage.setItem(ACCESS_TOKEN_KEY,accessToken);
        localStorage.setItem(ACCESS_TOKEN_EXPIRES_KEY,String(accessTokenExpiresAt))
      }else clearStoredToken()
    }catch{}
  };
  const restoreStoredToken=()=>{
    try{
      const token=String(localStorage.getItem(ACCESS_TOKEN_KEY)||"");
      const expiresAt=Number(localStorage.getItem(ACCESS_TOKEN_EXPIRES_KEY))||0;
      if(token&&expiresAt>Date.now()){accessToken=token;accessTokenExpiresAt=expiresAt;return true}
    }catch{}
    clearStoredToken();
    return false
  };
  restoreStoredToken();
  const driveError=async response=>{let detail="";try{const body=await response.json();detail=String(body?.error?.message||body?.error||"")}catch{}const error=new Error(`google-drive-http-${response.status}${detail?`: ${detail}`:""}`);error.status=response.status;throw error};
  const authorizedFetch=async(url,options={})=>{
    if(!accessToken)throw new Error("google-drive-not-connected");
    const response=await fetch(url,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${accessToken}`}});
    if(response.status===401){clearStoredToken();throw new Error("google-drive-reconnect-required")}
    if(!response.ok)return driveError(response);
    return response
  };
  const sha256Hex=async bytes=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(value=>value.toString(16).padStart(2,"0")).join("");
  const property=(properties,name,fallback="")=>String(properties?.[`hamboard${name}`]??fallback);
  const validRemoteId=value=>/^[A-Za-z0-9_-]+$/.test(String(value||""));
  const validSha=value=>/^[0-9a-f]{64}$/.test(String(value||"").toLowerCase());

  function loadIdentityScript(){
    if(root.google?.accounts?.oauth2)return Promise.resolve();
    if(scriptPromise)return scriptPromise;
    scriptPromise=new Promise((resolve,reject)=>{
      const existing=document.querySelector("script[data-hamboard-google-identity]"),script=existing||document.createElement("script");
      const done=()=>root.google?.accounts?.oauth2?resolve():reject(new Error("google-identity-unavailable"));
      script.addEventListener("load",done,{once:true});
      script.addEventListener("error",()=>reject(new Error("google-identity-load-failed")),{once:true});
      if(!existing){
        script.src="https://accounts.google.com/gsi/client";
        script.async=true;
        script.defer=true;
        script.dataset.hamboardGoogleIdentity="";
        document.head.append(script)
      }
    }).catch(error=>{scriptPromise=null;throw error});
    return scriptPromise
  }

  async function connect(){
    const clientId=configuredClientId();
    if(!clientId)throw new Error("google-oauth-web-client-id-not-configured");
    if(!root.isSecureContext&&!/^(localhost|127\.0\.0\.1)$/i.test(location.hostname))throw new Error("google-oauth-secure-origin-required");
    await loadIdentityScript();
    return new Promise((resolve,reject)=>{
      if(!tokenClient)tokenClient=root.google.accounts.oauth2.initTokenClient({client_id:clientId,scope:DRIVE_SCOPE,callback:()=>{}});
      tokenClient.callback=response=>{
        if(response?.error){reject(new Error(`google-oauth-${response.error}`));return}
        const token=String(response?.access_token||"");
        if(!token){reject(new Error("google-oauth-access-token-missing"));return}
        persistStoredToken(token,response?.expires_in);
        setAuthorizedHint(true);
        resolve(status())
      };
      tokenClient.error_callback=response=>reject(new Error(`google-oauth-${response?.type||"popup-failed"}`));
      tokenClient.requestAccessToken({prompt:authorizedHint()?"":"consent"})
    })
  }

  function disconnect(){
    const token=accessToken;
    clearStoredToken();
    setAuthorizedHint(false);
    if(token&&root.google?.accounts?.oauth2?.revoke)root.google.accounts.oauth2.revoke(token,()=>{});
    return status()
  }

  function status(){
    return {
      provider:"google-drive",
      configured:!!configuredClientId(),
      connected:!!accessToken&&accessTokenExpiresAt>Date.now(),
      authorized:authorizedHint(),
      scope:"drive.appdata"
    }
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
    status,connect,disconnect,listSyncObjects,getSyncObject,listBackups,getBackupManifest,configuredClientId,sha256Hex
  });
})(typeof globalThis!=="undefined"?globalThis:this);
