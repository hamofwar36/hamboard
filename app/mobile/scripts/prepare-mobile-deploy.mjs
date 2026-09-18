import {cp,mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const projectRoot=resolve(fileURLToPath(new URL("../",import.meta.url)));
const outputRoot=resolve(projectRoot,"dist-mobile");
const mobileRoot=resolve(projectRoot,"web/mobile");
const sharedRoot=resolve(projectRoot,"../window/web/shared");
const authBaseUrl=String(process.env.HAMBOARD_AUTH_BASE_URL||"").trim().replace(/\/$/,"");
const mobilePackage=JSON.parse(await readFile(resolve(projectRoot,"package.json"),"utf8"));
const mobileVersion=String(mobilePackage.version||"1.0.0");

await rm(outputRoot,{recursive:true,force:true});
await mkdir(resolve(outputRoot,"shared"),{recursive:true});
await mkdir(resolve(outputRoot,"vendor"),{recursive:true});

let html=await readFile(resolve(mobileRoot,"index.html"),"utf8");
html=html
  .replaceAll('src="../shared/','src="./shared/')
  .replace('src="../../../window/web/assets/vendor/lucide/lucide.min.js"','src="./vendor/lucide/lucide.min.js"')
  .replace('  <script src="./mobile-google-drive.js"></script>','  <script src="./mobile-config.js"></script>\n  <script src="./mobile-google-drive.js"></script>');

await Promise.all([
  writeFile(resolve(outputRoot,"index.html"),html),
  cp(resolve(mobileRoot,"mobile.css"),resolve(outputRoot,"mobile.css")),
  cp(resolve(mobileRoot,"mobile-app.js"),resolve(outputRoot,"mobile-app.js")),
  cp(resolve(mobileRoot,"mobile-google-drive.js"),resolve(outputRoot,"mobile-google-drive.js")),
  cp(resolve(sharedRoot,"sync-state-model.js"),resolve(outputRoot,"shared/sync-state-model.js")),
  cp(resolve(sharedRoot,"project-repository.js"),resolve(outputRoot,"shared/project-repository.js")),
  cp(resolve(projectRoot,"../window/web/assets/vendor/lucide"),resolve(outputRoot,"vendor/lucide"),{recursive:true}),
  cp(resolve(projectRoot,"web/favicon.ico"),resolve(outputRoot,"favicon.ico")),
  writeFile(resolve(outputRoot,"mobile-config.js"),`window.HAMBOARD_MOBILE_CONFIG=Object.freeze({authBaseUrl:${JSON.stringify(authBaseUrl)},version:${JSON.stringify(mobileVersion)}});\n`)
]);

console.log(`Hamboard mobile deployment prepared: ${outputRoot}`);
