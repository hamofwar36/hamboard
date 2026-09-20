import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(fileURLToPath(new URL("../",import.meta.url)));
const mobilePackage=JSON.parse(await readFile(resolve(root,"package.json"),"utf8")),mobileVersion=String(mobilePackage.version||"");
const build=spawnSync(process.execPath,[resolve(root,"scripts/prepare-mobile-deploy.mjs")],{cwd:root,env:{...process.env,HAMBOARD_AUTH_BASE_URL:"https://auth.hamboard.test/"},encoding:"utf8"});
assert.equal(build.status,0,build.stderr||build.stdout);
const output=resolve(root,"dist-mobile"),files=(await readdir(output)).sort(),html=await readFile(resolve(output,"index.html"),"utf8"),css=await readFile(resolve(output,"mobile.css"),"utf8"),app=await readFile(resolve(output,"mobile-app.js"),"utf8"),transport=await readFile(resolve(output,"mobile-google-drive.js"),"utf8"),config=await readFile(resolve(output,"mobile-config.js"),"utf8"),manifest=JSON.parse(await readFile(resolve(output,"manifest.webmanifest"),"utf8")),serviceWorker=await readFile(resolve(output,"service-worker.js"),"utf8"),lucide=await readFile(resolve(output,"vendor/lucide/lucide.min.js"),"utf8"),vercel=JSON.parse(await readFile(resolve(root,"vercel.json"),"utf8")),authWorker=await readFile(resolve(root,"cloudflare-auth/worker.js"),"utf8"),authSchema=await readFile(resolve(root,"cloudflare-auth/schema.sql"),"utf8");
const checks=[],check=(name,run)=>{run();checks.push(name)};
check("mobile output contains only deployable root assets",()=>assert.deepEqual(files,["favicon.ico","icons","index.html","manifest.webmanifest","mobile-app.js","mobile-config.js","mobile-google-drive.js","mobile.css","service-worker.js","shared","vendor"]));
check("mobile index uses deployment-local shared modules",()=>{assert.match(html,/src="\.\/shared\/sync-state-model\.js"/);assert.doesNotMatch(html,/\.\.\/shared/)});
check("runtime config loads before Google Drive transport",()=>assert.ok(html.indexOf("mobile-config.js")<html.indexOf("mobile-google-drive.js")));
check("versioned mobile assets prevent stale mixed deployments",()=>{
  for(const asset of ["mobile.css","sync-state-model.js","project-repository.js","lucide.min.js","mobile-config.js","mobile-google-drive.js","mobile-app.js"]){
    assert.ok(html.includes(asset+"?v="+mobileVersion),asset+" should include the current mobile version")
  }
});
check("mobile uses bundled Lucide before app runtime",()=>{assert.match(html,/src="\.\/vendor\/lucide\/lucide\.min\.js"/);assert.ok(html.indexOf("lucide.min.js")<html.indexOf("mobile-app.js"));assert.ok(lucide.length>1000)});
check("menu is a full mobile screen rather than a popover",()=>{assert.match(html,/id="menuScreen"/);assert.doesNotMatch(html,/id="mainMenuSheet"/);assert.match(app,/showScreen\(menuScreen/)});
check("mobile chrome is touch-friendly and topbar auto-hides on reading scroll",()=>{
  assert.match(css,/\.mobile-bottom-nav\{[\s\S]*?min-height:58px/);
  assert.match(css,/\.bottom-nav-button\{[\s\S]*?min-height:50px/);
  assert.match(css,/\.topbar-hidden \.mobile-topbar\{transform:translateY/);
  assert.match(app,/function syncTopbarVisibility/);
  assert.match(app,/requestAnimationFrame\(syncTopbarVisibility\)/);
  assert.match(app,/resetTopbarVisibility\(\)/)
});
check("mobile build is installable as a standalone PWA without stale-first caching",()=>{
  assert.equal(manifest.name,"햄보드");
  assert.equal(manifest.display,"standalone");
  assert.equal(manifest.start_url,"/");
  assert.equal(manifest.icons.some(icon=>icon.sizes==="192x192"),true);
  assert.equal(manifest.icons.some(icon=>icon.sizes==="512x512"),true);
  assert.match(html,/rel="manifest" href="\.\/manifest\.webmanifest/);
  assert.match(app,/beforeinstallprompt/);
  assert.match(app,/serviceWorker\.register/);
  assert.match(serviceWorker,/hamboard-mobile-/);
  assert.match(serviceWorker,/fetch\(request\)/);
  assert.match(serviceWorker,/caches\.delete/);
  assert.doesNotMatch(serviceWorker,/cache\.match\(request\)[\s\S]*?fetch\(request\)/)
});
check("PWA install icons reuse the existing Hamboard desktop artwork",async()=>{
  const desktopIcon=await readFile(resolve(root,"../window/hamboard.svg"),"utf8");
  const icon192=await readFile(resolve(output,"icons/hamboard-192.svg"),"utf8");
  const icon512=await readFile(resolve(output,"icons/hamboard-512.svg"),"utf8");
  assert.equal(icon192,desktopIcon);
  assert.equal(icon512,desktopIcon);
  assert.equal(manifest.icons.every(icon=>icon.purpose==="any"),true)
});
check("home account flow separates sync data and manual backups",()=>{assert.match(html,/id="cloudSourceScreen"/);assert.match(html,/동기화 데이터/);assert.match(html,/수동 백업/);assert.match(transport,/listBackups/);assert.match(transport,/getBackupManifest/)});
check("visible mobile shell avoids leftover English micro labels",()=>{assert.doesNotMatch(html,/HAMBOARD|GOOGLE DRIVE|>NEW<|>SEARCH</)});
check("auth server URL is injected without OAuth secrets",()=>{assert.match(config,/authBaseUrl:"https:\/\/auth\.hamboard\.test"/);assert.doesNotMatch(config,/clientSecret|refreshToken|GOOGLE_OAUTH_CLIENT_SECRET/i)});
check("mobile version is injected into runtime config",()=>assert.match(config,/version:"0\.3\.25"/));
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
check("mobile note reader restores the shared Home back bar",()=>{
  assert.match(html,/id="noteReaderScreen" class="mobile-screen note-screen"/);
  assert.doesNotMatch(html,/id="noteReaderBack"/);
  assert.match(html,/class="document-title-accent"/);
  assert.match(html,/class="document-title-display" id="noteReaderTitle"/);
  assert.doesNotMatch(html,/id="noteReaderMeta"/);
  assert.doesNotMatch(css,/\.note-open \.mobile-topbar\{display:none\}/);
  assert.match(css,/\.document-mobile-head\{[\s\S]*?background:var\(--bg\)/);
  assert.match(css,/\.document-title-accent\{[\s\S]*?background:var\(--secondary-base\)/);
  assert.match(css,/\.note-reader-card\{[\s\S]*?border:0;border-radius:0;background:var\(--surface\)/);
  assert.match(app,/backButton\.hidden=!back/);
  assert.match(app,/showScreen\(screen,\{heading:"홈",back:true/);
  assert.match(app,/if\(activeDocumentType\)openLibrary\(\{replace:true\}\)/)
});
check("project stages use compact block previews and long projects open from episode cards",()=>{
  assert.match(css,/\.mobile-topbar\{[\s\S]*?min-height:44px/);
  assert.match(css,/\.document-open \.mobile-topbar\{column-gap:3px\}/);
  assert.match(css,/\.episode-list\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(app,/const activeIndex=list\.findIndex/);
  assert.match(app,/if\(activeIndex<0\)\{[\s\S]*?content\.replaceChildren\(\)/);
  assert.match(app,/episodes\.hidden=true/);
  assert.match(app,/projectReaderScreen\.classList\.add\("episode-open"\)/);
  assert.match(app,/compactBlocks:true/);
  assert.match(app,/renderUnit\(project,0,\{showHeading:false,compactBlocks:true\}\)/);
  assert.match(app,/function compactBlockPreview/);
  assert.match(app,/if\(titleText\)head\.append/);
  assert.match(css,/\.block-preview\{[\s\S]*?-webkit-line-clamp:1/);
  assert.match(css,/\.block-preview\.no-title\{[\s\S]*?-webkit-line-clamp:2/);
  assert.match(css,/\.project-screen\.episode-open \.project-mobile-body\{padding-top:8px\}/);
  assert.match(app,/classList\.remove\("episode-open"\)/);
  assert.match(css,/\.stage-carousel\{[\s\S]*?scroll-snap-type:x mandatory/)
});
check("new document drawer is isolated and creates supported mobile documents",()=>{assert.match(html,/class="nav-sheet-backdrop create-sheet-backdrop" id="createSheet"/);assert.match(html,/<strong>새 폴더<\/strong>/);assert.match(html,/<strong>새 작품<\/strong>/);assert.match(html,/<strong>새 노트<\/strong>/);assert.match(html,/<strong>새 마인드맵<\/strong>/);assert.doesNotMatch(html,/id="createSheetClose"/);assert.doesNotMatch(html,/data-lucide="chevron-right"/);assert.match(css,/--create-chooser-width:150px/);assert.match(css,/\.create-sheet-backdrop:not\(\.form-open\) \.create-sheet-panel\{[\s\S]*?width:var\(--create-chooser-width\);max-width:calc\(100vw - 24px\)/);assert.match(css,/\.nav-sheet-backdrop\{[\s\S]*?backdrop-filter:blur\(5px\)/);assert.match(html,/id="createForm"/);assert.match(html,/id="createColorToggle"/);assert.match(html,/id="createColorOptions" hidden/);assert.match(html,/id="createColorGrid"/);assert.match(html,/id="createColorPicker" type="color"/);assert.match(html,/id="createColorHex" type="text"/);assert.match(app,/function renderCreateColorOptions/);assert.match(app,/createColorCustom/);assert.match(app,/createColorExpanded/);assert.match(app,/createColorOptions\.hidden=!createColorExpanded/);assert.match(app,/createColorValue=safeColor\(button\.dataset\.color,CARD_COLORS\[0\]\)/);assert.match(app,/selectedColor=safeColor\(createColorValue,""\)/);assert.doesNotMatch(html,/data-create-type="(?:folder|project|note|mindmap)"[^>]*disabled/);assert.doesNotMatch(app,/createSheetClose/);assert.match(app,/async function createNewDocument/);assert.match(app,/function defaultStoryStages/);assert.match(app,/repository\.replaceState\(state\)/)});
check("Vercel builds the isolated mobile output",()=>{assert.equal(vercel.installCommand,"node --version");assert.equal(vercel.buildCommand,"npm run mobile:build");assert.equal(vercel.outputDirectory,"dist-mobile")});
check("desktop application is absent from deployment output",()=>{assert.equal(files.includes("src-tauri"),false);assert.equal(files.includes("package.json"),false)});
console.log(`Hamboard mobile deployment QA passed (${checks.length} checks).`);
