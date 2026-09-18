(function(){
  "use strict";

  const syncModel=window.HamboardSyncStateModel;
  const repositoryCore=window.HamboardProjectRepository;
  const googleDrive=window.HamboardMobileGoogleDrive;
  if(!syncModel||!repositoryCore)throw new Error("hamboard-mobile-dependencies-unavailable");

  const storage=repositoryCore.createIndexedDbStateStorage({databaseName:"hamboard-mobile",storeName:"state",stateKey:"mobile-core"});
  const repository=repositoryCore.createProjectRepository({storage,syncModel,clientProfile:"mobile-core"});
  const $=selector=>document.querySelector(selector);

  const libraryScreen=$("#libraryScreen");
  const projectReaderScreen=$("#projectReaderScreen");
  const noteReaderScreen=$("#noteReaderScreen");
  const mindmapReaderScreen=$("#mindmapReaderScreen");
  const menuScreen=$("#menuScreen");
  const settingsScreen=$("#settingsScreen");
  const cloudSourceScreen=$("#cloudSourceScreen");
  const backButton=$("#mobileBack");
  const title=$("#mobileTitle");
  const syncStatusWrap=$("#syncStatusWrap");
  const indicator=$("#syncIndicator");
  const offlineWarning=$("#offlineWarning");
  const librarySearch=$("#librarySearch");
  const fileInput=$("#mobileDataFile");
  const libraryNav=$("#libraryNav");
  const createNav=$("#createNav");
  const menuNav=$("#menuNav");
  const createSheet=$("#createSheet");
  const menuCloud=$("#menuCloud");
  const menuSettings=$("#menuSettings");
  const modeSetting=$("#modeSetting");
  const themeChoiceGrid=$("#themeChoiceGrid");
  const customThemeBlock=$("#customThemeBlock");
  const themePrimaryColor=$("#themePrimaryColor");
  const themeSecondaryColor=$("#themeSecondaryColor");
  const themeSwapButton=$("#themeSwapButton");
  const themePairSwap=$("#themePairSwap");
  const mobileVersion=$("#mobileVersion");
  const statusNetwork=$("#statusNetwork");
  const statusCloud=$("#statusCloud");
  const statusDocuments=$("#statusDocuments");
  const diagnosticsLog=$("#diagnosticsLog");
  const diagnosticsClear=$("#diagnosticsClear");
  const cloudDisconnect=$("#cloudDisconnect");
  const cloudSourceStatus=$("#cloudSourceStatus");
  const syncSourceMeta=$("#syncSourceMeta");
  const loadSyncSource=$("#loadSyncSource");
  const backupSourceList=$("#backupSourceList");

  let activeDocumentType="";
  let activeDocumentId="";
  let activeEpisodeId="";
  let cloudSyncListing=null;
  let cloudBackupEntries=[];
  let cloudReturnView="library";
  let silentReconnectFailed=false;
  let silentReconnectPromise=null;
  const diagnostics=[];
  const MOBILE_THEMES=Object.freeze({
    "cotton-candy":{name:"코튼캔디",a:"#B8DBFF",b:"#FFB4CF"},
    "mint-butter":{name:"멜론커스터드",a:"#BDE7C4",b:"#F7E28E"},
    "lilac-peach":{name:"포도복숭아",a:"#D7C0FF",b:"#FFD0AE"},
    "matcha-strawberry":{name:"딸기말차",a:"#C8E0B0",b:"#FFBEDA"},
    "lavender-mint":{name:"포도민트",a:"#CBB8FF",b:"#AEE9C8"},
    "coral-turquoise":{name:"자몽소다",a:"#FFB8AE",b:"#9DE8D8"},
    "choco-strawberry":{name:"초코딸기",a:"#F0B7C8",b:"#D8B9A2"},
    "apricot-sage":{name:"살구피스타치오",a:"#F3C58F",b:"#B4D6B8"},
    "butter-lilac":{name:"블루베리버터",a:"#F2DB8F",b:"#C6B2E8"}
  });
  const clone=value=>typeof structuredClone==="function"?structuredClone(value):JSON.parse(JSON.stringify(value));
  const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node};
  const safeColor=(value,fallback="#FFB8AE")=>/^#[0-9a-f]{6}$/i.test(String(value||""))?String(value):fallback;
  const safeIcon=(value,fallback)=>/^[a-z0-9-]+$/i.test(String(value||""))?String(value):fallback;
  const formatDate=value=>{const parsed=Date.parse(String(value||""));return Number.isFinite(parsed)?new Intl.DateTimeFormat("ko-KR",{year:"numeric",month:"short",day:"numeric"}).format(parsed):""};
  const stripHtml=value=>{const node=document.createElement("div");node.innerHTML=String(value||"");return (node.textContent||"").replace(/\s+/g," ").trim()};
  const refreshLucideIcons=()=>{if(window.lucide?.createIcons)window.lucide.createIcons({attrs:{"stroke-width":1.8}})};
  const colorLuminance=color=>{
    const hex=safeColor(color,"#FFB8AE").slice(1),rgb=[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16)/255);
    const linear=rgb.map(value=>value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4));
    return .2126*linear[0]+.7152*linear[1]+.0722*linear[2]
  };
  const colorContrast=(left,right)=>{
    const a=colorLuminance(left),b=colorLuminance(right);
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)
  };
  const cardForeground=color=>{
    const background=safeColor(color,"#FFB8AE"),dark="#292B38",light="#EEF0F4";
    let result=colorContrast(background,dark)>=colorContrast(background,light)?dark:light;
    if(colorContrast(background,result)<4.5){
      for(const candidate of ["#15171C","#FBFBFD"]){
        if(colorContrast(background,candidate)>colorContrast(background,result))result=candidate
      }
    }
    return result
  };
  const snapshot=()=>repository.snapshot();
  const folderName=(id,state)=>state?.folders?.find(folder=>String(folder?.id||"")===String(id||""))?.name||"";
  const allBlocks=unit=>{const result=[],walk=nodes=>(nodes||[]).forEach(node=>{result.push(node);walk(node.children)});for(const stage of unit?.stageDefs||[])walk(unit?.stages?.[stage.id]);return result};
  const projectStats=project=>{const units=project.kind==="long"?(project.episodes||[]):[project],blocks=units.flatMap(allBlocks);return {units:units.length,blocks:blocks.length,completed:blocks.filter(block=>block.completed).length}};
  const scriptLabels={dialogue:"대사",narration:"지문",background:"배경",shot:"구도",page:"페이지",cut:"컷"};

  function logDiagnostic(level,area,message,error=null){
    diagnostics.unshift({
      time:new Date().toISOString(),
      level:String(level||"info"),
      area:String(area||"APP"),
      message:String(message||""),
      detail:error?String(error?.message||error):""
    });
    if(diagnostics.length>80)diagnostics.length=80;
    if(settingsScreen&&!settingsScreen.hidden)renderDiagnostics()
  }

  function renderDiagnostics(){
    if(!diagnosticsLog)return;
    diagnosticsLog.replaceChildren();
    if(!diagnostics.length){
      diagnosticsLog.append(element("div","diagnostics-empty","현재 실행 중 기록된 진단 로그가 없습니다."));
      return
    }
    for(const entry of diagnostics){
      const row=element("div",`diagnostics-entry diagnostics-${entry.level}`);
      const head=element("div","diagnostics-entry-head");
      head.append(
        element("strong","",entry.area),
        element("time","",new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(entry.time)))
      );
      row.append(head,element("div","diagnostics-entry-message",entry.message));
      if(entry.detail)row.append(element("div","diagnostics-entry-detail",entry.detail));
      diagnosticsLog.append(row)
    }
  }

  function normalizedThemeSettings(state=snapshot()){
    const source=state?.settings&&typeof state.settings==="object"?state.settings:{};
    const theme=source.theme==="custom"||MOBILE_THEMES[source.theme]?source.theme:"cotton-candy";
    return {
      theme,
      themeCustomA:safeColor(source.themeCustomA,"#D7C0FF"),
      themeCustomB:safeColor(source.themeCustomB,"#FFD0AE"),
      themeSwapped:!!source.themeSwapped,
      mode:source.mode==="dark"?"dark":"light"
    }
  }

  function applyMobileTheme(){
    const settings=normalizedThemeSettings();
    document.body.dataset.mode=settings.mode;
    document.body.dataset.theme=settings.theme;
    document.body.dataset.themeSwapped=String(settings.themeSwapped);
    document.documentElement.style.setProperty("--custom-primary",settings.themeCustomA);
    document.documentElement.style.setProperty("--custom-secondary",settings.themeCustomB);
    const pair=settings.theme==="custom"
      ?{a:settings.themeCustomA,b:settings.themeCustomB}
      :MOBILE_THEMES[settings.theme]||MOBILE_THEMES["cotton-candy"];
    const primary=settings.themeSwapped?pair.b:pair.a;
    const secondary=settings.themeSwapped?pair.a:pair.b;
    document.documentElement.style.setProperty("--theme-primary-base",primary);
    document.documentElement.style.setProperty("--theme-secondary-base",secondary);
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute("content",settings.mode==="dark"?"#15171c":"#fbfbfd")
  }

  async function saveThemeSettings(patch){
    const state=snapshot(),current=state.settings&&typeof state.settings==="object"?state.settings:{};
    state.settings={...current,...patch};
    await repository.replaceState(state);
    applyMobileTheme();
    renderSettings()
  }

  function renderSettings(){
    const settings=normalizedThemeSettings(),cloud=googleDrive?.status?.()||{};
    for(const button of modeSetting?.querySelectorAll("[data-mode-value]")||[]){
      button.classList.toggle("active",button.dataset.modeValue===settings.mode)
    }
    themeChoiceGrid?.replaceChildren();
    if(themeChoiceGrid){
      for(const [key,theme] of Object.entries(MOBILE_THEMES)){
        const button=element("button",`theme-choice${settings.theme===key?" active":""}`);
        button.type="button";
        button.dataset.themeKey=key;
        button.innerHTML=`<span class="theme-choice-preview" style="--theme-a:${theme.a};--theme-b:${theme.b}"></span><span>${theme.name}</span>`;
        button.onclick=()=>saveThemeSettings({theme:key});
        themeChoiceGrid.append(button)
      }
      const custom=element("button",`theme-choice${settings.theme==="custom"?" active":""}`);
      custom.type="button";
      custom.dataset.themeKey="custom";
      custom.innerHTML='<span class="theme-choice-preview theme-choice-custom"><i data-lucide="palette" aria-hidden="true"></i></span><span>직접 선택</span>';
      custom.onclick=()=>saveThemeSettings({theme:"custom"});
      themeChoiceGrid.append(custom)
    }
    customThemeBlock.hidden=settings.theme!=="custom";
    themePrimaryColor.value=settings.themeCustomA;
    themeSecondaryColor.value=settings.themeCustomB;
    mobileVersion.textContent=String(window.HAMBOARD_MOBILE_CONFIG?.version||"1.0.0");
    statusNetwork.textContent=navigator.onLine===false?"오프라인":"온라인";
    statusCloud.textContent=cloud.connected?"연결됨":cloud.authorized?"재연결 가능":"로그인 안 됨";
    statusDocuments.textContent=`${documentCount()}개`;
    renderDiagnostics();
    refreshLucideIcons()
  }

  function cloudErrorMessage(error){
    const text=String(error?.message||error||"");
    if(text.includes("web-client-id-not-configured"))return "로그인 설정을 불러오지 못했습니다. 배포 설정을 확인해 주세요.";
    if(text.includes("secure-origin-required"))return "로그인은 보안 연결에서만 사용할 수 있습니다.";
    if(text.includes("popup_closed")||text.includes("popup-failed"))return "로그인 창이 닫혔습니다. 다시 시도해 주세요.";
    if(text.includes("access_denied"))return "클라우드 접근 권한이 허용되지 않았습니다.";
    if(text.includes("branched-history"))return "동기화 기록이 갈라져 있어 PC에서 먼저 충돌을 해결해야 합니다.";
    if(text.includes("download-integrity")||text.includes("commit-")||text.includes("backup-"))return "클라우드 데이터 검증에 실패했습니다. PC에서 다시 저장한 뒤 시도해 주세요.";
    if(text.includes("http-401")||text.includes("reconnect-required")||text.includes("not-connected"))return "계정 연결이 만료되었습니다. 다시 연결해 주세요.";
    return "클라우드에서 데이터를 불러오지 못했습니다. 네트워크와 연결 상태를 확인해 주세요."
  }

  function setIndicator(state,text){indicator.dataset.state=state;indicator.textContent=text}
  function setStatus(message,{action="",run=null}={}){
    const status=$("#libraryStatus");
    status.replaceChildren(document.createTextNode(message));
    if(action&&run){const button=element("button","",action);button.type="button";button.onclick=run;status.append(button)}
    status.hidden=false
  }
  function hideStatus(){$("#libraryStatus").hidden=true}
  function metaChip(text){return element("span","meta-chip",text)}
  function documentScreen(type){
    return type==="project"?projectReaderScreen:type==="note"?noteReaderScreen:type==="mindmap"?mindmapReaderScreen:null
  }
  function hideDocumentScreens(){for(const screen of [projectReaderScreen,noteReaderScreen,mindmapReaderScreen])screen.hidden=true}
  const appBaseUrl=()=>location.pathname+location.search;
  function appRouteUrl(route){
    return route?.view==="document"&&route.type&&route.id?`${appBaseUrl()}#${route.type}/${encodeURIComponent(route.id)}`:appBaseUrl()
  }
  function writeRoute(route,{replace=false}={}){
    const state={hamboard:true,...route};
    history[replace?"replaceState":"pushState"](state,"",appRouteUrl(state))
  }
  function documentCount(state=snapshot()){return (state.projects||[]).length+(state.notes||[]).length+(state.mindmaps||[]).length}
  function hideAllScreens(){for(const screen of [libraryScreen,projectReaderScreen,noteReaderScreen,mindmapReaderScreen,menuScreen,settingsScreen,cloudSourceScreen])screen.hidden=true}
  function activateNav(name=""){libraryNav.classList.toggle("active",name==="library");menuNav.classList.toggle("active",name==="menu")}
  function showScreen(screen,{heading="햄보드",back=false,account=false,nav=""}={}){
    hideAllScreens();
    screen.hidden=false;
    backButton.hidden=!back;
    syncStatusWrap.hidden=!account;
    title.textContent=heading;
    activateNav(nav);
    window.scrollTo(0,0);
    refreshLucideIcons()
  }
  function renderAccountButton(){
    const status=googleDrive?.status?.()||{configured:false,connected:false,authorized:false};
    const online=navigator.onLine!==false;
    offlineWarning.hidden=online;
    if(!online){setIndicator("error","오프라인");return {...status,online:false}}
    if(!status.configured){setIndicator("error","설정 필요");return {...status,online:true}}
    if(status.connected){setIndicator("connected","동기화 중");return {...status,online:true}}
    if(status.authorized&&!silentReconnectFailed){setIndicator("connected","동기화 중");return {...status,online:true,reconnecting:true}}
    setIndicator("local","로그인");
    return {...status,online:true}
  }

  async function restoreGoogleConnection(){
    const status=googleDrive?.status?.()||{configured:false,connected:false,authorized:false};
    if(!status.configured||status.connected||!status.authorized||silentReconnectFailed||navigator.onLine===false)return status;
    if(silentReconnectPromise)return silentReconnectPromise;
    silentReconnectFailed=false;
    renderAccountButton();
    silentReconnectPromise=(async()=>{
      try{
        const next=await googleDrive.reconnectSilently();
        silentReconnectFailed=!next?.connected;
        return next
      }catch(error){
        silentReconnectFailed=true;
        console.warn("모바일 클라우드 자동 재연결 실패",error);
        logDiagnostic("warn","CLOUD","자동 재연결에 실패했습니다.",error);
        return googleDrive.status()
      }finally{
        silentReconnectPromise=null;
        renderAccountButton()
      }
    })();
    return silentReconnectPromise
  }
  function formatCloudTime(value){
    const numeric=Number(value),date=Number.isFinite(numeric)&&numeric>0?new Date(numeric):new Date(String(value||""));
    return Number.isNaN(date.getTime())?"날짜 정보 없음":new Intl.DateTimeFormat("ko-KR",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(date)
  }

  function libraryDocuments(state=snapshot()){
    const items=[];
    (state.projects||[]).forEach((item,index)=>items.push({type:"project",item,fallback:index}));
    (state.mindmaps||[]).forEach((item,index)=>items.push({type:"mindmap",item,fallback:10000+index}));
    (state.notes||[]).forEach((item,index)=>items.push({type:"note",item,fallback:20000+index}));
    return items.sort((left,right)=>(Date.parse(right.item?.updatedAt||"")||0)-(Date.parse(left.item?.updatedAt||"")||0)||left.fallback-right.fallback)
  }

  function documentDescriptor(type,item,state=snapshot()){
    const folder=item.folderId?folderName(item.folderId,state):"";
    if(type==="project"){
      const stats=projectStats(item);
      return {
        kind:item.kind==="long"?"장편":"단편",
        icon:safeIcon(item.icon,"scroll-text"),
        color:safeColor(item.color,"#FFB8AE"),
        subtitle:String(item.subtitle||""),
        folder,
        meta:item.kind==="long"?`${stats.units}화 · ${stats.blocks}개 블록`:`${(item.stageDefs||[]).length}파트 · ${stats.blocks}개 블록`
      }
    }
    if(type==="mindmap")return {
      kind:"마인드맵",icon:safeIcon(item.icon,"network"),color:safeColor(item.color,"#FFCBA8"),subtitle:String(item.subtitle||""),folder,
      meta:`${(item.nodes||[]).length}개 노드 · ${(item.edges||[]).length}개 연결`
    };
    return {
      kind:"노트",icon:safeIcon(item.icon,"notebook-text"),color:safeColor(item.color,"#F6D872"),subtitle:String(item.subtitle||""),folder,
      meta:""
    }
  }

  function renderLibrary(){
    const state=snapshot(),query=librarySearch.value.trim().toLocaleLowerCase("ko"),allDocuments=libraryDocuments(state);
    const documents=query?allDocuments.filter(({type,item})=>{
      const descriptor=documentDescriptor(type,item,state);
      const extra=type==="note"?stripHtml(item.content||""):type==="mindmap"?(item.nodes||[]).map(node=>`${node.title||""} ${node.text||""}`).join(" "):"";
      return `${item.title||""} ${descriptor.subtitle} ${descriptor.folder} ${extra}`.toLocaleLowerCase("ko").includes(query)
    }):allDocuments;
    const host=$("#libraryList");
    host.replaceChildren();
    if(!allDocuments.length){
      setStatus("동기화된 작품, 노트 또는 마인드맵이 아직 없습니다.",{action:"데이터 파일 불러오기",run:()=>fileInput.click()});
      refreshLucideIcons();
      return
    }
    if(query&&!documents.length){
      setStatus("검색 결과가 없습니다.");
      return
    }
    hideStatus();
    for(const entry of documents){
      const {type,item}=entry,descriptor=documentDescriptor(type,item,state),button=element("button",`project-card ${type==="project"?"story-card":type==="note"?"note-card":"mindmap-card"}`);
      button.type="button";
      button.dataset.documentType=type;
      button.dataset.documentId=String(item.id||"");
      button.style.setProperty("--card-color",descriptor.color);
      const cardInk=cardForeground(descriptor.color);
      button.style.setProperty("--custom-on",cardInk);
      button.style.setProperty("--custom-muted",cardInk);

      const veil=element("span","card-dark-veil");
      veil.setAttribute("aria-hidden","true");
      const folder=element("div","project-folder");
      const icon=element("span","project-card-icon");
      icon.innerHTML=`<i data-lucide="${descriptor.icon}" aria-hidden="true"></i>`;
      const label=element("span","");
      const kind=element("span","project-kind",descriptor.kind);
      label.append(kind);
      if(descriptor.folder)label.append(document.createTextNode(` · ${descriptor.folder}`));
      folder.append(icon,label);

      const heading=element("div","project-title",item.title||(
        type==="project"?"제목 없는 작품":type==="note"?"제목 없는 노트":"제목 없는 마인드맵"
      ));
      button.append(veil,folder,heading);
      if(descriptor.subtitle)button.append(element("div","work-card-subtitle",descriptor.subtitle));
      if(descriptor.meta)button.append(element("div","project-meta",descriptor.meta));
      button.onclick=()=>openDocument(type,item.id);
      host.append(button)
    }
    refreshLucideIcons()
  }

  function blockElement(block){
    const card=element("article","block-card"),head=element("div","block-head"),heading=element("h5","",block.title||(block.type==="script"?"제목 없는 스크립트":"제목 없는 블록"));
    head.append(heading);
    if(block.completed)head.append(element("span","complete-badge","완료"));
    card.append(head);
    if(block.type==="script"){
      const lines=element("div","script-lines");
      for(const line of block.scriptBlocks||[]){
        if(!String(line?.text||"").trim()&&!String(line?.speaker||"").trim())continue;
        const row=element("div","script-line"),label=element("span","script-line-label",scriptLabels[line.type]||"지문"),body=element("span","");
        if(line.type==="dialogue"&&line.speaker)body.append(element("span","script-speaker",`${line.speaker} · `));
        body.append(document.createTextNode(String(line.text||"")));
        row.append(label,body);
        lines.append(row)
      }
      if(lines.childElementCount)card.append(lines)
    }else if(block.summary)card.append(element("p","block-text",block.summary));
    if(block.notes)card.append(element("div","block-notes",block.notes));
    if((block.children||[]).length){
      const children=element("div","child-blocks");
      for(const child of block.children)children.append(blockElement(child));
      card.append(children)
    }
    return card
  }

  function renderUnit(unit,index=0){
    const host=$("#projectContent");
    host.replaceChildren();
    const heading=element("div","unit-heading"),name=unit.title||`${index+1}화`;
    heading.append(element("h3","",name));
    if(unit.subtitle)heading.append(element("p","",unit.subtitle));
    host.append(heading);
    for(const stage of unit.stageDefs||[]){
      const section=element("section","stage-section"),stageHead=element("header","stage-heading"),stripe=element("span","stage-color"),copy=element("div","");
      stripe.style.setProperty("--stage-color",safeColor(stage.color,"#A9D6FF"));
      copy.append(element("h4","",stage.name||"파트"));
      if(stage.hint)copy.append(element("p","",stage.hint));
      stageHead.append(stripe,copy);
      const blocks=element("div","block-list"),items=Array.isArray(unit.stages?.[stage.id])?unit.stages[stage.id]:[];
      if(items.length)for(const block of items)blocks.append(blockElement(block));
      else blocks.append(element("div","empty-stage","등록된 블록이 없습니다."));
      section.append(stageHead,blocks);
      host.append(section)
    }
  }

  function renderProject(project){
    const stats=projectStats(project);
    $("#readerKind").textContent=project.kind==="long"?"장편 작품":"단편 작품";
    $("#readerTitle").textContent=project.title||"제목 없는 작품";
    $("#readerSubtitle").textContent=project.subtitle||"";
    $("#readerSubtitle").hidden=!project.subtitle;
    const meta=$("#readerMeta");
    meta.replaceChildren(metaChip(`${stats.blocks}개 블록`));
    if(stats.blocks)meta.append(metaChip(`${stats.completed}개 완료`));
    if(project.deadline)meta.append(metaChip(`마감 ${project.deadline}`));
    if(project.updatedAt){const date=formatDate(project.updatedAt);if(date)meta.append(metaChip(`${date} 수정`))}
    const episodes=$("#episodeList");
    episodes.replaceChildren();
    if(project.kind==="long"){
      const list=project.episodes||[];
      if(!list.length){$("#projectContent").replaceChildren(element("div","status-card","등록된 화가 없습니다."));return}
      if(!list.some(item=>String(item.id)===activeEpisodeId))activeEpisodeId=String(list[0].id);
      list.forEach((episode,index)=>{
        const button=element("button",`episode-button${String(episode.id)===activeEpisodeId?" active":""}`);
        button.type="button";
        const stripe=element("span","episode-color");
        stripe.style.setProperty("--episode-color",safeColor(episode.color,"#A9D6FF"));
        const copy=element("span","episode-copy");
        copy.append(element("strong","",episode.title||`${index+1}화`),element("span","",episode.subtitle||`${allBlocks(episode).length}개 블록`));
        button.append(stripe,copy,element("span","episode-number",`${index+1}화`));
        button.onclick=()=>{activeEpisodeId=String(episode.id);renderProject(project);window.scrollTo({top:0,behavior:"smooth"})};
        episodes.append(button)
      });
      const active=list.find(item=>String(item.id)===activeEpisodeId);
      renderUnit(active,list.findIndex(item=>String(item.id)===activeEpisodeId))
    }else{
      activeEpisodeId="";
      renderUnit(project)
    }
  }

  function sanitizedNoteHtml(value){
    const template=document.createElement("template");
    template.innerHTML=String(value||"");
    template.content.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach(node=>node.remove());
    template.content.querySelectorAll("*").forEach(node=>{
      for(const attribute of [...node.attributes]){
        const name=attribute.name.toLowerCase(),raw=String(attribute.value||"").trim();
        if(name.startsWith("on")||name==="srcdoc"||name==="contenteditable"||name==="id")node.removeAttribute(attribute.name);
        else if((name==="href"||name==="src")&&/^javascript:/i.test(raw))node.removeAttribute(attribute.name)
      }
    });
    return template.innerHTML
  }

  function renderNote(note){
    $("#noteReaderTitle").textContent=note.title||"제목 없는 노트";
    $("#noteReaderSubtitle").textContent=note.subtitle||"";
    $("#noteReaderSubtitle").hidden=!note.subtitle;
    const meta=$("#noteReaderMeta");
    meta.replaceChildren();
    if(note.deadline)meta.append(metaChip(`마감 ${note.deadline}`));
    if(note.updatedAt){const date=formatDate(note.updatedAt);if(date)meta.append(metaChip(`${date} 수정`))}
    const content=$("#noteReaderContent");
    content.innerHTML=sanitizedNoteHtml(note.content||"");
    if(!stripHtml(note.content||""))content.replaceChildren(element("div","empty-document","내용이 없는 노트입니다."))
  }

  function renderMindmap(mindmap){
    $("#mindmapReaderTitle").textContent=mindmap.title||"제목 없는 마인드맵";
    $("#mindmapReaderSubtitle").textContent=mindmap.subtitle||"";
    $("#mindmapReaderSubtitle").hidden=!mindmap.subtitle;
    const meta=$("#mindmapReaderMeta");
    meta.replaceChildren(metaChip(`${(mindmap.nodes||[]).length}개 노드`),metaChip(`${(mindmap.edges||[]).length}개 연결`));
    if(mindmap.deadline)meta.append(metaChip(`마감 ${mindmap.deadline}`));

    const canvas=$("#mindmapReaderCanvas"),nodesHost=$("#mindmapReaderNodes"),edgesHost=$("#mindmapReaderEdges");
    nodesHost.replaceChildren();
    edgesHost.replaceChildren();
    const nodes=Array.isArray(mindmap.nodes)?mindmap.nodes:[],groups=Array.isArray(mindmap.groups)?mindmap.groups:[];
    if(!nodes.length&&!groups.length){
      canvas.style.width="100%";
      canvas.style.height="220px";
      nodesHost.append(element("div","empty-mindmap","등록된 노드가 없습니다."));
      return
    }
    const all=[...groups,...nodes],minX=Math.min(...all.map(item=>Number(item.x)||0)),minY=Math.min(...all.map(item=>Number(item.y)||0));
    const maxX=Math.max(...all.map(item=>(Number(item.x)||0)+(Number(item.w)||220))),maxY=Math.max(...all.map(item=>(Number(item.y)||0)+(Number(item.h)||130)));
    const scale=.62,pad=28,width=Math.max(320,(maxX-minX)*scale+pad*2),height=Math.max(260,(maxY-minY)*scale+pad*2);
    canvas.style.width=`${width}px`;
    canvas.style.height=`${height}px`;
    edgesHost.setAttribute("width",String(width));
    edgesHost.setAttribute("height",String(height));
    edgesHost.setAttribute("viewBox",`0 0 ${width} ${height}`);

    const positions=new Map(),position=item=>{
      const x=(Number(item.x||0)-minX)*scale+pad,y=(Number(item.y||0)-minY)*scale+pad,w=Math.max(96,Number(item.w||220)*scale),h=Math.max(58,Number(item.h||130)*scale);
      return {x,y,w,h,cx:x+w/2,cy:y+h/2}
    };
    for(const group of groups){
      const pos=position(group),box=element("div","mindmap-readonly-group");
      Object.assign(box.style,{left:`${pos.x}px`,top:`${pos.y}px`,width:`${pos.w}px`,height:`${pos.h}px`});
      if(group.color)box.style.setProperty("--node-color",safeColor(group.color,"#CBB8FF"));
      box.append(element("strong","",group.title||"그룹"));
      nodesHost.append(box)
    }
    for(const node of nodes){
      const pos=position(node),box=element("article","mindmap-readonly-node");
      positions.set(String(node.id||""),pos);
      Object.assign(box.style,{left:`${pos.x}px`,top:`${pos.y}px`,width:`${pos.w}px`,minHeight:`${pos.h}px`});
      if(node.nodeColor||node.color)box.style.setProperty("--node-color",safeColor(node.nodeColor||node.color,"#ffffff"));
      const kind=element("span","mindmap-node-kind",String(node.type||"노드"));
      const label=element("strong","",node.title||node.text||node.assetName||"노드");
      box.append(kind,label);
      if(node.title&&node.text)box.append(element("p","",node.text));
      nodesHost.append(box)
    }
    for(const edge of mindmap.edges||[]){
      const from=positions.get(String(edge.from||"")),to=positions.get(String(edge.to||""));
      if(!from||!to)continue;
      const line=document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1",String(from.cx));line.setAttribute("y1",String(from.cy));line.setAttribute("x2",String(to.cx));line.setAttribute("y2",String(to.cy));
      line.setAttribute("class","mindmap-readonly-edge");
      if(edge.color)line.setAttribute("style",`stroke:${safeColor(edge.color,"#785b9f")}`);
      edgesHost.append(line)
    }
  }

  function renderDocument(type,id){
    const state=snapshot(),key=String(id||"");
    const item=type==="project"?(state.projects||[]).find(entry=>String(entry?.id||"")===key):type==="note"?(state.notes||[]).find(entry=>String(entry?.id||"")===key):(state.mindmaps||[]).find(entry=>String(entry?.id||"")===key);
    if(!item){renderHome();return}
    activeDocumentType=type;
    activeDocumentId=key;
    activeEpisodeId="";
    const screen=documentScreen(type);
    showScreen(screen,{heading:item.title||(type==="project"?"작품":type==="note"?"노트":"마인드맵"),back:true,account:false,nav:"library"});
    if(type==="project")renderProject(item);
    else if(type==="note")renderNote(item);
    else renderMindmap(item)
  }

  function renderHome(){
    activeDocumentType="";
    activeDocumentId="";
    activeEpisodeId="";
    showScreen(libraryScreen,{heading:"홈",back:false,account:true,nav:"library"});
    renderAccountButton();
    restoreGoogleConnection();
    renderLibrary()
  }

  function openDocument(type,id,{replace=false}={}){
    renderDocument(type,id);
    writeRoute({view:"document",type,id:String(id||"")},{replace})
  }

  function openLibrary({replace=false}={}){
    renderHome();
    writeRoute({view:"home"},{replace})
  }

  function closeDocument(){history.back()}

  function renderMenu(){
    activeDocumentType="";
    activeDocumentId="";
    activeEpisodeId="";
    showScreen(menuScreen,{heading:"메뉴",back:true,account:false,nav:"menu"})
  }

  function openMenu({replace=false}={}){
    renderMenu();
    writeRoute({view:"menu"},{replace})
  }

  function renderSettingsScreen(){
    activeDocumentType="";
    activeDocumentId="";
    activeEpisodeId="";
    showScreen(settingsScreen,{heading:"설정",back:true,account:false,nav:"menu"});
    renderSettings()
  }

  function openSettings({replace=false}={}){
    renderSettingsScreen();
    writeRoute({view:"settings"},{replace})
  }

  async function importCanonicalState(source){
    const canonical=source?.format==="hamboard-cloud-backup"&&source.state?source.state:source?.state&&typeof source.state==="object"?source.state:source;
    if(!canonical||typeof canonical!=="object"||Array.isArray(canonical))throw new Error("mobile-state-invalid");
    const projection=syncModel.projectCanonicalState(canonical,syncModel.CLIENT_PROFILES.mobileCore);
    await repository.replaceState(projection,{markBaseline:true});
    applyMobileTheme();
    renderAccountButton();
    renderLibrary();
    return snapshot()
  }

  async function applyCloudCommits(commits=[]){
    for(const commit of commits)await repository.applyCommit(commit);
    repository.markSynced();
    applyMobileTheme();
    renderAccountButton();
    renderLibrary();
    return snapshot()
  }

  function commitTopology(objects=[]){
    const commits=objects.filter(item=>item?.syncType==="commit"&&item.revision&&String(item.objectKey||"").startsWith("sync/commits/")),byRevision=new Map();
    for(const item of commits){const revision=String(item.revision);if(byRevision.has(revision))throw new Error("sync-import-duplicate-revision");byRevision.set(revision,item)}
    const parents=new Set(commits.map(item=>String(item.baseRevision||"")).filter(Boolean)),heads=commits.filter(item=>!parents.has(String(item.revision)));
    if(!commits.length)return {head:null,path:[]};
    if(heads.length!==1)throw new Error("sync-import-branched-history");
    const reverse=[],seen=new Set();let cursor=heads[0];
    while(cursor){
      const revision=String(cursor.revision);
      if(seen.has(revision))throw new Error("sync-import-revision-cycle");
      seen.add(revision);reverse.push(cursor);
      const parent=String(cursor.baseRevision||"");
      if(!parent)break;
      cursor=byRevision.get(parent);
      if(!cursor)throw new Error("sync-import-missing-parent")
    }
    return {head:heads[0],path:reverse.reverse()}
  }

  async function readCloudCommit(object){
    const result=await googleDrive.getSyncObject({remoteObjectId:String(object.remoteObjectId||""),objectKey:String(object.objectKey||""),contentSha256:String(object.contentSha256||""),byteSize:Number(object.byteSize)||0});
    let commit;
    try{commit=JSON.parse(String(result.content||""))}catch{throw new Error("sync-commit-json-invalid")}
    if(commit?.format!=="hamboard-sync-commit"||commit?.formatVersion!==1||commit?.stateSchemaVersion!==1||String(commit.revision||"")!==String(object.revision||"")||String(commit.baseRevision||"")!==String(object.baseRevision||"")||!Array.isArray(commit.changes))throw new Error("sync-commit-header-invalid");
    const profile=syncModel.clientProfileForCommit(commit),profileId=syncModel.clientProfileId(profile);
    if(object.clientProfile&&String(object.clientProfile)!==profileId)throw new Error("sync-commit-client-profile-mismatch");
    syncModel.validateClientChanges(commit.changes,profile);
    for(const change of commit.changes){
      if(change?.operation!=="upsert")continue;
      const bytes=new TextEncoder().encode(JSON.stringify(change.payload)),hash=await googleDrive.sha256Hex(bytes);
      if(hash!==String(change.payloadSha256||""))throw new Error("sync-commit-payload-hash-mismatch")
    }
    commit.clientProfile=profileId;
    return commit
  }

  async function syncFromCloud(listing=cloudSyncListing){
    if(!googleDrive)throw new Error("google-drive-web-transport-unavailable");
    if(!listing)listing=await googleDrive.listSyncObjects();
    if(listing.truncated)throw new Error("sync-object-list-truncated");
    const topology=commitTopology(listing.objects||[]);
    if(!topology.head)throw new Error("sync-import-empty");

    if(navigator.onLine!==false)setIndicator("connected","동기화 중");
    cloudSourceStatus.hidden=false;
    let projected=syncModel.projectCanonicalState({},syncModel.CLIENT_PROFILES.mobileCore);
    for(let index=0;index<topology.path.length;index++){
      const percent=Math.round(((index+1)/topology.path.length)*100);
      cloudSourceStatus.textContent=`동기화 데이터를 불러오는 중입니다. ${percent}%`;
      const commit=await readCloudCommit(topology.path[index]),result=syncModel.applyCommitToClientState(projected,commit,syncModel.CLIENT_PROFILES.mobileCore);
      projected=result.state
    }
    await repository.replaceState(projected,{markBaseline:true});
    applyMobileTheme();
    cloudSyncListing=listing;
    renderAccountButton();
    openLibrary();
    return {empty:false,revision:String(topology.head.revision),state:snapshot()}
  }

  function setCloudSourceBusy(busy){
    loadSyncSource.disabled=busy||!cloudSyncListing;
    cloudDisconnect.disabled=busy;
    backupSourceList.querySelectorAll("button").forEach(button=>button.disabled=busy)
  }

  function renderBackupSources(entries=[]){
    backupSourceList.replaceChildren();
    if(!entries.length){
      backupSourceList.append(element("div","cloud-source-empty","저장된 수동 백업이 없습니다."));
      return
    }
    for(const entry of entries){
      const button=element("button","backup-source-entry");
      button.type="button";
      button.dataset.remoteObjectId=String(entry.remoteObjectId||"");
      const icon=element("span","backup-source-icon");
      icon.innerHTML='<i data-lucide="archive-restore" aria-hidden="true"></i>';
      const copy=element("span","backup-source-copy");
      copy.append(element("strong","",formatCloudTime(entry.createdTime)),element("small","","수동 백업"));
      const arrow=element("span","backup-source-arrow");
      arrow.innerHTML='<i data-lucide="chevron-right" aria-hidden="true"></i>';
      button.append(icon,copy,arrow);
      button.onclick=()=>loadBackupSource(entry);
      backupSourceList.append(button)
    }
    refreshLucideIcons()
  }

  async function refreshCloudSources(){
    if(!googleDrive?.status?.().connected)return;
    cloudSourceStatus.hidden=false;
    cloudSourceStatus.textContent="클라우드 데이터를 확인하고 있습니다.";
    syncSourceMeta.textContent="확인 중…";
    loadSyncSource.disabled=true;
    backupSourceList.replaceChildren(element("div","cloud-source-empty","백업 복원 목록을 확인하고 있습니다."));
    const [syncResult,backupResult]=await Promise.allSettled([googleDrive.listSyncObjects(),googleDrive.listBackups()]);
    const problems=[];

    cloudSyncListing=null;
    if(syncResult.status==="fulfilled"){
      try{
        if(syncResult.value.truncated)throw new Error("sync-object-list-truncated");
        const topology=commitTopology(syncResult.value.objects||[]);
        if(topology.head){
          cloudSyncListing=syncResult.value;
          syncSourceMeta.textContent=`최근 동기화 · ${formatCloudTime(topology.head.createdAtMs)}`;
          loadSyncSource.disabled=false
        }else syncSourceMeta.textContent="저장된 동기화 데이터가 없습니다."
      }catch(error){
        console.error("모바일 동기화 목록 확인 실패",error);
        logDiagnostic("error","CLOUD","동기화 목록 확인에 실패했습니다.",error);
        syncSourceMeta.textContent="동기화 기록을 확인할 수 없습니다.";
        problems.push("동기화 데이터")
      }
    }else{
      console.error("모바일 동기화 목록 확인 실패",syncResult.reason);
      logDiagnostic("error","CLOUD","동기화 데이터 확인에 실패했습니다.",syncResult.reason);
      syncSourceMeta.textContent="동기화 데이터를 확인하지 못했습니다.";
      problems.push("동기화 데이터")
    }

    cloudBackupEntries=[];
    if(backupResult.status==="fulfilled"){
      cloudBackupEntries=Array.isArray(backupResult.value.backups)?backupResult.value.backups:[];
      renderBackupSources(cloudBackupEntries);
      if(backupResult.value.truncated)problems.push("일부 백업 목록")
    }else{
      console.error("모바일 백업 목록 확인 실패",backupResult.reason);
      logDiagnostic("error","CLOUD","수동 백업 목록 확인에 실패했습니다.",backupResult.reason);
      backupSourceList.replaceChildren(element("div","cloud-source-empty","백업 복원 목록을 확인하지 못했습니다."));
      problems.push("수동 백업")
    }

    if(problems.length){
      cloudSourceStatus.hidden=false;
      cloudSourceStatus.textContent=`${problems.join(", ")} 확인에 문제가 있습니다. 필요하면 다시 연결해 주세요.`
    }else{
      cloudSourceStatus.hidden=true;
      cloudSourceStatus.textContent=""
    }
    renderAccountButton()
  }

  async function loadBackupSource(entry){
    setCloudSourceBusy(true);
    const activeButton=[...backupSourceList.querySelectorAll(".backup-source-entry")].find(button=>button.dataset.remoteObjectId===String(entry.remoteObjectId||""));
    if(activeButton){
      activeButton.classList.add("loading");
      const statusText=activeButton.querySelector(".backup-source-copy small");
      const arrow=activeButton.querySelector(".backup-source-arrow");
      if(statusText)statusText.textContent="불러오는 중…";
      if(arrow)arrow.innerHTML='<i data-lucide="loader-circle" aria-hidden="true"></i>';
      refreshLucideIcons()
    }
    cloudSourceStatus.hidden=false;
    cloudSourceStatus.textContent="선택한 백업을 불러오는 중입니다.";
    try{
      const manifest=await googleDrive.getBackupManifest(entry);
      await importCanonicalState(manifest);
      renderAccountButton();
      openLibrary()
    }catch(error){
      console.error("모바일 백업 불러오기 실패",error);
      logDiagnostic("error","CLOUD","수동 백업 불러오기에 실패했습니다.",error);
      cloudSourceStatus.textContent=cloudErrorMessage(error);
      renderBackupSources(cloudBackupEntries);
      if(String(error?.message||"").includes("reconnect"))renderAccountButton()
    }finally{
      setCloudSourceBusy(false)
    }
  }

  async function loadSelectedSync(){
    setCloudSourceBusy(true);
    cloudSourceStatus.hidden=false;
    try{
      await syncFromCloud(cloudSyncListing)
    }catch(error){
      console.error("모바일 동기화 데이터 불러오기 실패",error);
      logDiagnostic("error","CLOUD","동기화 데이터 불러오기에 실패했습니다.",error);
      renderAccountButton();
      cloudSourceStatus.textContent=cloudErrorMessage(error)
    }finally{
      setCloudSourceBusy(false)
    }
  }

  async function openCloudSources(returnView="library",{replace=false}={}){
    cloudReturnView=returnView==="menu"?"menu":"library";
    let status=renderAccountButton();
    if(!status.online){
      cloudReturnView==="menu"?renderMenu():renderHome();
      return
    }
    if(!status.configured){
      cloudReturnView==="menu"?renderMenu():renderHome();
      return
    }
    if(!status.connected&&status.authorized&&!silentReconnectFailed){
      await restoreGoogleConnection();
      status=renderAccountButton()
    }
    if(!status.connected){
      setIndicator("local","로그인");
      try{
        await googleDrive.connect();
        silentReconnectFailed=false;
        status=renderAccountButton()
      }catch(error){
        console.error("모바일 클라우드 로그인 실패",error);
        logDiagnostic("error","CLOUD","클라우드 로그인에 실패했습니다.",error);
        silentReconnectFailed=true;
        renderAccountButton();
        cloudReturnView==="menu"?renderMenu():renderHome();
        return
      }
    }
    showScreen(cloudSourceScreen,{heading:"클라우드",back:true,account:false,nav:cloudReturnView==="menu"?"menu":"library"});
    writeRoute({view:"cloud",returnView:cloudReturnView},{replace});
    await refreshCloudSources()
  }

  function openBottomSheet(sheet){if(sheet){sheet.hidden=false;refreshLucideIcons()}}
  function closeBottomSheet(sheet){if(sheet)sheet.hidden=true}

  function renderRoute(route){
    if(!route||route.hamboard!==true){renderHome();return}
    if(route.view==="document"){renderDocument(route.type,route.id);return}
    if(route.view==="menu"){renderMenu();return}
    if(route.view==="settings"){renderSettingsScreen();return}
    if(route.view==="cloud"){
      cloudReturnView=route.returnView==="menu"?"menu":"library";
      showScreen(cloudSourceScreen,{heading:"클라우드",back:true,account:false,nav:cloudReturnView==="menu"?"menu":"library"});
      if(googleDrive?.status?.().connected)refreshCloudSources();
      else cloudReturnView==="menu"?renderMenu():renderHome();
      return
    }
    renderHome()
  }

  function handleBack(){
    if(history.state?.hamboard&&history.state.view!=="home")history.back();
    else renderHome()
  }

  async function start(){
    try{
      await repository.load();
      applyMobileTheme();
      logDiagnostic("info","APP","모바일 저장소를 열었습니다.");
      const match=location.hash.match(/^#(project|note|mindmap)\/(.+)$/);
      history.replaceState({hamboard:true,view:"home"},"",appBaseUrl());
      renderHome();
      restoreGoogleConnection();
      if(match)openDocument(match[1],decodeURIComponent(match[2]));
      refreshLucideIcons()
    }catch(error){
      console.error("모바일 저장소를 열지 못했습니다.",error);
      logDiagnostic("error","REPOSITORY","모바일 저장소를 열지 못했습니다.",error);
      setStatus("모바일 저장소를 열지 못했습니다. 브라우저의 사이트 데이터 설정을 확인해 주세요.")
    }
  }

  backButton.onclick=handleBack;
  libraryNav.onclick=()=>{if(history.state?.view!=="home")openLibrary()};
  createNav.onclick=()=>openBottomSheet(createSheet);
  menuNav.onclick=()=>{if(history.state?.view!=="menu")openMenu()};
  $("#createSheetClose").onclick=()=>closeBottomSheet(createSheet);
  createSheet.onclick=event=>{if(event.target===createSheet)closeBottomSheet(createSheet)};
  librarySearch.addEventListener("input",renderLibrary);
  menuCloud.onclick=()=>openCloudSources("menu");
  menuSettings.onclick=()=>openSettings();
  modeSetting.onclick=event=>{
    const button=event.target.closest("[data-mode-value]");
    if(button)saveThemeSettings({mode:button.dataset.modeValue==="dark"?"dark":"light"})
  };
  themePrimaryColor.oninput=()=>saveThemeSettings({theme:"custom",themeCustomA:safeColor(themePrimaryColor.value,"#D7C0FF")});
  themeSecondaryColor.oninput=()=>saveThemeSettings({theme:"custom",themeCustomB:safeColor(themeSecondaryColor.value,"#FFD0AE")});
  themeSwapButton.onclick=()=>saveThemeSettings({theme:"custom",themeCustomA:themeSecondaryColor.value,themeCustomB:themePrimaryColor.value});
  themePairSwap.onclick=()=>saveThemeSettings({themeSwapped:!normalizedThemeSettings().themeSwapped});
  diagnosticsClear.onclick=()=>{diagnostics.length=0;renderDiagnostics()};
  indicator.onclick=()=>openCloudSources("library");
  loadSyncSource.onclick=loadSelectedSync;
  cloudDisconnect.onclick=()=>{
    googleDrive.disconnect();
    silentReconnectFailed=false;
    cloudSyncListing=null;
    cloudBackupEntries=[];
    renderAccountButton();
    openLibrary()
  };
  window.addEventListener("popstate",event=>{
    if(event.state?.hamboard)renderRoute(event.state);
    else{
      history.pushState({hamboard:true,view:"home"},"",appBaseUrl());
      renderHome()
    }
  });
  window.addEventListener("online",()=>{
    logDiagnostic("info","NETWORK","온라인 상태로 전환되었습니다.");
    silentReconnectFailed=false;
    renderAccountButton();
    restoreGoogleConnection();
    if(!libraryScreen.hidden)offlineWarning.hidden=true
  });
  window.addEventListener("offline",()=>{
    logDiagnostic("warn","NETWORK","오프라인 상태로 전환되었습니다.");
    renderAccountButton()
  });
  window.addEventListener("error",event=>logDiagnostic("error","RUNTIME","실행 오류",event.error||event.message));
  window.addEventListener("unhandledrejection",event=>logDiagnostic("error","RUNTIME","처리되지 않은 비동기 오류",event.reason));
  fileInput.onchange=async()=>{
    const file=fileInput.files?.[0];fileInput.value="";
    if(!file)return;
    try{
      await importCanonicalState(JSON.parse(await file.text()));
      openLibrary()
    }catch(error){
      console.error("모바일 데이터 불러오기 실패",error);
      logDiagnostic("error","IMPORT","파일 데이터 불러오기에 실패했습니다.",error);
      setStatus("파일에서 햄보드 데이터를 불러오지 못했습니다.",{action:"다시 선택",run:()=>fileInput.click()})
    }
  };

  window.HamboardMobileApp=Object.freeze({
    start,repository,importCanonicalState,applyCloudCommits,syncFromCloud,commitTopology,readCloudCommit,openDocument,closeDocument,openLibrary,openMenu,openSettings,openCloudSources,refreshCloudSources,snapshot
  });
  start();
})();
