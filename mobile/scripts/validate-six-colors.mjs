import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
let pw;try{pw=await import('playwright')}catch(e){if(!process.env.HAMBOARD_PLAYWRIGHT)throw e;pw=await import(pathToFileURL(process.env.HAMBOARD_PLAYWRIGHT).href)}
const root=fileURLToPath(new URL('../',import.meta.url));
const source=await readFile(resolve(root,'web/index.html'),'utf8');
const fixture=source.replace(/\nif\(workToolsPipMode\|\|soundPlayerPipMode\)[^\n]+/,'\nwindow.__sixReady=true;');
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/')return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(fixture);const p=resolve(root,'web','.'+pathname);if(!p.startsWith(resolve(root,'web')))return res.writeHead(403).end();res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.woff2':'font/woff2'}[extname(p)]||'application/octet-stream'}).end(await readFile(p))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const output=resolve(root,'qa/six-colors');await mkdir(output,{recursive:true});let browser;const failures=[],limits=[];let checks=0;
function check(ok,label){checks++;if(!ok)failures.push(label)}
try{
 browser=await pw.chromium.launch({headless:true,...(process.env.HAMBOARD_BROWSER?{executablePath:process.env.HAMBOARD_BROWSER}:{channel:'chrome'})});
 const page=await browser.newPage({viewport:{width:1100,height:800}});page.on('pageerror',e=>failures.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.__sixReady&&window.HamTheme);
 await page.evaluate(()=>{document.body.innerHTML='<main style="padding:30px"><h1>6색 테마 검증</h1><p>본문과 보조 글자, 카드와 입력창</p><section class="field"><label>입력창</label><input placeholder="보조 안내"></section><section class="tool-panel" style="margin-top:20px">공통 패널 <button class="btn secondary">보조 버튼</button></section><section class="calendar-day" style="margin-top:20px">달력 셀</section></main>'});
 for(const mode of ['light','dark'])for(const theme of ['cotton-candy','mint-butter','lilac-peach','matcha-strawberry','lavender-mint','coral-turquoise','choco-strawberry','apricot-sage','butter-lilac','custom']){
  const data=await page.evaluate(({mode,theme})=>{HamTheme.applyAppearance({mode,theme});const s=getComputedStyle(document.body),v=n=>s.getPropertyValue('--'+n).trim(),names=['text','text-muted','bg','surface','surface-hover','border'];return{colors:names.map(v),aliases:['surface-raised','surface-subtle','surface-pressed'].map(v),foreground:['#000000','#FFFFFF','#777777','#FF0000','#16253D','#B8DBFF'].map(bg=>({bg,on:HamTheme.foreground(bg),ratio:HamTheme.contrast(bg,HamTheme.foreground(bg)),best:(()=>{const basic=Math.max(HamTheme.contrast(bg,v('text-light')),HamTheme.contrast(bg,v('text-dark')));return basic>=4.5?basic:Math.max(basic,HamTheme.contrast(bg,'#15171C'),HamTheme.contrast(bg,'#FBFBFD'))})()}))}},{mode,theme});
  check(new Set(data.colors.map(x=>x.toLowerCase())).size===6,`${mode}/${theme} exactly six neutrals`);
  check(JSON.stringify(data.colors.map(x=>x.toUpperCase()))===JSON.stringify(mode==='light'?['#292B38','#6A6E78','#FBFBFD','#FFFFFF','#F1F3F6','#E6E8ED']:['#EEF0F4','#A5A9B2','#15171C','#292C36','#2D323C','#383D47']),`${mode}/${theme} palette`);
  check(data.aliases[0]===data.colors[3]&&data.aliases[1]===data.colors[3]&&data.aliases[2]===data.colors[4],`${mode}/${theme} aliases`);
  for(const x of data.foreground){check(['#292B38','#EEF0F4','#15171C','#FBFBFD'].includes(x.on)&&Math.abs(x.ratio-x.best)<.00001,`${mode}/${theme}/${x.bg} best allowed ink`);if(x.ratio<4.5&&theme==='cotton-candy')limits.push({mode,...x})}
  if(theme==='cotton-candy'){await page.waitForTimeout(250);const surfaces=await page.locator('.field,.tool-panel,.calendar-day').evaluateAll(els=>els.map(el=>getComputedStyle(el).backgroundColor));check(new Set(surfaces).size===1,`${mode} all ordinary surfaces match`);await page.screenshot({path:resolve(output,mode+'.png')})}
 }
 // Run the real memo renderer and its theme listener with isolated state/native doubles.
 await page.evaluate(async()=>{
  state=readState(structuredClone(INITIAL_STATE));state.settings.mode='dark';state.settings.theme='cotton-candy';state.quickMemos=[{id:'six-memo',text:'항상 라이트 모드 메모',textHtml:'<p>항상 <b>라이트</b> 모드 메모</p>',pinColor:'butter',desktopWidget:{enabled:true,alwaysOnTop:false,width:400,height:500}}];
  StateRepository.read=async()=>state;window.__memoEvents=new Map();
  const win={close:async()=>{},setAlwaysOnTop:async()=>{},outerPosition:async()=>({x:0,y:0}),outerSize:async()=>({width:400,height:500}),startDragging:async()=>{}};
  window.__TAURI__={window:{getCurrentWindow:()=>win},event:{listen:async(n,cb)=>{__memoEvents.set(n,cb);return()=>{}},emit:async()=>{}}};
  await startQuickMemoDesktopWidgetWindow('six-memo');
 });
 await page.setViewportSize({width:400,height:500});
 for(const mode of ['light','dark']){
  const data=await page.evaluate(async mode=>{await __memoEvents.get('hamboard-theme-appearance')({payload:{mode,theme:'lilac-peach'}});const s=getComputedStyle(document.body);return{mode:document.body.dataset.mode,text:s.getPropertyValue('--text').trim(),surface:s.getPropertyValue('--surface').trim(),bg:getComputedStyle(document.querySelector('.quick-memo-desktop-widget-root')).backgroundColor,html:document.querySelector('[data-widget-editor]').innerHTML}},mode);
  check(data.mode==='light'&&data.text==='#292B38'&&data.surface==='#ffffff',`memo stays light after ${mode} event`);check(data.bg==='rgb(245, 236, 200)',`memo user paper preserved ${mode}`);check(data.html.includes('<b>라이트</b>'),`memo formatting preserved ${mode}`);
 }
 await page.locator('.quick-memo-desktop-widget-root').hover();await page.locator('[data-widget-color]').click();check(await page.locator('[data-swatch]').count()===5,'memo color palette works');await page.waitForTimeout(200);await page.screenshot({path:resolve(output,'memo-light-fixed.png')});
 const summary={checks,failures,contrastLimits:limits};await writeFile(resolve(output,'results.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));process.exitCode=failures.length?1:0;
}finally{await browser?.close();server.close()}
