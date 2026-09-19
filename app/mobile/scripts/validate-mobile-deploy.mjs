import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(fileURLToPath(new URL("../",import.meta.url)));
const build=spawnSync(process.execPath,[resolve(root,"scripts/prepare-mobile-deploy.mjs")],{cwd:root,env:{...process.env,HAMBOARD_AUTH_BASE_URL:"https://auth.hamboard.test/"},encoding:"utf8"});
assert.equal(build.status,0,build.stderr||build.stdout);
const output=resolve(root,"dist-mobile"),files=(await readdir(output)).sort(),html=await readFile(resolve(output,"index.html"),"utf8"),css=await readFile(resolve(output,"mobile.css"),"utf8"),app=await readFile(resolve(output,"mobile-app.js"),"utf8"),transport=await readFile(resolve(output,"mobile-google-drive.js"),"utf8"),config=await readFile(resolve(output,"mobile-config.js"),"utf8"),lucide=await readFile(resolve(output,"vendor/lucide/lucide.min.js"),"utf8"),vercel=JSON.parse(await readFile(resolve(root,"vercel.json"),"utf8")),authWorker=await readFile(resolve(root,"cloudflare-auth/worker.js"),"utf8"),authSchema=await readFile(resolve(root,"cloudflare-auth/schema.sql"),"utf8");
const checks=[],check=(name,run)=>{run();checks.push(name)};
check("mobile output contains only deployable root assets",()=>assert.deepEqual(files,["favicon.ico","index.html","mobile-app.js","mobile-config.js","mobile-google-drive.js","mobile.css","shared","vendor"]));
check("mobile index uses deployment-local shared modules",()=>{assert.match(html,/src="\.\/shared\/sync-state-model\.js"/);assert.doesNotMatch(html,/\.\.\/shared/)});
check("runtime config loads before Google Drive transport",()=>assert.ok(html.indexOf("mobile-config.js")<html.indexOf("mobile-google-drive.js")));
check("versioned mobile assets prevent stale mixed deployments",()=>{
  for(const asset of ["mobile.css","sync-state-model.js","project-repository.js","lucide.min.js","mobile-config.js","mobile-google-drive.js","mobile-app.js"]){
    assert.match(html,new RegExp(asset.replaceAll(".","\\.")+"\\?v=0\\.3\\.14"))
  }
});
check("mobile uses bundled Lucide before app runtime",()=>{assert.match(html,/src="\.\/vendor\/lucide\/lucide\.min\.js"/);assert.ok(html.indexOf("lucide.min.js")<html.indexOf("mobile-app.js"));assert.ok(lucide.length>1000)});
check("menu is a full mobile screen rather than a popover",()=>{assert.match(html,/id="menuScreen"/);assert.doesNotMatch(html,/id="mainMenuSheet"/);assert.match(app,/showScreen\(menuScreen/)});
check("home account flow separates sync data and manual backups",()=>{assert.match(html,/id="cloudSourceScreen"/);assert.match(html,/동기화 데이터/);assert.match(html,/수동 백업/);assert.match(transport,/listBackups/);assert.match(transport,/getBackupManifest/)});
check("visible mobile shell avoids leftover English micro labels",()=>{assert.doesNotMatch(html,/HAMBOARD|GOOGLE DRIVE|>NEW<|>SEARCH</)});
check("auth server URL is injected without OAuth secrets",()=>{assert.match(config,/authBaseUrl:"https:\/\/auth\.hamboard\.test"/);assert.doesNotMatch(config,/clientSecret|refreshToken|GOOGLE_OAUTH_CLIENT_SECRET/i)});
check("mobile version is injected into runtime config",()=>assert.match(config,/version:"0\.3\.15"/));
check("browser transport uses server sessions but calls Drive directly",()=>{
  assert.match(transport,/credentials:"include"/);
  assert.match(transport,/\/api\/session/);
  assert.match(transport,/\/api\/token/);
  assert.match(transport,/https:\/\/www\.googleapis\.com\/drive\/v3\/files/);
  assert.doesNotMatch(transport,/localStorage|google\.accounts\.oauth2|HAMBOARD_GOOGLE_OAUTH_CLIENT_ID/)
});
check("auth Worker stores only auth-session records and exposes no file proxy",()=>{
  assert.match(authWorker,/refresh_token_ciphertext/);
  assert.match(authWorker,/AES-GCM/);
  assert.match(authWorker,/access_type","offline"/);
  assert.doesNotMatch(authWorker,/googleapis\.com\/drive|alt=media|uploadType|multipart/);
  assert.match(authSchema,/CREATE TABLE IF NOT EXISTS sessions/);
  assert.match(authSchema,/CREATE TABLE IF NOT EXISTS oauth_states/)
});
check("settings screen exposes display and diagnostics controls",()=>{assert.match(html,/id="settingsScreen"/);assert.match(html,/id="themeChoiceGrid"/);assert.match(html,/id="diagnosticsLog"/);assert.match(app,/function applyMobileTheme/);assert.match(app,/function renderDiagnostics/)});
check("new document drawer is isolated and creates supported mobile documents",()=>{assert.match(html,/class="nav-sheet-backdrop create-sheet-backdrop" id="createSheet"/);assert.match(html,/<strong>새 폴더<\/strong>/);assert.match(html,/<strong>새 작품<\/strong>/);assert.match(html,/<strong>새 노트<\/strong>/);assert.match(html,/<strong>새 마인드맵<\/strong>/);assert.doesNotMatch(html,/id="createSheetClose"/);assert.doesNotMatch(html,/data-lucide="chevron-right"/);assert.match(css,/--create-chooser-width:150px/);assert.match(css,/\.create-sheet-backdrop:not\(\.form-open\) \.create-sheet-panel\{[\s\S]*?width:var\(--create-chooser-width\);max-width:calc\(100vw - 24px\)/);assert.match(css,/\.nav-sheet-backdrop\{[\s\S]*?backdrop-filter:blur\(5px\)/);assert.match(html,/id="createForm"/);assert.match(html,/id="createColorToggle"/);assert.match(html,/id="createColorOptions" hidden/);assert.match(html,/id="createColorGrid"/);assert.match(html,/id="createColorPicker" type="color"/);assert.match(html,/id="createColorHex" type="text"/);assert.match(app,/function renderCreateColorOptions/);assert.match(app,/createColorCustom/);assert.match(app,/createColorExpanded/);assert.match(app,/createColorOptions\.hidden=!createColorExpanded/);assert.match(app,/createColorValue=safeColor\(button\.dataset\.color,CARD_COLORS\[0\]\)/);assert.match(app,/selectedColor=safeColor\(createColorValue,""\)/);assert.doesNotMatch(html,/data-create-type="(?:folder|project|note|mindmap)"[^>]*disabled/);assert.doesNotMatch(app,/createSheetClose/);assert.match(app,/async function createNewDocument/);assert.match(app,/function defaultStoryStages/);assert.match(app,/repository\.replaceState\(state\)/)});
check("Vercel builds the isolated mobile output",()=>{assert.equal(vercel.installCommand,"node --version");assert.equal(vercel.buildCommand,"npm run mobile:build");assert.equal(vercel.outputDirectory,"dist-mobile")});
check("desktop application is absent from deployment output",()=>{assert.equal(files.includes("src-tauri"),false);assert.equal(files.includes("package.json"),false)});
console.log(`Hamboard mobile deployment QA passed (${checks.length} checks).`);
