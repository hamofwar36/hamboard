const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.appdata";
const GOOGLE_AUTH_URL="https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL="https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL="https://oauth2.googleapis.com/revoke";
const SESSION_COOKIE="__Host-hamboard_session";
const STATE_TTL_SECONDS=10*60;

const encoder=new TextEncoder();
const decoder=new TextDecoder();

function nowSeconds(){return Math.floor(Date.now()/1000)}
function sessionDays(env){const value=Math.trunc(Number(env.SESSION_DAYS)||90);return Math.min(180,Math.max(1,value))}
function sessionTtlSeconds(env){return sessionDays(env)*24*60*60}
function redirectUri(request,env){return String(env.GOOGLE_OAUTH_REDIRECT_URI||new URL("/oauth/callback",request.url).href)}
function appOrigin(env){return String(env.APP_ORIGIN||"").replace(/\/$/,"")}

function randomBytes(length){
  const bytes=new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes
}
function bytesToBase64(bytes){
  let binary="";
  for(const value of bytes)binary+=String.fromCharCode(value);
  return btoa(binary)
}
function base64ToBytes(value){
  const binary=atob(String(value||""));
  const out=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)out[index]=binary.charCodeAt(index);
  return out
}
function bytesToBase64Url(bytes){return bytesToBase64(bytes).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
function randomToken(length=32){return bytesToBase64Url(randomBytes(length))}
async function sha256Bytes(value){return new Uint8Array(await crypto.subtle.digest("SHA-256",typeof value==="string"?encoder.encode(value):value))}
async function sha256Hex(value){return [...await sha256Bytes(value)].map(byte=>byte.toString(16).padStart(2,"0")).join("")}
async function pkceChallenge(verifier){return bytesToBase64Url(await sha256Bytes(verifier))}

async function tokenEncryptionKey(env){
  const raw=base64ToBytes(env.TOKEN_ENCRYPTION_KEY);
  if(raw.byteLength!==32)throw new Error("auth-token-encryption-key-invalid");
  return crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"])
}
async function encryptSecret(value,env){
  const iv=randomBytes(12),key=await tokenEncryptionKey(env);
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoder.encode(String(value||""))));
  return {ciphertext:bytesToBase64(ciphertext),iv:bytesToBase64(iv)}
}
async function decryptSecret(ciphertext,iv,env){
  const key=await tokenEncryptionKey(env);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:base64ToBytes(iv)},key,base64ToBytes(ciphertext));
  return decoder.decode(plain)
}

