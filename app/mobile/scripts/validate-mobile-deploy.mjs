import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(fileURLToPath(new URL("../",import.meta.url)));
const build=spawnSync(process.execPath,[resolve(root,"scripts/prepare-mobile-deploy.mjs")],{cwd:root,env:{...process.env,HAMBOARD_GOOGLE_OAUTH_CLIENT_ID:"qa-web-client.apps.googleusercontent.com"},encoding:"utf8"});
assert.equal(build.status,0,build.stderr||build.stdout);
const output=resolve(root,"dist-mobile"),files=(await readdir(output)).sort(),html=await readFile(resolve(output,"index.html"),"utf8"),config=await readFile(resolve(output,"mobile-config.js"),"utf8"),lucide=await readFile(resolve(output,"vendor/lucide/lucide.min.js"),"utf8"),vercel=JSON.parse(await readFile(resolve(root,"vercel.json"),"utf8"));
const checks=[],check=(name,run)=>{run();checks.push(name)};
check("mobile output contains only deployable root assets",()=>assert.deepEqual(files,["favicon.ico","index.html","mobile-app.js","mobile-config.js","mobile-google-drive.js","mobile.css","shared","vendor"]));
check("mobile index uses deployment-local shared modules",()=>{assert.match(html,/src="\.\/shared\/sync-state-model\.js"/);assert.doesNotMatch(html,/\.\.\/shared/)});
check("runtime config loads before Google Drive transport",()=>assert.ok(html.indexOf("mobile-config.js")<html.indexOf("mobile-google-drive.js")));
check("mobile uses bundled Lucide before app runtime",()=>{assert.match(html,/src="\.\/vendor\/lucide\/lucide\.min\.js"/);assert.ok(html.indexOf("lucide.min.js")<html.indexOf("mobile-app.js"));assert.ok(lucide.length>1000)});
check("public OAuth client id is injected without a secret",()=>{assert.match(config,/qa-web-client\.apps\.googleusercontent\.com/);assert.doesNotMatch(config,/secret/i)});
check("Vercel builds the isolated mobile output",()=>{assert.equal(vercel.installCommand,"node --version");assert.equal(vercel.buildCommand,"npm run mobile:build");assert.equal(vercel.outputDirectory,"dist-mobile")});
check("desktop application is absent from deployment output",()=>{assert.equal(files.includes("src-tauri"),false);assert.equal(files.includes("package.json"),false)});
console.log(`Hamboard mobile deployment QA passed (${checks.length} checks).`);
