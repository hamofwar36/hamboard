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
  const createChooser=$("#createChooser");
  const createForm=$("#createForm");
  const createFormIcon=$("#createFormIcon");
  const createFormKind=$("#createFormKind");
  const createProjectKind=$("#createProjectKind");
  const createTitleLabel=$("#createTitleLabel");
  const createTitleInput=$("#createTitleInput");
  const createSubtitleField=$("#createSubtitleField");
  const createSubtitleInput=$("#createSubtitleInput");
  const createFolderLabel=$("#createFolderLabel");
  const createFolderSelect=$("#createFolderSelect");
  const createColorField=$("#createColorField");
  const createColorToggle=$("#createColorToggle");
  const createColorPreview=$("#createColorPreview");
  const createColorOptions=$("#createColorOptions");
  const createColorGrid=$("#createColorGrid");
  const createColorEditor=$("#createColorEditor");
  const createColorPicker=$("#createColorPicker");
  const createColorHex=$("#createColorHex");
  const createFormBack=$("#createFormBack");
  const createFormClose=$("#createFormClose");
  const createFormStatus=$("#createFormStatus");
  const createSubmit=$("#createSubmit");
  const menuCloud=$("#menuCloud");
  const menuSettings=$("#menuSettings");
  const installApp=$("#installApp");
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
  let activeCreateType="";
  let createProjectKindValue="short";
  let createColorValue="";
  let createColorCustom=false;
  let deferredInstallPrompt=null;
  let lastWindowScrollY=0;
  let topbarScrollFrame=0;
  let createColorExpanded=false;
  const diagnostics=[];
  const CARD_COLORS=Object.freeze(["#FFB8AE","#FFA8B8","#FFCBA8","#FFB877","#F6D872","#D4E88A","#C8E0B0","#BDE7C4","#AEE9C8","#8FE0D2","#A0E4F0","#A9D6FF","#B0C4DE","#A9B4F2","#CBB8FF","#C9A0DE","#E0A0C8","#F2A6E0","#D2D2D2"]);
  const DEFAULT_STAGE_COLORS=Object.freeze(["#A9D6FF","#BDE7C4","#F6D872","#FFB8AE"]);
  const CREATE_TYPES=Object.freeze({
    folder:{label:"폴더",icon:"folder-plus",hint:"문서를 묶어 정리할 폴더를 만듭니다.",defaultTitle:"새 폴더"},
    project:{label:"작품",icon:"scroll-text",hint:"단편 또는 장편 작품을 만듭니다.",defaultTitle:"새 작품"},
    note:{label:"노트",icon:"notebook-text",hint:"자유롭게 내용을 정리할 노트를 만듭니다.",defaultTitle:"새 노트"},
    mindmap:{label:"마인드맵",icon:"network",hint:"아이디어와 관계를 정리할 마인드맵을 만듭니다.",defaultTitle:"새 마인드맵"}
  });
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

  const uid=()=>globalThis.crypto?.randomUUID?.()||`mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  const randomCardColor=()=>CARD_COLORS[Math.floor(Math.random()*CARD_COLORS.length)]||CARD_COLORS[0];

  function defaultStoryStages(){
    const stageDefs=["기","승","전","결"].map((name,index)=>({id:uid(),name,hint:"",color:DEFAULT_STAGE_COLORS[index]}));
    const stages={};
    for(const stage of stageDefs)stages[stage.id]=[];
    return {stageDefs,stages}
  }

  function orderedFolders(state=snapshot()){
    const folders=Array.isArray(state?.folders)?state.folders:[],children=new Map(),roots=[],seen=new Set();
    for(const folder of folders){
      const id=String(folder?.id||"");
      if(!id)continue;
      const parent=folder?.parentId?String(folder.parentId):"";
      if(parent&&folders.some(item=>String(item?.id||"")===parent)){
        if(!children.has(parent))children.set(parent,[]);
        children.get(parent).push(folder)
      }else roots.push(folder)
    }
    const rows=[];
    const walk=(items,depth)=>{
      for(const folder of items){
        const id=String(folder?.id||"");
        if(!id||seen.has(id))continue;
        seen.add(id);
        rows.push({id,name:String(folder.name||"이름 없는 폴더"),depth});
        walk(children.get(id)||[],depth+1)
      }
    };
    walk(roots,0);
    for(const folder of folders){
      const id=String(folder?.id||"");
      if(id&&!seen.has(id))rows.push({id,name:String(folder.name||"이름 없는 폴더"),depth:0})
    }
    return rows
  }

  function fillCreateFolderOptions(forFolder=false){
    createFolderSelect.replaceChildren();
    const first=document.createElement("option");
    first.value="";
    first.textContent=forFolder?"최상위 폴더":"폴더 없음";
    createFolderSelect.append(first);
    for(const folder of orderedFolders()){
      const option=document.createElement("option");
      option.value=folder.id;
      option.textContent=`${"　".repeat(Math.min(4,folder.depth))}${folder.name}`;
      createFolderSelect.append(option)
    }
  }

  function resetCreateSheet(){
    activeCreateType="";
    createProjectKindValue="short";
    createChooser.hidden=false;
    createForm.hidden=true;
    createFormStatus.hidden=true;
    createFormStatus.textContent="";
    createTitleInput.value="";
    createSubtitleInput.value="";
    createColorValue=CARD_COLORS[0];
    createColorCustom=false;
    createColorExpanded=false;
    createColorGrid.replaceChildren();
    createColorOptions.hidden=true;
    createColorEditor.hidden=true;
    createProjectKind.querySelectorAll("[data-project-kind]").forEach(button=>button.classList.toggle("active",button.dataset.projectKind==="short"));
    createSheet.classList.remove("form-open")
  }

  function syncCreateColorEditor(){
    const color=safeColor(createColorValue,CARD_COLORS[0]);
    createColorPreview.style.setProperty("--swatch",color);
    createColorToggle.setAttribute("aria-expanded",String(createColorExpanded));
    createColorOptions.hidden=!createColorExpanded;
    createColorEditor.hidden=!createColorCustom;
    createColorPicker.value=color;
    createColorHex.value=color.toUpperCase()
  }

  function renderCreateColorOptions(){
    createColorGrid.replaceChildren();
    for(const color of CARD_COLORS){
      const selected=!createColorCustom&&color.toLowerCase()===String(createColorValue||"").toLowerCase();
      const button=document.createElement("button");
      button.type="button";
      button.className=`create-color-swatch${selected?" active":""}`;
      button.style.setProperty("--swatch",color);
      button.dataset.color=color;
      button.setAttribute("aria-label",`색상 ${color.toUpperCase()}`);
      button.setAttribute("aria-pressed",String(selected));
      createColorGrid.append(button)
    }
    const custom=document.createElement("button");
    custom.type="button";
    custom.className=`create-color-swatch custom${createColorCustom?" active":""}`;
    custom.dataset.colorCustom="true";
    custom.setAttribute("aria-label","직접 색상");
    custom.setAttribute("aria-pressed",String(createColorCustom));
    custom.innerHTML='<i data-lucide="palette" aria-hidden="true"></i>';
    createColorGrid.append(custom);
    syncCreateColorEditor();
    refreshLucideIcons()
  }

  function openCreateForm(type){
    const config=CREATE_TYPES[type];
    if(!config)return;
    activeCreateType=type;
    createProjectKindValue="short";
    createChooser.hidden=true;
    createForm.hidden=false;
    createProjectKind.hidden=type!=="project";
    createSubtitleField.hidden=false;
    createTitleLabel.textContent=type==="folder"?"폴더 이름":"제목";
    createSubtitleField.querySelector("span").innerHTML=type==="folder"?"부제 <small>· 선택</small>":"부제 <small>· 선택</small>";
    createFolderLabel.innerHTML=type==="folder"?"상위 폴더 <small>· 선택</small>":"폴더 <small>· 선택</small>";
    createFormKind.textContent=`새 ${config.label}`;
    createFormIcon.innerHTML=`<i data-lucide="${config.icon}" aria-hidden="true"></i>`;
    createSheet.classList.add("form-open");
    createTitleInput.value=config.defaultTitle;
    createSubtitleInput.value="";
    createSubtitleInput.placeholder=type==="folder"?"폴더 설명":type==="project"?"작품 설명":type==="note"?"노트 설명":"마인드맵 설명";
    createColorValue=randomCardColor();
    createColorCustom=false;
    createColorExpanded=false;
    createColorField.hidden=type==="folder";
    renderCreateColorOptions();
    fillCreateFolderOptions(type==="folder");
    createFormStatus.hidden=true;
    createFormStatus.textContent="";
    createProjectKind.querySelectorAll("[data-project-kind]").forEach(button=>button.classList.toggle("active",button.dataset.projectKind==="short"));
    refreshLucideIcons();
    requestAnimationFrame(()=>{createTitleInput.focus();createTitleInput.select()})
  }

  async function createNewDocument(){
    const type=activeCreateType,config=CREATE_TYPES[type];
    if(!config)return;
    const titleValue=createTitleInput.value.trim()||config.defaultTitle;
    const subtitle=createSubtitleInput.value.trim(),folderId=createFolderSelect.value?String(createFolderSelect.value):null;
    const selectedColor=safeColor(createColorValue,""),state=snapshot(),now=new Date().toISOString(),color=selectedColor||randomCardColor(),id=uid();
    state.folders=Array.isArray(state.folders)?state.folders:[];
    state.projects=Array.isArray(state.projects)?state.projects:[];
    state.notes=Array.isArray(state.notes)?state.notes:[];
    state.mindmaps=Array.isArray(state.mindmaps)?state.mindmaps:[];

    let createdType="",createdId=id;
    if(type==="folder"){
      state.folders.push({id,name:titleValue,subtitle,parentId:folderId})
    }else if(type==="note"){
      state.notes.push({
        id,title:titleValue,subtitle,deadline:"",folderId,color,icon:"notebook-text",cardImageAssetId:"",
        content:"",characters:[],resources:[],memos:[],updatedAt:now
      });
      createdType="note"
    }else if(type==="mindmap"){
      state.mindmaps.push({
        id,title:titleValue,subtitle,deadline:"",folderId,color,icon:"network",cardImageAssetId:"",
        nodes:[],groups:[],edges:[],viewport:{x:40,y:40,zoom:1},updatedAt:now
      });
      createdType="mindmap"
    }else if(type==="project"){
      const project={
        id,title:titleValue,subtitle,deadline:"",folderId,color,icon:"scroll-text",cardImageAssetId:"",
        kind:createProjectKindValue==="long"?"long":"short",characters:[],resources:[],memos:[],updatedAt:now
      };
      if(project.kind==="long")project.episodes=[];
      else Object.assign(project,defaultStoryStages());
      state.projects.push(project);
      createdType="project"
    }else return;

    createSubmit.disabled=true;
    createFormStatus.hidden=true;
    try{
      await repository.replaceState(state);
      logDiagnostic("info","CREATE",`${config.label}을 만들었습니다.`);
      closeBottomSheet(createSheet);
      resetCreateSheet();
      if(createdType)openDocument(createdType,createdId);
      else{
        renderHome();
        setStatus("새 폴더를 만들었습니다.");
        setTimeout(()=>{if(!libraryScreen.hidden)renderLibrary()},1600)
      }
    }catch(error){
      logDiagnostic("error","REPOSITORY",`${config.label} 저장에 실패했습니다.`,error);
      createFormStatus.textContent="저장하지 못했습니다. 다시 시도해 주세요.";
      createFormStatus.hidden=false
    }finally{
      createSubmit.disabled=false
    }
  }

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
    if(text.includes("auth-base-url-not-configured"))return "로그인 서버 설정을 불러오지 못했습니다. 배포 설정을 확인해 주세요.";
    if(text.includes("auth-session-expired")||text.includes("auth-session-required"))return "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.";
    if(text.includes("auth-session-http")||text.includes("auth-token-http"))return "로그인 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
    if(text.includes("branched-history"))return "동기화 기록이 갈라져 있어 PC에서 먼저 충돌을 해결해야 합니다.";
    if(text.includes("download-integrity")||text.includes("commit-")||text.includes("backup-"))return "클라우드 데이터 검증에 실패했습니다. PC에서 다시 저장한 뒤 시도해 주세요.";
    if(text.includes("http-401")||text.includes("reconnect-required")||text.includes("not-connected"))return "Google Drive 연결을 갱신하지 못했습니다. 다시 로그인해 주세요.";
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
  function resetTopbarVisibility(){
    document.body.classList.remove("topbar-hidden");
    lastWindowScrollY=Math.max(0,window.scrollY||0)
  }
  function syncTopbarVisibility(){
    topbarScrollFrame=0;
    const current=Math.max(0,window.scrollY||0),delta=current-lastWindowScrollY;
    if(current<24||delta<-4)document.body.classList.remove("topbar-hidden");
    else if(current>72&&delta>6)document.body.classList.add("topbar-hidden");
    lastWindowScrollY=current
  }
  function isStandaloneMode(){
    return window.matchMedia?.("(display-mode: standalone)")?.matches===true||window.navigator.standalone===true
  }
  function renderInstallAction(){
    installApp.hidden=isStandaloneMode()||!deferredInstallPrompt
  }
  async function registerMobileServiceWorker(){
    if(!("serviceWorker" in navigator))return;
    if(location.protocol!=="https:"&&!["localhost","127.0.0.1"].includes(location.hostname))return;
    const version=String(window.HAMBOARD_MOBILE_CONFIG?.version||"dev");
    try{
      await navigator.serviceWorker.register(`./service-worker.js?v=${encodeURIComponent(version)}`,{scope:"./"})
    }catch(error){
      console.error("모바일 서비스 워커 등록 실패",error);
      logDiagnostic("warn","PWA","설치형 웹앱 초기화에 실패했습니다.",error)
    }
  }
  function showScreen(screen,{heading="햄보드",back=false,account=false,nav=""}={}){
    hideAllScreens();
    screen.hidden=false;
    const documentOpen=screen===projectReaderScreen||screen===noteReaderScreen||screen===mindmapReaderScreen;
    document.body.classList.toggle("document-open",documentOpen);
    backButton.hidden=!back;
    syncStatusWrap.hidden=!account;
    title.textContent=heading;
    activateNav(nav);
    window.scrollTo(0,0);
    resetTopbarVisibility();
    refreshLucideIcons()
  }
  function renderAccountButton(){
    const status=googleDrive?.status?.()||{configured:false,connected:false,authorized:false,checking:false};
    const online=navigator.onLine!==false;
    offlineWarning.hidden=online;
    if(!online){setIndicator("error","오프라인");return {...status,online:false}}
    if(!status.configured){setIndicator("error","설정 필요");return {...status,online:true}}
    if(status.connected){setIndicator("connected","동기화 중");return {...status,online:true}}
    if(status.checking&&!silentReconnectFailed){setIndicator("local","연결 확인");return {...status,online:true,reconnecting:true}}
    if(status.authorized&&!silentReconnectFailed){setIndicator("connected","동기화 중");return {...status,online:true,reconnecting:true}}
    setIndicator("local","로그인");
    return {...status,online:true}
  }

  async function restoreGoogleConnection(){
    const status=googleDrive?.status?.()||{configured:false,connected:false,authorized:false,checking:false};
    if(!status.configured||status.connected||silentReconnectFailed||navigator.onLine===false)return status;
    if(status.checking===false&&!status.authorized)return status;
    if(silentReconnectPromise)return silentReconnectPromise;
    renderAccountButton();
    silentReconnectPromise=(async()=>{
      try{
        const next=await googleDrive.reconnectSilently();
        silentReconnectFailed=false;
        return next
      }catch(error){
        silentReconnectFailed=true;
        console.warn("모바일 클라우드 세션 복원 실패",error);
        logDiagnostic("warn","CLOUD","로그인 세션 복원에 실패했습니다.",error);
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

  function compactBlockPreview(block){
    if(block.type==="script"){
      return (block.scriptBlocks||[])
        .map(line=>{
          const text=String(line?.text||"").trim(),speaker=line?.type==="dialogue"?String(line?.speaker||"").trim():"";
          if(!text&&!speaker)return "";
          return speaker&&text?speaker+" · "+text:text||speaker
        })
        .filter(Boolean)
        .join(" ")
    }
    return String(block.summary||"").trim()
  }

  function blockElement(block,{compact=false}={}){
    const card=element("article","block-card"+(compact?" compact-block-card":""));
    const titleText=String(block.title||"").trim();
    if(compact){
      if(titleText||block.completed){
        const head=element("div","block-head");
        if(titleText)head.append(element("h5","",titleText));
        if(block.completed)head.append(element("span","complete-badge","완료"));
        card.append(head)
      }
      const preview=compactBlockPreview(block);
      if(preview)card.append(element("p","block-text block-preview"+(titleText?"":" no-title"),preview));
      return card
    }

    const head=element("div","block-head"),heading=element("h5","",titleText||(block.type==="script"?"제목 없는 스크립트":"제목 없는 블록"));
    head.append(heading);
    if(block.completed)head.append(element("span","complete-badge","완료"));
    card.append(head);
    if(block.type==="script"){
      const lines=element("div","script-lines");
      for(const line of block.scriptBlocks||[]){
        if(!String(line?.text||"").trim()&&!String(line?.speaker||"").trim())continue;
        const row=element("div","script-line"),label=element("span","script-line-label",scriptLabels[line.type]||"지문"),body=element("span","");
        if(line.type==="dialogue"&&line.speaker)body.append(element("span","script-speaker",line.speaker+" · "));
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
  function renderUnit(unit,index=0,{showHeading=true,compactBlocks=false,onBack=null}={}){
    const host=$("#projectContent");
    host.replaceChildren();
    if(onBack){
      const back=element("button","episode-overview-back","");
      back.type="button";
      back.innerHTML='<i data-lucide="arrow-left" aria-hidden="true"></i><span>화 목록</span>';
      back.onclick=onBack;
      host.append(back)
    }
    if(showHeading){
      const heading=element("div","unit-heading"),name=unit.title||(index+1)+"화";
      heading.append(element("h3","",name));
      if(unit.subtitle)heading.append(element("p","",unit.subtitle));
      host.append(heading)
    }
    const carousel=element("div","stage-carousel");
    for(const stage of unit.stageDefs||[]){
      const section=element("section","stage-section"),stageHead=element("header","stage-heading"),stripe=element("span","stage-color"),copy=element("div",""),stageColor=safeColor(stage.color,"#A9D6FF");
      section.style.setProperty("--stage-color",stageColor);
      stripe.style.setProperty("--stage-color",stageColor);
      copy.append(element("h4","",stage.name||"파트"));
      if(stage.hint)copy.append(element("p","",stage.hint));
      stageHead.append(stripe,copy);
      const blocks=element("div","block-list"),items=Array.isArray(unit.stages?.[stage.id])?unit.stages[stage.id]:[];
      if(items.length)for(const block of items)blocks.append(blockElement(block,{compact:compactBlocks}));
      else blocks.append(element("div","empty-stage","등록된 블록이 없습니다."));
      section.append(stageHead,blocks);
      carousel.append(section)
    }
    if(carousel.childElementCount)host.append(carousel);
    refreshLucideIcons()
  }
  function renderProject(project){
    $("#readerTitle").textContent=project.title||"제목 없는 작품";
    $("#readerSubtitle").textContent=project.subtitle||"";
    $("#readerSubtitle").hidden=!project.subtitle;
    const episodes=$("#episodeList"),content=$("#projectContent");
    episodes.replaceChildren();
    episodes.hidden=false;
    projectReaderScreen.classList.remove("episode-open");

    if(project.kind==="long"){
      const list=project.episodes||[];
      if(!list.length){
        content.replaceChildren(element("div","status-card","등록된 화가 없습니다."));
        return
      }

      const activeIndex=list.findIndex(item=>String(item.id)===activeEpisodeId);
      if(activeIndex<0){
        activeEpisodeId="";
        content.replaceChildren();
        list.forEach((episode,index)=>{
          const button=element("button","episode-button");
          button.type="button";
          const stripe=element("span","episode-color"),episodeColor=safeColor(episode.color,"#A9D6FF");
          button.style.setProperty("--episode-color",episodeColor);
          stripe.style.setProperty("--episode-color",episodeColor);
          const copy=element("span","episode-copy");
          copy.append(
            element("strong","",episode.title||(index+1)+"화"),
            element("span","",episode.subtitle||allBlocks(episode).length+"개 블록")
          );
          button.append(stripe,copy,element("span","episode-number",(index+1)+"화"));
          button.onclick=()=>{
            activeEpisodeId=String(episode.id);
            renderProject(project);
            window.scrollTo({top:0,behavior:"smooth"})
          };
          episodes.append(button)
        });
        return
      }

      episodes.hidden=true;
      projectReaderScreen.classList.add("episode-open");
      renderUnit(list[activeIndex],activeIndex,{
        showHeading:true,
        compactBlocks:true,
        onBack:()=>{
          activeEpisodeId="";
          renderProject(project);
          window.scrollTo({top:0,behavior:"smooth"})
        }
      });
      return
    }

    activeEpisodeId="";
    renderUnit(project,0,{showHeading:false,compactBlocks:true})
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
    const content=$("#noteReaderContent");
    content.innerHTML=sanitizedNoteHtml(note.content||"");
    if(!content.textContent.trim())content.replaceChildren(element("div","empty-document","내용이 없는 노트입니다."))
  }

  function renderMindmap(mindmap){
    $("#mindmapReaderTitle").textContent=mindmap.title||"제목 없는 마인드맵";
    $("#mindmapReaderSubtitle").textContent=mindmap.subtitle||"";
    $("#mindmapReaderSubtitle").hidden=!mindmap.subtitle;
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
    showScreen(screen,{heading:"홈",back:true,account:false,nav:"library"});
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
    showScreen(menuScreen,{heading:"메뉴",back:false,account:false,nav:"menu"})
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
    if(!status.connected){
      if(silentReconnectFailed)silentReconnectFailed=false;
      await restoreGoogleConnection();
      status=renderAccountButton()
    }
    if(!status.connected){
      setIndicator("local","로그인");
      try{
        const result=await googleDrive.connect();
        if(result?.redirecting)return;
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
      if(match)openDocument(match[1],decodeURIComponent(match[2]));
      refreshLucideIcons();
      registerMobileServiceWorker();
      renderInstallAction()
    }catch(error){
      console.error("모바일 저장소를 열지 못했습니다.",error);
      logDiagnostic("error","REPOSITORY","모바일 저장소를 열지 못했습니다.",error);
      setStatus("모바일 저장소를 열지 못했습니다. 브라우저의 사이트 데이터 설정을 확인해 주세요.")
    }
  }

  backButton.onclick=()=>{if(activeDocumentType)openLibrary({replace:true});else handleBack()};
  libraryNav.onclick=()=>{if(history.state?.view!=="home")openLibrary()};
  createNav.onclick=()=>{resetCreateSheet();openBottomSheet(createSheet)};
  menuNav.onclick=()=>{if(history.state?.view!=="menu")openMenu()};
  createFormClose.onclick=()=>{closeBottomSheet(createSheet);resetCreateSheet()};
  createSheet.onclick=event=>{if(event.target===createSheet){closeBottomSheet(createSheet);resetCreateSheet()}};
  createChooser.onclick=event=>{
    const button=event.target.closest("[data-create-type]");
    if(button)openCreateForm(button.dataset.createType)
  };
  createColorToggle.onclick=()=>{
    createColorExpanded=!createColorExpanded;
    renderCreateColorOptions()
  };
  createColorGrid.onclick=event=>{
    const custom=event.target.closest("[data-color-custom]");
    if(custom){
      createColorCustom=true;
      createColorExpanded=true;
      createColorValue=safeColor(createColorValue,CARD_COLORS[0]);
      renderCreateColorOptions();
      requestAnimationFrame(()=>createColorHex.focus());
      return
    }
    const button=event.target.closest("[data-color]");
    if(!button)return;
    createColorCustom=false;
    createColorExpanded=false;
    createColorValue=safeColor(button.dataset.color,CARD_COLORS[0]);
    renderCreateColorOptions()
  };
  createColorPicker.oninput=()=>{
    createColorCustom=true;
    createColorExpanded=true;
    createColorValue=safeColor(createColorPicker.value,createColorValue||CARD_COLORS[0]);
    createColorHex.value=createColorValue.toUpperCase();
    renderCreateColorOptions()
  };
  createColorHex.oninput=()=>{
    const value=safeColor(createColorHex.value,"");
    if(!value)return;
    createColorCustom=true;
    createColorExpanded=true;
    createColorValue=value;
    createColorPicker.value=value;
    renderCreateColorOptions()
  };
  createColorHex.onblur=()=>{
    const value=safeColor(createColorHex.value,createColorValue||CARD_COLORS[0]);
    createColorCustom=true;
    createColorExpanded=true;
    createColorValue=value;
    renderCreateColorOptions()
  };
  createFormBack.onclick=resetCreateSheet;
  createProjectKind.onclick=event=>{
    const button=event.target.closest("[data-project-kind]");
    if(!button)return;
    createProjectKindValue=button.dataset.projectKind==="long"?"long":"short";
    createProjectKind.querySelectorAll("[data-project-kind]").forEach(item=>item.classList.toggle("active",item===button))
  };
  createForm.onsubmit=event=>{event.preventDefault();createNewDocument()};
  librarySearch.addEventListener("input",renderLibrary);
  menuCloud.onclick=()=>openCloudSources("menu");
  menuSettings.onclick=()=>openSettings();
  installApp.onclick=async()=>{
    if(!deferredInstallPrompt)return;
    const prompt=deferredInstallPrompt;
    deferredInstallPrompt=null;
    renderInstallAction();
    try{await prompt.prompt();await prompt.userChoice}catch(error){logDiagnostic("warn","PWA","앱 설치 요청을 열지 못했습니다.",error)}
  };
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
  cloudDisconnect.onclick=async()=>{
    cloudDisconnect.disabled=true;
    try{
      await googleDrive.disconnect();
      silentReconnectFailed=false;
      cloudSyncListing=null;
      cloudBackupEntries=[];
      renderAccountButton();
      openLibrary()
    }catch(error){
      console.error("모바일 클라우드 연결 해제 실패",error);
      logDiagnostic("error","CLOUD","클라우드 연결 해제에 실패했습니다.",error);
      renderAccountButton()
    }finally{
      cloudDisconnect.disabled=false
    }
  };
  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();
    deferredInstallPrompt=event;
    renderInstallAction()
  });
  window.addEventListener("appinstalled",()=>{
    deferredInstallPrompt=null;
    renderInstallAction()
  });
  window.addEventListener("scroll",()=>{
    if(topbarScrollFrame)return;
    topbarScrollFrame=requestAnimationFrame(syncTopbarVisibility)
  },{passive:true});
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
