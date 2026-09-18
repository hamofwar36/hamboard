(function(root){
  "use strict";

  const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.appdata";
  const DRIVE_FILES_URL="https://www.googleapis.com/drive/v3/files";
  const CLIENT_ID_KEY="hamboard.mobile.googleClientId";
  const MAX_SYNC_OBJECT_BYTES=16*1024*1024;
  const MAX_SYNC_OBJECTS=50000;
  let accessToken="",tokenClient=null,scriptPromise=null;

  const configuredClientId=()=>String(root.HAMBOARD_MOBILE_CONFIG?.googleOAuthClientId||localStorage.getItem(CLIENT_ID_KEY)||"").trim();
  const saveClientId=value=>{const clientId=String(value||"").trim();if(clientId)localStorage.setItem(CLIENT_ID_KEY,clientId);else localStorage.removeItem(CLIENT_ID_KEY);tokenClient=null;accessToken="";return clientId};
  const driveError=async response=>{let detail="";try{const body=await response.json();detail=String(body?.error?.message||body?.error||"")}catch{}const error=new Error(`google-drive-http-${response.status}${detail?`: ${detail}`:""}`);error.status=response.status;throw error};
  const authorizedFetch=async(url,options={})=>{if(!accessToken)throw new Error("google-drive-not-connected");const response=await fetch(url,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${accessToken}`}});if(response.status===401){accessToken="";throw new Error("google-drive-reconnect-required")}if(!response.ok)return driveError(response);return response};
  const sha256Hex=async bytes=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(value=>value.toString(16).padStart(2,"0")).join("");
  const property=(properties,name,fallback="")=>String(properties?.[`hamboard${name}`]??fallback);

  function loadIdentityScript(){
    if(root.google?.accounts?.oauth2)return Promise.resolve();
    if(scriptPromise)return scriptPromise;
    scriptPromise=new Promise((resolve,reject)=>{const existing=document.querySelector('script[data-hamboard-google-identity]'),script=existing||document.createElement("script");const done=()=>root.google?.accounts?.oauth2?resolve():reject(new Error("google-identity-unavailable"));script.addEventListener("load",done,{once:true});script.addEventListener("error",()=>reject(new Error("google-identity-load-failed")),{once:true});if(!existing){script.src="https://accounts.google.com/gsi/client";script.async=true;script.defer=true;script.dataset.hamboardGoogleIdentity="";document.head.append(script)}}).catch(error=>{scriptPromise=null;throw error});
    return scriptPromise
  }

  async function connect(){
    const clientId=configuredClientId();
    if(!clientId)throw new Error("google-oauth-web-client-id-not-configured");
    if(!root.isSecureContext&&!/^(localhost|127\.0\.0\.1)$/i.test(location.hostname))throw new Error("google-oauth-secure-origin-required");
    await loadIdentityScript();
    return new Promise((resolve,reject)=>{
      if(!tokenClient)tokenClient=root.google.accounts.oauth2.initTokenClient({client_id:clientId,scope:DRIVE_SCOPE,callback:()=>{}});
      tokenClient.callback=response=>{if(response?.error){reject(new Error(`google-oauth-${response.error}`));return}accessToken=String(response?.access_token||"");if(!accessToken){reject(new Error("google-oauth-access-token-missing"));return}resolve(status())};
      tokenClient.error_callback=response=>reject(new Error(`google-oauth-${response?.type||"popup-failed"}`));
      tokenClient.requestAccessToken({prompt:accessToken?"":"consent"});
    })
  }

  function disconnect(){const token=accessToken;accessToken="";if(token&&root.google?.accounts?.oauth2?.revoke)root.google.accounts.oauth2.revoke(token,()=>{});return status()}
  function status(){return {provider:"google-drive",configured:!!configuredClientId(),connected:!!accessToken,scope:"drive.appdata"}}

  async function listSyncObjects(){
    const objects=[];let pageToken="";
    do{
      const url=new URL(DRIVE_FILES_URL);url.searchParams.set("spaces","appDataFolder");url.searchParams.set("pageSize","1000");url.searchParams.set("orderBy","createdTime asc");url.searchParams.set("q","trashed=false");url.searchParams.set("fields","nextPageToken,files(id,size,appProperties)");if(pageToken)url.searchParams.set("pageToken",pageToken);
      const value=await (await authorizedFetch(url)).json();
      for(const file of value.files||[]){const properties=file.appProperties||{},objectKey=property(properties,"ObjectKey"),kind=property(properties,"Kind"),byteSize=Number(file.size)||0,contentSha256=property(properties,"ContentSha256").toLowerCase();if(kind!=="sync"||!objectKey.startsWith("sync/")||byteSize<1||byteSize>MAX_SYNC_OBJECT_BYTES||!(/^[0-9a-f]{64}$/).test(contentSha256))continue;objects.push({remoteObjectId:String(file.id||""),objectKey,contentSha256,byteSize,syncType:property(properties,"SyncType"),revision:property(properties,"Revision"),baseRevision:property(properties,"BaseRevision"),deviceId:property(properties,"DeviceId"),displayName:property(properties,"DisplayName"),clientProfile:property(properties,"ClientProfile"),createdAtMs:property(properties,"CreatedAtMs","0"),expiresAtMs:property(properties,"ExpiresAtMs","0"),assetId:property(properties,"AssetId"),quality:property(properties,"Quality")});if(objects.length>=MAX_SYNC_OBJECTS)return {objects,truncated:true}}
      pageToken=String(value.nextPageToken||"");
    }while(pageToken);
    return {objects,truncated:false}
  }

  async function getSyncObject(request={}){
    const remoteObjectId=String(request.remoteObjectId||""),objectKey=String(request.objectKey||""),expectedSha=String(request.contentSha256||"").toLowerCase(),expectedSize=Number(request.byteSize)||0;
    if(!/^[A-Za-z0-9_-]+$/.test(remoteObjectId)||!objectKey.startsWith("sync/")||!(/^[0-9a-f]{64}$/).test(expectedSha)||expectedSize<1||expectedSize>MAX_SYNC_OBJECT_BYTES)throw new Error("google-drive-sync-object-request-invalid");
    const response=await authorizedFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(remoteObjectId)}?alt=media`),bytes=await response.arrayBuffer();
    if(bytes.byteLength!==expectedSize||await sha256Hex(bytes)!==expectedSha)throw new Error("google-drive-download-integrity-mismatch");
    let content;try{content=new TextDecoder("utf-8",{fatal:true}).decode(bytes)}catch{throw new Error("google-drive-sync-text-invalid")}
    return {objectKey,content,contentSha256:expectedSha,byteSize:expectedSize}
  }

  root.HamboardMobileGoogleDrive=Object.freeze({status,connect,disconnect,listSyncObjects,getSyncObject,configuredClientId,saveClientId,sha256Hex});
})(typeof globalThis!=="undefined"?globalThis:this);
