import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
let playwright;
try { playwright = await import('playwright'); }
catch (error) {
  if (!process.env.HAMBOARD_PLAYWRIGHT) throw error;
  playwright = await import(pathToFileURL(process.env.HAMBOARD_PLAYWRIGHT).href);
}
const html = await readFile(resolve(root, 'web/index.html'), 'utf8');
// Run the shipped DOM/CSS/functions; replace only native application bootstrap in this isolated fixture.
// SQLite/filesystem/audio APIs are not available in Chromium, so no user database is opened.
const appHtml = html.replace(/\nif\(workToolsPipMode\|\|soundPlayerPipMode\)[^\n]+/, '\nwindow.__themeFixtureLoaded=true;');
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(appHtml);
    const file = resolve(root, 'web', '.' + pathname);
    if (!file.startsWith(resolve(root, 'web'))) return res.writeHead(403).end();
    const types = { '.js': 'text/javascript', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const output = resolve(root, 'qa/theme');
await mkdir(output, { recursive: true });
const failures = [], results = [], errors = [], contrastLimitations = [];
let browser;
try {
  browser = await playwright.chromium.launch({ headless: true, ...(process.env.HAMBOARD_BROWSER ? { executablePath: process.env.HAMBOARD_BROWSER } : { channel: 'chrome' }) });
  const page = await browser.newPage({ viewport: { width: 1380, height: 1100 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__themeFixtureLoaded && window.HamTheme);
  await page.evaluate(() => {
    // Independent WCAG calculation over actual computed colors (not the application's color helper).
    window.qaContrast = (background, foreground) => {
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      const luminance=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);const pixel=context.getImageData(0,0,1,1).data;return [.2126,.7152,.0722].reduce((total,factor,i)=>{const s=pixel[i]/255;return total+factor*(s<=.04045?s/12.92:Math.pow((s+.055)/1.055,2.4))},0)};
      const a=luminance(background),b=luminance(foreground);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    };
    state = readState(structuredClone(INITIAL_STATE));
    window.__themeEvents = new Map();
    window.__TAURI__ = { event: {
      listen: async (name, callback) => { const list = __themeEvents.get(name) || []; list.push(callback); __themeEvents.set(name, list); return () => {}; },
      emit: async (name, payload) => { for (const callback of __themeEvents.get(name) || []) await callback({ payload }); }
    }, window: { getCurrentWindow: () => ({ setAlwaysOnTop: async () => {}, setSize: async () => {}, setMinSize: async () => {}, close: async () => {}, setResizable: async () => {}, innerSize: async () => ({ width: 380, height: 600 }), scaleFactor: async () => 1, onResized: async () => {}, onCloseRequested: async () => {} }), LogicalSize: class { constructor(width,height){this.width=width;this.height=height} } } };
    StateRepository.read = async () => state;
    document.body.innerHTML = `<main id="theme-matrix">
      <h1>햄보드 테마 회귀 검사</h1><p id="mode-label"></p>
      <div class="qa-row">
        <section class="qa-cell" data-surface="primary-soft"><strong>파스텔 표면 · 중첩 버튼</strong><p class="modal-note" id="pastel-meta">설명과 보조 아이콘</p><span class="repository-character-actions"><button class="mini-icon-btn" id="nested-dark">${lucideIcon('settings')}</button></span><button class="btn" id="primary">확인 ${lucideIcon('check')}</button><button class="btn secondary" id="secondary">보조</button></section>
        <section class="qa-cell"><div class="settings-section open"><button class="settings-section-toggle" id="selected-menu">선택 메뉴 <span class="settings-trash-count" id="nested-badge">12</span></button></div><button class="nav-entry project-entry active" id="selected-nav"><span class="nav-icon">${lucideIcon('book-open')}</span>선택 작품 <span class="repository-count">3</span></button><button class="timer-filter-chip active" id="selected-filter">선택 필터</button></section>
        <section class="qa-cell"><button class="btn secondary danger-item" id="delete">${lucideIcon('trash-2')} 삭제</button><button class="btn danger-item danger-solid" id="permanent">영구 삭제</button><button class="btn secondary" id="close">${lucideIcon('x')} 닫기</button><button class="btn" disabled id="disabled">사용 불가</button><label>입력 <input id="placeholder" placeholder="보조 안내 문구"></label><span class="cloud-provider-status" data-state="connected" id="success">${lucideIcon('check')} 연결됨</span></section>
      </div>
      <div class="qa-row">
        <article class="project-card story-card" id="light-card" style="--card-color:#B8DBFF"><div class="project-folder">밝은 작품</div><div class="project-title">봄날의 기록</div><div class="work-card-subtitle">파스텔 사용자 배경</div><button class="project-menu-btn">${lucideIcon('ellipsis')}</button></article>
        <article class="project-card story-card" id="dark-card" style="--card-color:#16253D"><div class="project-folder">어두운 작품</div><div class="project-title">밤의 기록</div><div class="work-card-subtitle">어두운 사용자 배경</div><button class="project-menu-btn">${lucideIcon('ellipsis')}</button></article>
        <article class="project-card has-card-image" id="image-card" style="background-image:linear-gradient(135deg,#FFFFFF 0 50%,#102B40 50%)"><span class="card-dark-veil"></span><div class="project-folder">이미지 카드</div><div class="project-title">밝고 어두운 이미지 위 제목</div><button class="project-menu-btn">${lucideIcon('ellipsis')}</button></article>
      </div>
      <div class="qa-row">
        <section class="stage" id="stage" style="--stage-color:#24304F"><h3 class="stage-name">스토리 단계</h3><p class="stage-desc">사용자 색상 단계 설명</p><div class="beat-card" id="beat"><span class="beat-kicker" id="kicker">01</span><strong>내부 비트 카드</strong><p class="beat-summary">본문과 중첩 버튼의 색상 재설정</p><button class="btn secondary stage-mini-btn" id="stage-button">${lucideIcon('plus')}</button></div></section>
        <section class="qa-cell"><div class="mindmap-node custom-color note-node" id="node" style="--node-color:#D7C0FF"><div class="mindmap-node-head"><span class="mindmap-node-kind-icon">${lucideIcon('sticky-note')}</span><strong class="mindmap-node-head-title">마인드맵 노드</strong><button class="mindmap-node-action">${lucideIcon('ellipsis')}</button></div><div class="mindmap-node-body"><p class="mindmap-node-preview">보정한 노드 배경 위 본문</p></div></div><div class="mindmap-group custom-color" style="--group-color:#16253D"><div class="mindmap-group-head" id="group"><input class="mindmap-group-title" value="어두운 그룹" readonly><span class="mindmap-group-count">2개</span></div></div><button class="calendar-range-bar" id="event-light" style="--event-color:#F6D872">밝은 일정</button><button class="calendar-range-bar" id="event-dark" style="--event-color:#19253C">어두운 일정</button></section>
        <section class="qa-cell"><div class="work-tools-pip-module"><div class="work-tools-pip-module-head">작업 도구 PIP</div><button class="work-tools-pip-btn primary" id="pip-primary">${lucideIcon('play')}</button><button class="work-tools-pip-toggle active" id="pip-selected">${lucideIcon('timer')}</button><button class="work-tools-pip-btn" id="pip-normal">${lucideIcon('pin')}</button></div><div class="note-editor" id="rich-note"><p><span style="color:#8D3399;background-color:#FFF0AA">저장된 사용자 서식 유지</span></p></div><div class="script-preview-row" style="--dialogue-color:#DA368D"><div class="script-preview-meta character-colored" id="dialogue">인물 대사</div></div><span class="color-choice" style="background:#16253D" id="palette"></span></section>
      </div>
    </main>`;
    const fixtureLayout=document.createElement('style');
    fixtureLayout.textContent=`body{overflow:auto}#theme-matrix{padding:24px;max-width:1360px;margin:auto}.qa-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:20px 0}.qa-cell{border:1px solid var(--border);border-radius:20px;padding:16px;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;background:var(--surface);color:var(--on-surface)}.qa-cell[data-surface]{background:var(--primary-soft);color:var(--on-primary-soft)}.qa-cell>.nav-entry{width:100%;white-space:nowrap}.qa-cell>.settings-section{display:block;width:100%;padding:0;border:0}.qa-cell .settings-section-toggle{width:100%}#placeholder{background:var(--surface-subtle);color:var(--on-surface);border:1px solid var(--border)}.qa-cell .mindmap-node,.qa-cell .mindmap-group,.qa-cell .calendar-range-bar{position:relative;inset:auto;width:100%;height:auto;min-height:25px}.qa-cell .mindmap-group{padding:0;min-height:35px}.stage{min-height:250px}.stage .beat-card{position:relative}.qa-cell .work-tools-pip-module{width:100%}.note-editor{padding:8px;min-height:70px}button{max-width:100%}`;
    document.head.append(fixtureLayout);
    refreshLucideIcons();
  });
  const modes = [['light','cotton-candy'],['dark','cotton-candy'],['light','high-contrast'],['dark','high-contrast']];
  const inspect = async (id, label, minimum=4.5) => {
    const value = await page.locator('#'+id).evaluate((element) => {
      const style=getComputedStyle(element); let background=style.backgroundColor;
      if(element.matches('.stage'))background=style.getPropertyValue('--user-contrast-bg');
      let parent=element.parentElement;
      while((background==='rgba(0, 0, 0, 0)'||background==='transparent')&&parent){background=getComputedStyle(parent).backgroundColor;parent=parent.parentElement}
      const icon=element.matches('button')?element.querySelector('svg'):null,iconStyle=icon?getComputedStyle(icon):null;
      return {background,color:style.color,ratio:qaContrast(background,style.color),icon:iconStyle?.stroke,iconColor:iconStyle?.color,opacity:style.opacity,outline:style.outlineStyle,outlineWidth:style.outlineWidth,weight:style.fontWeight};
    });
    results.push({label,id,...value});
    if(value.ratio<minimum){
      // The six-color contract prefers body inks with two fixed contrast fallbacks.
      // Report insufficient contrast separately only when the chosen ink is
      // demonstrably the best of the allowed candidates; other regressions still fail.
      const bestAllowed = await page.evaluate(value => {
        if(document.body.dataset.theme==='high-contrast')return false;
        const root=getComputedStyle(document.documentElement),inks=['text-light','text-dark'].map(n=>root.getPropertyValue('--'+n).trim());
        const normalize=color=>{const el=document.createElement('span');el.style.color=color;document.body.append(el);const result=getComputedStyle(el).color;el.remove();return result};
        inks.push('#15171C','#FBFBFD');
        const best=Math.max(...inks.map(ink=>qaContrast(value.background,ink)));
        return inks.map(normalize).includes(value.color)&&best<4.5&&Math.abs(value.ratio-best)<.02;
      },value);
      const message=`${label} #${id}: contrast ${value.ratio.toFixed(2)} (${value.color} on ${value.background})`;
      (bestAllowed?contrastLimitations:failures).push(message);
    }
    if(value.icon && value.icon!==value.color)failures.push(`${label} #${id}: icon ${value.icon} != text ${value.color}`);
    return value;
  };
  const stored=await page.locator('#rich-note').innerHTML();
  for(const [mode,theme] of modes){
    const label=mode+'-'+theme;
    await page.evaluate(({mode,theme,label})=>{state.settings.mode=mode;state.settings.theme=theme;applyTheme(false);document.querySelector('#mode-label').textContent=label;HamTheme.refresh()},{mode,theme,label});
    await page.waitForTimeout(250);
    for(const id of ['primary','secondary','nested-dark','nested-badge','selected-menu','selected-nav','selected-filter','delete','permanent','close','disabled','success','light-card','dark-card','stage','beat','kicker','stage-button','node','group','event-light','event-dark','pip-primary','pip-selected','pip-normal'])await inspect(id,label+' default');
    const selectedBefore=await page.locator('#selected-nav').evaluate(el=>getComputedStyle(el).backgroundColor);
    const errorRole=await page.locator('#delete').evaluate(el=>{const probe=document.createElement('span');probe.style.color='var(--status-error)';document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return {expected,actual:getComputedStyle(el).color}});
    if(errorRole.actual!==errorRole.expected)failures.push(label+' deletion lost semantic foreground '+JSON.stringify(errorRole));
    for(const id of ['primary','secondary','selected-menu','selected-nav','selected-filter','delete','permanent','close','pip-primary','pip-selected','pip-normal','stage-button']){
      await page.locator('#'+id).hover();await page.waitForTimeout(220);await inspect(id,label+' hover');
      if(id==='selected-nav'&&await page.locator('#selected-nav').evaluate(el=>getComputedStyle(el).backgroundColor)!==selectedBefore)failures.push(label+' selected navigation lost its selected fill on hover');
    }
    await page.mouse.move(0,0);
    for(const id of ['primary','delete','placeholder']){
      await page.locator('#'+id).focus();await page.waitForTimeout(220);
      const focus=await inspect(id,label+' focus');
      if(focus.outline==='none'||focus.outlineWidth==='0px')failures.push(label+' missing focus ring #'+id);
    }
    const placeholder=await page.locator('#placeholder').evaluate(el=>({color:getComputedStyle(el,'::placeholder').color,background:getComputedStyle(el).backgroundColor,opacity:getComputedStyle(el,'::placeholder').opacity}));
    const placeholderRatio=await page.evaluate(x=>qaContrast(x.background,x.color),placeholder);
    if(placeholderRatio<4.5||placeholder.opacity!=='1')failures.push(label+' placeholder contrast/opacity');
    if(await page.locator('#rich-note').innerHTML()!==stored)failures.push(label+' changed saved rich text');
    const image=await page.locator('#image-card').evaluate(el=>({color:getComputedStyle(el.querySelector('.project-title')).color,veil:getComputedStyle(el.querySelector('.card-dark-veil')).backgroundColor,display:getComputedStyle(el.querySelector('.card-dark-veil')).display,veilWidth:el.querySelector('.card-dark-veil').getBoundingClientRect().width}));
    if(image.color!=='rgb(255, 255, 255)'||image.veil!=='rgba(0, 0, 0, 0.62)'||image.display==='none'||image.veilWidth<100)failures.push(label+' image contract '+JSON.stringify(image));
    if(theme==='high-contrast'){
      const accessible=await page.locator('#rich-note span').evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));
      if(accessible.background!=='rgba(0, 0, 0, 0)')failures.push(label+' rich text display background');
    }
    await page.locator('#placeholder').blur();
    await page.screenshot({path:resolve(output,label+'.png'),fullPage:true});
  }
  // Exercise the full RGB cube corners and a middle gray, including dark custom theme accents.
  for(const mode of ['light','dark'])for(const color of ['#FFFFFF','#000000','#16253D','#777777','#FFFF00','#0000FF','#FF0000','#00FF00']){
    await page.evaluate(({mode,color})=>{state.settings.mode=mode;state.settings.theme='custom';state.settings.themeCustomA=color;state.settings.themeCustomB=color;applyTheme(false);for(const [id,token] of [['light-card','card-color'],['stage','stage-color'],['node','node-color'],['event-dark','event-color']])document.querySelector('#'+id).style.setProperty('--'+token,color);HamTheme.refresh()},{mode,color});
    await page.waitForTimeout(230);
    for(const id of ['primary','pip-primary','selected-menu','light-card','stage','node','event-dark'])await inspect(id,mode+' custom '+color);
  }
  // Independent document: output is identical when only app appearance changes.
  const exported=await page.evaluate(()=>{
    const project=readProject({id:'theme-export',title:'독립 문서',stageDefs:[],stages:{},characters:[]});
    const payload={project,assets:[]};state.settings.theme='cotton-candy';state.settings.mode='light';const a=projectStandaloneHTML(project,payload);state.settings.theme='high-contrast';state.settings.mode='dark';const b=projectStandaloneHTML(project,payload);return {same:a===b,hasTheme:b.includes('data-theme='),html:b};
  });
  if(!exported.same||exported.hasTheme)failures.push('export depends on app appearance');
  await writeFile(resolve(output,'export.html'),exported.html);
  // A real separate browser page calls the actual appearance receiver; native IPC is a test double.
  const pip=await browser.newPage({viewport:{width:420,height:620}});await pip.goto(url);await pip.waitForFunction(()=>window.__themeFixtureLoaded);
  await pip.evaluate(async()=>{state=readState(structuredClone(INITIAL_STATE));window.__receiveTheme=null;window.__TAURI__={event:{listen:async(name,cb)=>{if(name==='hamboard-theme-appearance')window.__receiveTheme=cb;return ()=>{}}}};await listenThemeAppearance();document.body.innerHTML='<div class="work-tools-pip-shell"><button class="work-tools-pip-btn primary" id="window-primary">▶</button><button class="work-tools-pip-btn" id="window-normal">닫기</button></div>'});
  for(const [mode,theme] of modes){await pip.evaluate(({mode,theme})=>__receiveTheme({payload:{mode,theme}}),{mode,theme});await pip.waitForTimeout(220);const value=await pip.locator('#window-primary').evaluate(el=>({ratio:HamTheme.contrast(getComputedStyle(el).backgroundColor,getComputedStyle(el).color),mode:document.body.dataset.mode,theme:document.body.dataset.theme}));if(value.ratio<4.5||value.mode!==mode||value.theme!==theme)failures.push('window theme update '+JSON.stringify(value));}
  await pip.screenshot({path:resolve(output,'separate-window.png')});
  await pip.close();
  // Actual app renderers, original layout and DOM. Only native persistence/IPC are substituted.
  const live=await browser.newPage({viewport:{width:1360,height:960}});await live.goto(url);await live.waitForFunction(()=>window.__themeFixtureLoaded);
  live.on('pageerror',error=>errors.push('renderer: '+error.message));
  await live.evaluate(()=>{
    state=readState(structuredClone(INITIAL_STATE));
    StateRepository.snapshot=()=>state;StateRepository.write=()=>{};StateRepository.writeQuietly=()=>{};
    StateRepository.read=async()=>state;
    AssetRepository.get=async()=>null;
    state.projects=[readProject({id:'qa-project',title:'봄날의 기록',subtitle:'테마 회귀 검사용 작품',color:'#B8DBFF',kind:'short',stageDefs:[{id:'stage1',name:'만남',hint:'두 인물이 처음 만나는 순간',color:'#BDE7C4'},{id:'stage2',name:'갈등',hint:'어두운 사용자 배경',color:'#16253D'}],stages:{stage1:[{id:'beat1',type:'detail',title:'첫 장면',summary:'기존 레이아웃과 편집 동작을 유지합니다.',tags:['시작'],children:[]}],stage2:[]}}),readProject({id:'qa-dark',title:'밤의 기록',subtitle:'어두운 사용자 색상',color:'#16253D',kind:'long',episodes:[{id:'episode1',title:'첫 번째 밤',color:'#16253D',stageDefs:[],stages:{}}]})];
    state.notes=[{id:'qa-note',title:'아이디어 노트',subtitle:'사용자 서식 보존',color:'#FFB4CF',content:'<p><span style="color:#8D3399;background-color:#FFF0AA">사용자 서식</span></p>',folderId:null}];
    state.mindmaps=[readMindmap({id:'qa-map',title:'인물 관계도',color:'#CBB8FF',nodes:[{id:'node1',type:'note',title:'주인공',text:'밝은 사용자 색상',nodeColor:'#D7C0FF',x:100,y:100,w:240,h:130},{id:'node2',type:'note',title:'조력자',text:'어두운 사용자 색상',nodeColor:'#16253D',x:390,y:100,w:240,h:130}],groups:[],edges:[]})];
    state.calendarEvents=[{id:'event1',title:'밝은 일정',date:localDateKey(new Date()),endDate:localDateKey(new Date()),color:'#F6D872',repeat:'none'},{id:'event2',title:'어두운 일정',date:localDateKey(new Date()),endDate:localDateKey(new Date()),color:'#16253D',repeat:'none'}];
    state.homeWidgets=[];
    const handlers=new Map();window.__liveHandlers=handlers;
    const nativeWindow={setSize:async()=>{},setAlwaysOnTop:async()=>{},close:async()=>{},minimize:async()=>{},startDragging:async()=>{}};
    window.__TAURI__={event:{listen:async(name,cb)=>{const list=handlers.get(name)||[];list.push(cb);handlers.set(name,list);return ()=>{}},emit:async(name,payload)=>{for(const cb of handlers.get(name)||[])await cb({payload})}},window:{getCurrentWindow:()=>nativeWindow,LogicalSize:class{constructor(width,height){this.width=width;this.height=height}}}};
  });
  for(const [mode,theme] of modes){
    await live.evaluate(({mode,theme})=>{state.settings.mode=mode;state.settings.theme=theme;applyTheme(false);renderHome();refreshLucideIcons();HamTheme.refresh()},{mode,theme});
    await live.waitForTimeout(300);await live.screenshot({path:resolve(output,`home-${mode}-${theme}.png`)});
    await live.evaluate(()=>{currentProjectId='qa-project';currentEpisodeId=null;showView('board');renderBoard();HamTheme.refresh()});
    await live.waitForTimeout(300);await live.screenshot({path:resolve(output,`board-${mode}-${theme}.png`)});
    await live.evaluate(()=>{currentMindmapId='qa-map';showView('mindmap');renderMindmap();HamTheme.refresh()});
    await live.waitForTimeout(300);await live.screenshot({path:resolve(output,`mindmap-${mode}-${theme}.png`)});
  }
  // Invoke the real work-tools/sound PIP renderer, including its state event handler.
  await live.setViewportSize({width:340,height:750});
  await live.evaluate(async()=>{await startWorkToolsPipWindow();});
  for(const [mode,theme] of modes){
    await live.evaluate(async({mode,theme})=>{
      const payload={appearance:{mode,theme},modules:['sound','timer','worktimer','dday'],sound:{title:'검사용 음악',playing:true,volume:.5,duration:120,currentTime:40},timer:{items:[{id:'qa-timer',kind:'countdown',title:'집중 타이머',running:true,remainingSeconds:300}],alertChoices:[]},worktimer:{id:'qa-app',name:'글쓰기',running:true,seconds:600,programs:[]},dday:[{id:'qa-day',title:'원고 마감',value:'D-3',date:localDateKey(new Date())}],today:'2026. 9. 13.',mascot:{items:[]}};
      for(const callback of __liveHandlers.get('hamboard-work-tools-pip-state')||[])await callback({payload});
    },{mode,theme});
    await live.waitForTimeout(250);await live.screenshot({path:resolve(output,`pip-${mode}-${theme}.png`),fullPage:true});
    const pipErrors=await live.evaluate(()=>[...document.querySelectorAll('button,.work-tools-pip-work-time')].filter(el=>el.getClientRects().length&&getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)').filter(el=>HamTheme.contrast(getComputedStyle(el).backgroundColor,getComputedStyle(el).color)<4.5).map(el=>el.className));
    if(pipErrors.length)failures.push(`${mode}-${theme} rendered PIP low contrast: ${pipErrors.join(', ')}`);
  }
  await live.close();
  if(errors.length)failures.push(...errors.map(error=>'page error: '+error));
  await writeFile(resolve(output,'results.json'),JSON.stringify({browser:browser.version(),checks:results.length,failures,contrastLimitations,results},null,2));
  console.log(`Theme browser QA: ${results.length} computed-color checks; ${failures.length} failures. Browser ${browser.version()}.`);
  console.log(`Allowed-ink contrast limitations: ${contrastLimitations.length} (recorded in results.json; not a 4.5:1 conformance claim).`);
  for(const failure of failures)console.error('- '+failure);
  process.exitCode=failures.length?1:0;
} finally { await browser?.close();server.close(); }