function parseCookies(request){
  const out={};
  for(const part of String(request.headers.get("Cookie")||"").split(";")){
    const index=part.indexOf("=");
    if(index<0)continue;
    const key=part.slice(0,index).trim(),value=part.slice(index+1).trim();
    if(key)out[key]=value
  }
  return out
}
function sessionCookie(value,env,{clear=false}={}){
  const maxAge=clear?0:sessionTtlSeconds(env);
  return `${SESSION_COOKIE}=${clear?"":value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}
function safeReturnTo(value,env){
  const origin=appOrigin(env);
  if(!origin)throw new Error("auth-app-origin-missing");
  try{
    const url=new URL(String(value||origin),origin);
    return url.origin===origin?url.href:origin
  }catch{return origin}
}
function withAuthResult(returnTo,key,value){
  const url=new URL(returnTo);
  url.searchParams.set(key,value);
  return url.href
}

function corsHeaders(request,env){
  const origin=String(request.headers.get("Origin")||"");
  const allowed=appOrigin(env);
  if(origin&&origin===allowed)return {
    "Access-Control-Allow-Origin":allowed,
    "Access-Control-Allow-Credentials":"true",
    "Access-Control-Allow-Headers":"Content-Type",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
    "Vary":"Origin"
  };
  return {}
}
function requireAppOrigin(request,env){
  const origin=String(request.headers.get("Origin")||"");
  return !!origin&&origin===appOrigin(env)
}
function json(data,{status=200,request=null,env=null,headers={}}={}){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store",
      ...(request&&env?corsHeaders(request,env):{}),
      ...headers
    }
  })
}
function noContent(request,env){return new Response(null,{status:204,headers:corsHeaders(request,env)})}

async function findSession(request,env){
  const raw=parseCookies(request)[SESSION_COOKIE];
  if(!raw)return {raw:"",row:null};
  const hash=await sha256Hex(raw);
  const row=await env.DB.prepare(
    "SELECT session_hash,refresh_token_ciphertext,refresh_token_iv,created_at,last_seen_at,expires_at FROM sessions WHERE session_hash=?"
  ).bind(hash).first();
  if(!row)return {raw,row:null};
  if(Number(row.expires_at)<=nowSeconds()){
    await env.DB.prepare("DELETE FROM sessions WHERE session_hash=?").bind(hash).run();
    return {raw:"",row:null}
  }
  return {raw,row}
}
async function renewSession(session,env){
  if(!session?.row||!session.raw)return null;
  const now=nowSeconds(),lastSeen=Number(session.row.last_seen_at)||0;
  if(now-lastSeen<24*60*60)return null;
  const expiresAt=now+sessionTtlSeconds(env);
  await env.DB.prepare("UPDATE sessions SET last_seen_at=?,expires_at=? WHERE session_hash=?")
    .bind(now,expiresAt,String(session.row.session_hash)).run();
  session.row.last_seen_at=now;
  session.row.expires_at=expiresAt;
  return sessionCookie(session.raw,env)
}

async function handleOAuthStart(request,env){
  const url=new URL(request.url),state=randomToken(32),verifier=randomToken(48),expiresAt=nowSeconds()+STATE_TTL_SECONDS;
  const returnTo=safeReturnTo(url.searchParams.get("return_to"),env);
  await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at<=?").bind(nowSeconds()).run();
  await env.DB.prepare("INSERT INTO oauth_states(state,code_verifier,return_to,expires_at) VALUES(?,?,?,?)")
    .bind(state,verifier,returnTo,expiresAt).run();

  const google=new URL(GOOGLE_AUTH_URL);
  google.searchParams.set("client_id",String(env.GOOGLE_OAUTH_CLIENT_ID||""));
  google.searchParams.set("redirect_uri",redirectUri(request,env));
  google.searchParams.set("response_type","code");
  google.searchParams.set("scope",DRIVE_SCOPE);
  google.searchParams.set("access_type","offline");
  google.searchParams.set("include_granted_scopes","true");
  google.searchParams.set("prompt","consent");
  google.searchParams.set("state",state);
  google.searchParams.set("code_challenge",await pkceChallenge(verifier));
  google.searchParams.set("code_challenge_method","S256");
  return Response.redirect(google.href,302)
}

async function exchangeAuthorizationCode(code,verifier,request,env){
  const body=new URLSearchParams({
    code,
    client_id:String(env.GOOGLE_OAUTH_CLIENT_ID||""),
    client_secret:String(env.GOOGLE_OAUTH_CLIENT_SECRET||""),
    redirect_uri:redirectUri(request,env),
    grant_type:"authorization_code",
    code_verifier:verifier
  });
  const response=await fetch(GOOGLE_TOKEN_URL,{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body
  });
  const value=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`google-oauth-token-exchange-${value?.error||response.status}`);
  if(!value.refresh_token)throw new Error("google-oauth-refresh-token-missing");
  return value
}

async function handleOAuthCallback(request,env){
  const url=new URL(request.url),state=String(url.searchParams.get("state")||""),code=String(url.searchParams.get("code")||"");
  const oauthState=state?await env.DB.prepare("SELECT state,code_verifier,return_to,expires_at FROM oauth_states WHERE state=?").bind(state).first():null;
  if(state)await env.DB.prepare("DELETE FROM oauth_states WHERE state=?").bind(state).run();
  const returnTo=safeReturnTo(oauthState?.return_to,env);
  if(url.searchParams.get("error"))return Response.redirect(withAuthResult(returnTo,"auth","denied"),302);
  if(!oauthState||Number(oauthState.expires_at)<=nowSeconds()||!code)return Response.redirect(withAuthResult(returnTo,"auth","state-error"),302);

  try{
    const tokens=await exchangeAuthorizationCode(code,String(oauthState.code_verifier||""),request,env);
    const encrypted=await encryptSecret(tokens.refresh_token,env);
    const rawSession=randomToken(32),sessionHash=await sha256Hex(rawSession),now=nowSeconds(),expiresAt=now+sessionTtlSeconds(env);
    await env.DB.prepare(
      "INSERT INTO sessions(session_hash,refresh_token_ciphertext,refresh_token_iv,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)"
    ).bind(sessionHash,encrypted.ciphertext,encrypted.iv,now,now,expiresAt).run();
    return new Response(null,{
      status:302,
      headers:{
        "Location":withAuthResult(returnTo,"auth","connected"),
        "Set-Cookie":sessionCookie(rawSession,env),
        "Cache-Control":"no-store"
      }
    })
  }catch(error){
    console.error("oauth callback failed",error);
    return Response.redirect(withAuthResult(returnTo,"auth","failed"),302)
  }
}

async function refreshAccessToken(session,env){
  const refreshToken=await decryptSecret(session.row.refresh_token_ciphertext,session.row.refresh_token_iv,env);
  const body=new URLSearchParams({
    client_id:String(env.GOOGLE_OAUTH_CLIENT_ID||""),
    client_secret:String(env.GOOGLE_OAUTH_CLIENT_SECRET||""),
    refresh_token:refreshToken,
    grant_type:"refresh_token"
  });
  const response=await fetch(GOOGLE_TOKEN_URL,{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body
  });
  const value=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(`google-oauth-refresh-${value?.error||response.status}`);
    error.oauthError=String(value?.error||"");
    throw error
  }
  if(!value.access_token)throw new Error("google-oauth-access-token-missing");
  if(value.refresh_token){
    const rotated=await encryptSecret(value.refresh_token,env);
    await env.DB.prepare("UPDATE sessions SET refresh_token_ciphertext=?,refresh_token_iv=? WHERE session_hash=?")
      .bind(rotated.ciphertext,rotated.iv,String(session.row.session_hash)).run();
    session.row.refresh_token_ciphertext=rotated.ciphertext;
    session.row.refresh_token_iv=rotated.iv
  }
  return value
}

async function handleSession(request,env){
  const session=await findSession(request,env);
  if(!session.row)return json({authenticated:false},{request,env,headers:{"Set-Cookie":sessionCookie("",env,{clear:true})}});
  const renewed=await renewSession(session,env);
  return json({authenticated:true,expiresAt:Number(session.row.expires_at)*1000},{
    request,env,
    headers:renewed?{"Set-Cookie":renewed}:{}
  })
}

async function handleToken(request,env){
  const session=await findSession(request,env);
  if(!session.row)return json({error:"session-required"},{status:401,request,env,headers:{"Set-Cookie":sessionCookie("",env,{clear:true})}});
  try{
    const value=await refreshAccessToken(session,env);
    const renewed=await renewSession(session,env);
    return json({
      access_token:String(value.access_token),
      expires_in:Math.max(1,Number(value.expires_in)||3600),
      token_type:String(value.token_type||"Bearer"),
      scope:String(value.scope||DRIVE_SCOPE)
    },{request,env,headers:renewed?{"Set-Cookie":renewed}:{}})
  }catch(error){
    console.error("token refresh failed",error);
    if(error.oauthError==="invalid_grant"){
      await env.DB.prepare("DELETE FROM sessions WHERE session_hash=?").bind(String(session.row.session_hash)).run();
      return json({error:"session-expired"},{status:401,request,env,headers:{"Set-Cookie":sessionCookie("",env,{clear:true})}})
    }
    return json({error:"token-refresh-failed"},{status:502,request,env})
  }
}

async function handleLogout(request,env){
  const session=await findSession(request,env);
  if(session.row){
    try{
      const refreshToken=await decryptSecret(session.row.refresh_token_ciphertext,session.row.refresh_token_iv,env);
      await fetch(GOOGLE_REVOKE_URL,{
        method:"POST",
        headers:{"Content-Type":"application/x-www-form-urlencoded"},
        body:new URLSearchParams({token:refreshToken})
      })
    }catch(error){console.warn("google revoke failed",error)}
    await env.DB.prepare("DELETE FROM sessions WHERE session_hash=?").bind(String(session.row.session_hash)).run()
  }
  return json({authenticated:false},{request,env,headers:{"Set-Cookie":sessionCookie("",env,{clear:true})}})
}

function validateEnvironment(env){
  for(const key of ["APP_ORIGIN","GOOGLE_OAUTH_CLIENT_ID","GOOGLE_OAUTH_CLIENT_SECRET","TOKEN_ENCRYPTION_KEY"]){
    if(!String(env[key]||""))throw new Error(`auth-env-missing-${key.toLowerCase()}`)
  }
  if(!env.DB)throw new Error("auth-d1-binding-missing")
}

export default {
  async fetch(request,env){
    try{
      validateEnvironment(env);
      const url=new URL(request.url);
      if(request.method==="OPTIONS")return requireAppOrigin(request,env)?noContent(request,env):new Response(null,{status:403});
      if(url.pathname==="/health")return json({ok:true});
      if(url.pathname==="/oauth/start"&&request.method==="GET")return handleOAuthStart(request,env);
      if(url.pathname==="/oauth/callback"&&request.method==="GET")return handleOAuthCallback(request,env);
      if(url.pathname.startsWith("/api/")&&!requireAppOrigin(request,env))return json({error:"origin-forbidden"},{status:403});
      if(url.pathname==="/api/session"&&request.method==="GET")return handleSession(request,env);
      if(url.pathname==="/api/token"&&request.method==="POST")return handleToken(request,env);
      if(url.pathname==="/api/logout"&&request.method==="POST")return handleLogout(request,env);
      return json({error:"not-found"},{status:404,request,env})
    }catch(error){
      console.error("hamboard auth worker failed",error);
      return json({error:"auth-worker-failed"},{status:500,request,env})
    }
  }
};
