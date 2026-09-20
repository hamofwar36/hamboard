(function(){
  "use strict";

  const syncModel=window.HamboardSyncStateModel;
  const repositoryCore=window.HamboardProjectRepository;
  const googleDrive=window.HamboardMobileGoogleDrive;
  const assetRepositoryCore=window.HamboardMobileAssetRepository;
  if(!syncModel||!repositoryCore||!assetRepositoryCore)throw new Error("hamboard-mobile-dependencies-unavailable");

  const storage=repositoryCore.createIndexedDbStateStorage({databaseName:"hamboard-mobile",storeName:"state",stateKey:"mobile-core"});
  const repository=repositoryCore.createProjectRepository({storage,syncModel,clientProfile:"mobile-core"});
  const assetRepository=assetRepositoryCore.createIndexedDbAssetRepository({databaseName:"hamboard-mobile-assets",storeName:"assets"});
  const $=selector=>document.querySelector(selector);

  const mobileScroll=$("#mobileApp");
  const libraryScreen=$("#libraryScreen");
  const projectReaderScreen=$("#projectReaderScreen");
  const noteReaderScreen=$("#noteReaderScreen");
  const noteReaderContent=$("#noteReaderContent");
  const noteEditorControls=$("#noteEditorControls");
  const noteFormatPanel=$("#noteFormatPanel");
  const noteMobileToolbar=$("#noteMobileToolbar");
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
  let cloudSyncImportPromise=null;
  let cloudSyncProgressRun=0;
  let cloudSyncLastPercent=0;
  let cloudBackupEntries=[];
  let cloudReturnView="library";
  let silentReconnectFailed=false;
  let silentReconnectPromise=null;
  let activeCreateType="";
  let createProjectKindValue="short";
  let createColorValue="";
  let createColorCustom=false;
  let deferredInstallPrompt=null;
  let lastAppScrollY=0;
  let topbarScrollFrame=0;
  let noteViewportFrame=0;
  let noteViewportBaseHeight=0;
  let noteSavedRange=null;
  let noteFormatPanelKey="";
  let noteSaveTimer=0;
  let pendingNoteSave=null;
  let noteSaveChain=Promise.resolve();
  let createColorExpanded=false;
  const diagnostics=[];
  const CARD_COLORS=Object.freeze(["#FFB8AE","#FFA8B8","#FFCBA8","#FFB877","#F6D872","#D4E88A","#C8E0B0","#BDE7C4","#AEE9C8","#8FE0D2","#A0E4F0","#A9D6FF","#B0C4DE","#A9B4F2","#CBB8FF","#C9A0DE","#E0A0C8","#F2A6E0","#D2D2D2"]);
  const DEFAULT_STAGE_COLORS=Object.freeze([CARD_COLORS[11],CARD_COLORS[7],CARD_COLORS[4],CARD_COLORS[0]]);
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
  const mapWithConcurrency=async(items,limit,worker)=>{
    const values=Array.from(items||[]),results=new Array(values.length);
    let cursor=0;
    const runners=Array.from({length:Math.min(Math.max(1,Number(limit)||1),values.length)},async()=>{
      while(true){
        const index=cursor++;
        if(index>=values.length)return;
        results[index]=await worker(values[index],index)
      }
    });
    await Promise.all(runners);
    return results
  };
  const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node};
  const safeColor=(value,fallback=CARD_COLORS[0])=>/^#[0-9a-f]{6}$/i.test(String(value||""))?String(value):fallback;
  const cssColorToken=name=>String(getComputedStyle(document.body||document.documentElement).getPropertyValue(name)||"").trim();
  const safeIcon=(value,fallback)=>/^[a-z0-9-]+$/i.test(String(value||""))?String(value):fallback;
  const formatDate=value=>{const parsed=Date.parse(String(value||""));return Number.isFinite(parsed)?new Intl.DateTimeFormat("ko-KR",{year:"numeric",month:"short",day:"numeric"}).format(parsed):""};
  const stripHtml=value=>{const node=document.createElement("div");node.innerHTML=String(value||"");return (node.textContent||"").replace(/\s+/g," ").trim()};
  const refreshLucideIcons=()=>{if(window.lucide?.createIcons)window.lucide.createIcons({attrs:{"stroke-width":1.8}})};
  const colorLuminance=color=>{
    const hex=safeColor(color,CARD_COLORS[0]).slice(1),rgb=[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16)/255);
    const linear=rgb.map(value=>value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4));
    return .2126*linear[0]+.7152*linear[1]+.0722*linear[2]
  };
  const colorContrast=(left,right)=>{
    const a=colorLuminance(left),b=colorLuminance(right);
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)
  };
  const cardForeground=color=>{
    const background=safeColor(color,CARD_COLORS[0]);
    const candidates=[cssColorToken("--text-light"),cssColorToken("--text-dark")].filter(value=>/^#[0-9a-f]{6}$/i.test(value));
    if(!candidates.length)return "";
    let result=candidates.reduce((best,candidate)=>colorContrast(background,candidate)>colorContrast(background,best)?candidate:best,candidates[0]);
    if(colorContrast(background,result)<4.5){
      for(const candidate of [cssColorToken("--contrast-dark"),cssColorToken("--contrast-light")].filter(value=>/^#[0-9a-f]{6}$/i.test(value))){
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
      themeCustomA:safeColor(source.themeCustomA,MOBILE_THEMES["lilac-peach"].a),
      themeCustomB:safeColor(source.themeCustomB,MOBILE_THEMES["lilac-peach"].b),
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
    const meta=document.querySelector('meta[name="theme-color"]'),pageColor=cssColorToken("--ui-page-bg")||cssColorToken("--bg");
    if(meta&&pageColor)meta.setAttribute("content",pageColor)
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
    lastAppScrollY=Math.max(0,mobileScroll.scrollTop||0)
  }
  function syncTopbarVisibility(){
    topbarScrollFrame=0;
    const current=Math.max(0,mobileScroll.scrollTop||0),delta=current-lastAppScrollY;
    if(current<24||delta<-4)document.body.classList.remove("topbar-hidden");
    else if(current>72&&delta>6)document.body.classList.add("topbar-hidden");
    lastAppScrollY=current
  }
  function scrollAppToTop({smooth=false}={}){
    mobileScroll.scrollTo({top:0,left:0,behavior:smooth?"smooth":"auto"})
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
  function syncNoteViewport(){
    noteViewportFrame=0;
    const viewport=window.visualViewport,noteOpen=document.body.classList.contains("note-open");
    if(!noteOpen){
      noteViewportBaseHeight=0;
      document.documentElement.style.setProperty("--note-keyboard-inset","0px");
      document.body.classList.remove("note-keyboard-open");
      return
    }
    const viewportHeight=Math.max(0,Math.round(viewport?.height||window.innerHeight||0));
    if(!noteViewportBaseHeight||viewportHeight>noteViewportBaseHeight)noteViewportBaseHeight=viewportHeight;
    const covered=viewport?Math.max(0,Math.round(window.innerHeight-(viewport.height+viewport.offsetTop))):0;
    const contracted=Math.max(0,noteViewportBaseHeight-viewportHeight);
    const keyboardOpen=covered>=120||contracted>=120;
    if(!keyboardOpen)noteViewportBaseHeight=Math.max(noteViewportBaseHeight,viewportHeight);
    const inset=covered>=120?covered:0;
    document.documentElement.style.setProperty("--note-keyboard-inset",`${inset}px`);
    document.body.classList.toggle("note-keyboard-open",keyboardOpen)
  }
  function scheduleNoteViewportSync(){
    if(noteViewportFrame)return;
    noteViewportFrame=requestAnimationFrame(syncNoteViewport)
  }

  function showScreen(screen,{heading="햄보드",back=false,account=false,nav=""}={}){
    hideAllScreens();
    screen.hidden=false;
    const documentOpen=screen===projectReaderScreen||screen===noteReaderScreen||screen===mindmapReaderScreen;
    document.body.classList.toggle("document-open",documentOpen);
    document.body.classList.toggle("note-open",screen===noteReaderScreen);
    backButton.hidden=!back;
    syncStatusWrap.hidden=!account;
    title.textContent=heading;
    activateNav(nav);
    scrollAppToTop();
    resetTopbarVisibility();
    scheduleNoteViewportSync();
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

  function collectNoteHtmlAssetIds(html,set=new Set()){
    const root=document.createElement("div");
    root.innerHTML=String(html||"");
    root.querySelectorAll("img[data-note-image]").forEach(image=>{const id=String(image.dataset.noteImage||"");if(id)set.add(id)});
    return set
  }

  function collectDocumentAssetIds(type,documentValue,set=new Set()){
    if(!documentValue)return set;
    const add=value=>{const id=String(value||"");if(id)set.add(id)};
    add(documentValue.cardImageAssetId);
    if(type==="project"||type==="note"){
      for(const resource of documentValue.resources||[]){
        const mime=String(resource?.type||"");
        if(resource?.inline===true||!mime||mime.startsWith("image/"))add(resource?.id)
      }
      for(const character of documentValue.characters||[]){
        add(character?.avatarAssetId);
        for(const id of character?.imageAssetIds||[])add(id)
      }
    }
    if(type==="note")collectNoteHtmlAssetIds(documentValue.content,set);
    if(type==="mindmap")for(const node of documentValue.nodes||[])if(node?.type==="image"&&node.assetId)add(node.assetId);
    return set
  }

  function currentMobileAssetIds(stateValue=snapshot()){
    const ids=new Set();
    for(const project of stateValue.projects||[])collectDocumentAssetIds("project",project,ids);
    for(const note of stateValue.notes||[])collectDocumentAssetIds("note",note,ids);
    for(const mindmap of stateValue.mindmaps||[])collectDocumentAssetIds("mindmap",mindmap,ids);
    for(const character of stateValue.characterRepository||[]){
      if(character?.avatarAssetId)ids.add(String(character.avatarAssetId));
      for(const id of character?.imageAssetIds||[])if(id)ids.add(String(id))
    }
    for(const memo of stateValue.quickMemos||[])for(const id of memo?.imageAssetIds||[])if(id)ids.add(String(id));
    return ids
  }

  async function hydrateAssetImage(image,assetId){
    const id=String(assetId||"");
    if(!image||!id)return false;
    try{
      const record=await assetRepository.get(id);
      if(!record?.blob)return false;
      const url=URL.createObjectURL(record.blob);
      const release=()=>URL.revokeObjectURL(url);
      image.addEventListener("load",release,{once:true});
      image.addEventListener("error",release,{once:true});
      image.src=url;
      return true
    }catch(error){
      logDiagnostic("warn","ASSET","로컬 이미지 캐시를 읽지 못했습니다.",error);
      return false
    }
  }

  async function hydrateLibraryCardImage(button,assetId){
    const image=button?.querySelector(".project-card-background");
    if(!image)return;
    const loaded=await hydrateAssetImage(image,assetId);
    if(!button.isConnected)return;
    image.hidden=!loaded;
    button.classList.toggle("has-card-image",loaded)
  }

  async function hydrateNoteImages(note){
    if(String(noteReaderContent.dataset.noteId||"")!==String(note?.id||""))return;
    const names=new Map((note?.resources||[]).map(resource=>[String(resource?.id||""),String(resource?.name||"")]));
    await mapWithConcurrency([...noteReaderContent.querySelectorAll("img[data-note-image]")],4,async image=>{
      const id=String(image.dataset.noteImage||"");
      if(!id)return;
      image.loading="lazy";
      if(!image.alt)image.alt=names.get(id)||"노트 이미지";
      const loaded=await hydrateAssetImage(image,id);
      image.classList.toggle("asset-missing",!loaded)
    })
  }

  function noteHtmlForStorage(){
    const cloneRoot=noteReaderContent.cloneNode(true);
    cloneRoot.querySelectorAll("img[data-note-image]").forEach(image=>{
      image.removeAttribute("src");
      image.removeAttribute("loading");
      image.classList.remove("asset-missing")
    });
    return sanitizedNoteHtml(cloneRoot.innerHTML)
  }

  function syncAssetCandidates(objects,assetId){
    return (objects||[]).filter(item=>item?.syncType==="asset"&&String(item.assetId||"")===String(assetId||"")&&String(item.objectKey||"").startsWith("sync/assets/")).sort((a,b)=>Number(b.createdAtMs||0)-Number(a.createdAtMs||0))
  }

  function validateSyncAssetObject(raw){
    const objectKey=String(raw?.objectKey||""),contentSha256=String(raw?.contentSha256||"").toLowerCase(),byteSize=Math.max(0,Number(raw?.byteSize)||0),mimeType=String(raw?.mimeType||"application/octet-stream");
    if(!/^sync\/(?:blobs|thumbs)\/[0-9a-f]{64}$/.test(objectKey)||!/^[0-9a-f]{64}$/.test(contentSha256)||byteSize<1)throw new Error("sync-asset-object-invalid");
    return {objectKey,contentSha256,byteSize,mimeType}
  }

  async function readSyncAssetDescriptor(object){
    const result=await googleDrive.getSyncObject({remoteObjectId:String(object.remoteObjectId||""),objectKey:String(object.objectKey||""),contentSha256:String(object.contentSha256||""),byteSize:Number(object.byteSize)||0});
    let descriptor;
    try{descriptor=JSON.parse(String(result.content||""))}catch{throw new Error("sync-asset-descriptor-json-invalid")}
    if(descriptor?.format!=="hamboard-sync-asset"||descriptor?.formatVersion!==1||String(descriptor.assetId||"")!==String(object.assetId||"")||!descriptor.sourceSha256||!/^[0-9a-f]{64}$/.test(String(descriptor.sourceSha256))||!descriptor.main)throw new Error("sync-asset-descriptor-invalid");
    return {...descriptor,main:validateSyncAssetObject(descriptor.main)}
  }

  async function fetchSyncAsset(assetId,objects){
    let candidates=syncAssetCandidates(objects,assetId),lastError=null;
    if(!candidates.length&&googleDrive.listSyncAssetDescriptors)candidates=await googleDrive.listSyncAssetDescriptors(assetId);
    for(const candidate of candidates){
      try{
        const descriptor=await readSyncAssetDescriptor(candidate);
        const downloaded=await googleDrive.getObjectByKey(descriptor.main);
        return {id:String(assetId),ownerId:String(descriptor.ownerId||""),blob:downloaded.blob,mimeType:downloaded.mimeType,byteSize:downloaded.byteSize,sourceSha256:String(descriptor.sourceSha256||""),contentSha256:downloaded.contentSha256,quality:String(descriptor.quality||candidate.quality||"")}
      }catch(error){lastError=error}
    }
    throw lastError||new Error("sync-asset-descriptor-not-found")
  }

  async function downloadCurrentSyncAssets(listing,stateValue,onProgress=()=>{}){
    const wanted=[...currentMobileAssetIds(stateValue)],missing=await assetRepository.missing(wanted),unresolved=[];
    let completed=0;
    if(!missing.length){onProgress({completed:0,total:0});return {wanted:wanted.length,downloaded:0,cached:wanted.length,unresolved}}
    await mapWithConcurrency(missing,3,async assetId=>{
      try{await assetRepository.put(await fetchSyncAsset(assetId,listing.objects||[]))}
      catch(error){unresolved.push(assetId);logDiagnostic("warn","ASSET","동기화 이미지 일부를 불러오지 못했습니다.",error)}
      finally{completed++;onProgress({completed,total:missing.length})}
    });
    const result={wanted:wanted.length,downloaded:missing.length-unresolved.length,cached:wanted.length-missing.length,unresolved};
    logDiagnostic(unresolved.length?"warn":"info","ASSET",`동기화 이미지 확인: 참조 ${result.wanted}개 · 다운로드 ${result.downloaded}개 · 캐시 ${result.cached}개 · 미해결 ${result.unresolved.length}개`);
    return result
  }

  async function downloadCurrentBackupAssets(manifest,stateValue,onProgress=()=>{}){
    const wanted=[...currentMobileAssetIds(stateValue)],missing=await assetRepository.missing(wanted),assetById=new Map((manifest?.assets||[]).map(asset=>[String(asset?.id||""),asset]).filter(([id])=>id)),objectByKey=new Map((manifest?.objects||[]).map(object=>[String(object?.contentKey||""),object]).filter(([key])=>key)),unresolved=[];
    const groups=new Map();
    for(const assetId of missing){
      const asset=assetById.get(assetId),object=asset?objectByKey.get(String(asset.contentKey||"")):null;
      if(!asset||!object){unresolved.push(assetId);continue}
      const key=String(asset.contentKey);
      if(!groups.has(key))groups.set(key,{object,assets:[]});
      groups.get(key).assets.push(asset)
    }
    let completed=unresolved.length;
    onProgress({completed,total:missing.length});
    if(groups.size)await googleDrive.loadObjectIndex();
    await mapWithConcurrency([...groups.values()],3,async group=>{
      try{
        const object=group.object,downloaded=await googleDrive.getObjectByKey({
          objectKey:String(object.objectKey||""),
          contentSha256:String(object.contentSha256||""),
          byteSize:Number(object.uploadByteSize)||0,
          mimeType:String(object.uploadMimeType||object.sourceMimeType||"application/octet-stream")
        });
        await assetRepository.putMany(group.assets.map(asset=>({
          id:String(asset.id),ownerId:String(asset.ownerId||""),blob:downloaded.blob,mimeType:downloaded.mimeType,byteSize:downloaded.byteSize,
          sourceSha256:String(asset.contentKey||""),contentSha256:downloaded.contentSha256,quality:String(manifest?.imagePolicy?.quality||"")
        })))
      }catch(error){
        for(const asset of group.assets)unresolved.push(String(asset.id));
        logDiagnostic("warn","ASSET","백업 이미지 일부를 불러오지 못했습니다.",error)
      }finally{
        completed+=group.assets.length;
        onProgress({completed:Math.min(completed,missing.length),total:missing.length})
      }
    });
    return {wanted:wanted.length,downloaded:missing.length-unresolved.length,cached:wanted.length-missing.length,unresolved}
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
      if(cardInk){
        button.style.setProperty("--custom-on",cardInk);
        button.style.setProperty("--custom-muted",cardInk)
      }

      const background=element("img","project-card-background");
      background.alt="";
      background.hidden=true;
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
      button.append(background,veil,folder,heading);
      if(item.cardImageAssetId)hydrateLibraryCardImage(button,item.cardImageAssetId);
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

    const stageDefs=Array.isArray(unit.stageDefs)?unit.stageDefs:[];
    const tracker=element("div","part-position");
    tracker.setAttribute("aria-label",stageDefs.length+"개 파트");
    const stepButtons=[];
    stageDefs.forEach((stage,stageIndex)=>{
      const step=element("button","part-step"+(stageIndex===0?" active":""),String(stageIndex+1));
      step.type="button";
      step.title=(stageIndex+1)+"/"+stageDefs.length+" "+(stage.name||"파트");
      step.setAttribute("aria-label",(stageIndex+1)+"번째 파트 "+(stage.name||"파트"));
      if(stageIndex===0)step.setAttribute("aria-current","step");
      stepButtons.push(step);
      tracker.append(step)
    });
    if(stepButtons.length)host.append(tracker);

    const carousel=element("div","stage-carousel"),sections=[];
    for(const stage of stageDefs){
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
      carousel.append(section);
      sections.push(section)
    }

    if(sections.length){
      const setActivePart=partIndex=>{
        stepButtons.forEach((step,stepIndex)=>{
          const active=stepIndex===partIndex;
          step.classList.toggle("active",active);
          if(active)step.setAttribute("aria-current","step");
          else step.removeAttribute("aria-current")
        })
      };
      const carouselAnchor=()=>{
        const rect=carousel.getBoundingClientRect(),paddingLeft=parseFloat(getComputedStyle(carousel).paddingLeft)||0;
        return rect.left+paddingLeft
      };
      let partScrollFrame=0;
      const syncActivePart=()=>{
        partScrollFrame=0;
        const anchor=carouselAnchor();
        let activeIndex=0,bestDistance=Number.POSITIVE_INFINITY;
        sections.forEach((section,sectionIndex)=>{
          const distance=Math.abs(section.getBoundingClientRect().left-anchor);
          if(distance<bestDistance){bestDistance=distance;activeIndex=sectionIndex}
        });
        setActivePart(activeIndex)
      };
      carousel.addEventListener("scroll",()=>{
        if(partScrollFrame)return;
        partScrollFrame=requestAnimationFrame(syncActivePart)
      },{passive:true});
      stepButtons.forEach((step,stepIndex)=>{
        step.onclick=()=>{
          const section=sections[stepIndex];
          if(!section)return;
          const target=carousel.scrollLeft+(section.getBoundingClientRect().left-carouselAnchor());
          setActivePart(stepIndex);
          carousel.scrollTo({left:target,behavior:"smooth"})
        }
      })
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
        const showCompletion=snapshot().settings?.completionEnabled!==false;
        list.forEach((episode,index)=>{
          const button=element("button","episode-button");
          button.type="button";
          const episodeColor=safeColor(episode.color,"#A9D6FF"),cardInk=cardForeground(episodeColor);
          button.style.setProperty("--card-color",episodeColor);
          button.style.setProperty("--custom-on",cardInk);
          button.style.setProperty("--custom-muted",cardInk);
          const blocks=allBlocks(episode),done=blocks.filter(block=>block.completed).length,todo=blocks.length-done;
          button.append(
            element("span","episode-number",(index+1)+"화"),
            element("strong","episode-title",episode.title||(index+1)+"화"),
            element("span","episode-desc",episode.subtitle||blocks.length+"개 블록")
          );
          if(showCompletion){
            const completion=element("span","episode-completion");
            completion.append(element("span","","완성 "+done),element("span","","미완성 "+todo));
            button.append(completion)
          }
          button.onclick=()=>{
            activeEpisodeId=String(episode.id);
            renderProject(project);
            scrollAppToTop({smooth:true})
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
          scrollAppToTop({smooth:true})
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

  function mobileNoteRange(){
    const editor=noteReaderContent,selection=window.getSelection();
    if(selection?.rangeCount){
      const range=selection.getRangeAt(0);
      if(editor.contains(range.commonAncestorContainer))return range
    }
    if(noteSavedRange&&editor.contains(noteSavedRange.commonAncestorContainer))return noteSavedRange;
    return null
  }

  function captureMobileNoteSelection(){
    const range=mobileNoteRange();
    if(!range)return false;
    noteSavedRange=range.cloneRange();
    return true
  }

  function restoreMobileNoteSelection(){
    const editor=noteReaderContent,selection=window.getSelection();
    editor.focus({preventScroll:true});
    let range=noteSavedRange&&editor.contains(noteSavedRange.commonAncestorContainer)?noteSavedRange.cloneRange():null;
    if(!range){
      range=document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false)
    }
    try{
      selection.removeAllRanges();
      selection.addRange(range);
      noteSavedRange=range.cloneRange();
      return range
    }catch{
      noteSavedRange=null;
      return null
    }
  }

  function mobileNoteSelectionElement(){
    const range=mobileNoteRange();
    if(!range)return null;
    const node=range.commonAncestorContainer;
    return node.nodeType===Node.ELEMENT_NODE?node:node.parentElement
  }

  function scheduleMobileNoteSave(){
    if(activeDocumentType!=="note"||!activeDocumentId)return;
    pendingNoteSave={noteId:String(activeDocumentId),content:noteHtmlForStorage()};
    if(noteSaveTimer)clearTimeout(noteSaveTimer);
    noteSaveTimer=setTimeout(()=>{noteSaveTimer=0;flushMobileNoteSave()},220)
  }

  function flushMobileNoteSave(){
    if(noteSaveTimer){clearTimeout(noteSaveTimer);noteSaveTimer=0}
    const payload=pendingNoteSave;
    pendingNoteSave=null;
    if(!payload)return noteSaveChain;
    noteSaveChain=noteSaveChain.then(async()=>{
      const state=snapshot(),note=(state.notes||[]).find(item=>String(item?.id||"")===payload.noteId);
      if(!note||String(note.content||"")===payload.content)return;
      note.content=payload.content;
      note.updatedAt=new Date().toISOString();
      await repository.replaceState(state);
      if(!libraryScreen.hidden)renderLibrary()
    }).catch(error=>{
      if(!pendingNoteSave)pendingNoteSave=payload;
      console.error("모바일 노트 저장 실패",error);
      logDiagnostic("error","REPOSITORY","노트 본문 저장에 실패했습니다.",error)
    });
    return noteSaveChain
  }

  function execMobileNoteCommand(command,value=null){
    if(activeDocumentType!=="note")return false;
    restoreMobileNoteSelection();
    let ok=false;
    try{
      if(["foreColor","hiliteColor","fontName"].includes(command))document.execCommand("styleWithCSS",false,true);
      ok=document.execCommand(command,false,value)
    }catch(error){
      logDiagnostic("warn","NOTE","노트 서식을 적용하지 못했습니다: "+command,error)
    }finally{
      if(["foreColor","hiliteColor","fontName"].includes(command))try{document.execCommand("styleWithCSS",false,false)}catch{}
    }
    captureMobileNoteSelection();
    updateMobileNoteFormatState();
    scheduleMobileNoteSave();
    return ok
  }

  function mobileNoteBlocksForSelection(){
    const editor=noteReaderContent,range=restoreMobileNoteSelection(),selector="p,div,h1,h2,h3,blockquote,li";
    if(!range)return [];
    let node=range.commonAncestorContainer;
    node=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;
    if(range.collapsed){
      const block=node?.closest?.(selector);
      return block&&block!==editor&&editor.contains(block)?[block]:[]
    }
    return [...editor.querySelectorAll(selector)].filter(block=>{
      try{return range.intersectsNode(block)}catch{return false}
    })
  }

  function applyMobileNoteLineHeight(value){
    const parsed=Math.min(3,Math.max(1,Number(value)||1.6));
    let blocks=mobileNoteBlocksForSelection();
    if(!blocks.length){
      execMobileNoteCommand("formatBlock","p");
      blocks=mobileNoteBlocksForSelection()
    }
    for(const block of blocks){
      if(Math.abs(parsed-1.6)<.001)block.style.removeProperty("line-height");
      else block.style.lineHeight=String(parsed)
    }
    captureMobileNoteSelection();
    updateMobileNoteFormatState();
    scheduleMobileNoteSave()
  }

  function insertMobileNoteLink(){
    const elementAtSelection=mobileNoteSelectionElement(),anchor=elementAtSelection?.closest?.("a");
    if(anchor){execMobileNoteCommand("unlink");return}
    captureMobileNoteSelection();
    const url=window.prompt("연결할 주소를 입력하세요.","https://");
    if(url)execMobileNoteCommand("createLink",url)
  }

  function insertMobileNoteDivider(){
    restoreMobileNoteSelection();
    execMobileNoteCommand("insertHorizontalRule")
  }

  function insertMobileNoteFold(){
    const editor=noteReaderContent,range=restoreMobileNoteSelection();
    if(!range)return;
    const details=document.createElement("details"),summary=document.createElement("summary"),body=document.createElement("p");
    summary.textContent="접기";
    body.append(document.createElement("br"));
    details.open=true;
    details.append(summary,body);
    let node=range.startContainer;
    node=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;
    const block=node?.closest?.("p,div,h1,h2,h3,blockquote,li,pre");
    if(block&&block!==editor&&editor.contains(block))block.after(details);
    else range.insertNode(details);
    const caret=document.createRange();
    caret.selectNodeContents(summary);
    caret.collapse(false);
    const selection=window.getSelection();
    selection.removeAllRanges();
    selection.addRange(caret);
    noteSavedRange=caret.cloneRange();
    scheduleMobileNoteSave();
    updateMobileNoteFormatState()
  }

  function closeMobileNoteFormatPanel(){
    noteFormatPanelKey="";
    noteFormatPanel.hidden=true;
    noteFormatPanel.replaceChildren();
    noteMobileToolbar.querySelectorAll("[data-note-panel]").forEach(button=>{
      button.classList.remove("active");
      button.setAttribute("aria-expanded","false")
    })
  }

  function mobileNotePanelHtml(key){
    if(key==="basic")return '<div class="note-format-panel-title">글자 기본</div><div class="note-format-grid">'+
      '<button type="button" class="note-format-action" data-note-block="p"><i data-lucide="pilcrow"></i><span>본문</span></button>'+
      '<button type="button" class="note-format-action" data-note-block="h1"><i data-lucide="heading-1"></i><span>제목 1</span></button>'+
      '<button type="button" class="note-format-action" data-note-block="h2"><i data-lucide="heading-2"></i><span>제목 2</span></button>'+
      '<button type="button" class="note-format-action" data-note-block="h3"><i data-lucide="heading-3"></i><span>제목 3</span></button>'+
      '<button type="button" class="note-format-action" data-note-command="bold"><i data-lucide="bold"></i><span>굵게</span></button>'+
      '<button type="button" class="note-format-action" data-note-command="italic"><i data-lucide="italic"></i><span>기울임</span></button>'+
      '<button type="button" class="note-format-action" data-note-command="underline"><i data-lucide="underline"></i><span>밑줄</span></button>'+
      '<button type="button" class="note-format-action" data-note-command="strikeThrough"><i data-lucide="strikethrough"></i><span>취소선</span></button>'+
      '</div>';
    if(key==="decorate")return '<div class="note-format-panel-title">글자 꾸미기</div>'+
      '<label class="note-format-select"><i data-lucide="type"></i><span>글꼴</span><select data-note-font><option value="inherit">기본</option><option value="sans-serif">고딕</option><option value="serif">명조</option><option value="monospace">고정폭</option></select></label>'+
      '<div class="note-format-grid">'+
      '<label class="note-format-action note-color-action"><i data-lucide="paintbrush"></i><span>글자색</span><input type="color" value="#292B38" data-note-color="foreColor" aria-label="글자색"></label>'+
      '<label class="note-format-action note-color-action"><i data-lucide="paint-bucket"></i><span>배경색</span><input type="color" value="#F6D872" data-note-color="hiliteColor" aria-label="배경색"></label>'+
      '<button type="button" class="note-format-action" data-note-command="subscript"><i data-lucide="subscript"></i><span>아래 첨자</span></button>'+
      '<button type="button" class="note-format-action" data-note-command="superscript"><i data-lucide="superscript"></i><span>위 첨자</span></button>'+
      '</div>';
    if(key==="paragraph")return '<div class="note-format-panel-title">문단</div><div class="note-format-grid">'+
      '<button type="button" class="note-format-action" data-note-command="justifyLeft"><i data-lucide="align-left"></i><span>왼쪽</span></button>'+
      '<button type="button" class="note-format-action" data-note-command="justifyCenter"><i data-lucide="align-center"></i><span>가운데</span></button>'+
      '<button type="button" class="note-format-action" data-note-command="justifyRight"><i data-lucide="align-right"></i><span>오른쪽</span></button>'+
      '<button type="button" class="note-format-action" data-note-command="justifyFull"><i data-lucide="align-justify"></i><span>양쪽</span></button>'+
      '<button type="button" class="note-format-action" data-note-command="indent"><i data-lucide="indent-increase"></i><span>들여쓰기</span></button>'+
      '<button type="button" class="note-format-action" data-note-command="outdent"><i data-lucide="indent-decrease"></i><span>내어쓰기</span></button>'+
      '<button type="button" class="note-format-action" data-note-command="insertUnorderedList"><i data-lucide="list"></i><span>목록</span></button>'+
      '<button type="button" class="note-format-action" data-note-command="insertOrderedList"><i data-lucide="list-ordered"></i><span>번호 목록</span></button>'+
      '<button type="button" class="note-format-action" data-note-block="blockquote"><i data-lucide="quote"></i><span>인용문</span></button>'+
      '</div><div class="note-line-height-row"><span><i data-lucide="list-chevrons-up-down"></i>행간</span>'+
      '<button type="button" data-note-line-height="1">100%</button><button type="button" data-note-line-height="1.4">140%</button><button type="button" data-note-line-height="1.6">160%</button><button type="button" data-note-line-height="1.8">180%</button><button type="button" data-note-line-height="2">200%</button></div>';
    return '<div class="note-format-panel-title">삽입</div><div class="note-format-grid">'+
      '<button type="button" class="note-format-action" data-note-insert="link"><i data-lucide="link"></i><span>링크</span></button>'+
      '<button type="button" class="note-format-action" data-note-insert="image" disabled aria-disabled="true" title="모바일 이미지 저장 연결 후 지원"><i data-lucide="image-plus"></i><span>이미지</span></button>'+
      '<button type="button" class="note-format-action" data-note-insert="fold"><i data-lucide="fold-vertical"></i><span>접기</span></button>'+
      '<button type="button" class="note-format-action" data-note-insert="divider"><i data-lucide="minus"></i><span>구분선</span></button>'+
      '</div><p class="note-format-panel-note">이미지는 모바일 Asset 저장 경로를 연결한 뒤 활성화됩니다.</p>'
  }

  function openMobileNoteFormatPanel(key){
    if(noteFormatPanelKey===key){closeMobileNoteFormatPanel();return}
    captureMobileNoteSelection();
    noteFormatPanelKey=key;
    noteFormatPanel.innerHTML=mobileNotePanelHtml(key);
    noteFormatPanel.hidden=false;
    noteMobileToolbar.querySelectorAll("[data-note-panel]").forEach(button=>{
      const active=button.dataset.notePanel===key;
      button.classList.toggle("active",active);
      button.setAttribute("aria-expanded",String(active))
    });
    refreshLucideIcons();
    updateMobileNoteFormatState()
  }

  function updateMobileNoteFormatState(){
    if(!noteFormatPanelKey||noteFormatPanel.hidden)return;
    const stateful=new Set(["bold","italic","underline","strikeThrough","subscript","superscript","justifyLeft","justifyCenter","justifyRight","justifyFull","insertUnorderedList","insertOrderedList"]);
    noteFormatPanel.querySelectorAll("[data-note-command]").forEach(button=>{
      const command=button.dataset.noteCommand;
      let active=false;
      if(stateful.has(command))try{active=!!document.queryCommandState(command)}catch{}
      button.classList.toggle("active",active)
    });
    const node=mobileNoteSelectionElement(),block=node?.closest?.("p,div,h1,h2,h3,blockquote,li");
    noteFormatPanel.querySelectorAll("[data-note-block]").forEach(button=>{
      const tag=button.dataset.noteBlock.toUpperCase();
      button.classList.toggle("active",block?.tagName===tag)
    });
    const lineHeight=String(block?.style?.lineHeight||"1.6");
    noteFormatPanel.querySelectorAll("[data-note-line-height]").forEach(button=>button.classList.toggle("active",button.dataset.noteLineHeight===lineHeight))
  }

  function renderNote(note){
    $("#noteReaderTitle").textContent=note.title||"제목 없는 노트";
    $("#noteReaderSubtitle").textContent=note.subtitle||"";
    $("#noteReaderSubtitle").hidden=!note.subtitle;
    closeMobileNoteFormatPanel();
    noteSavedRange=null;
    noteReaderContent.dataset.noteId=String(note.id||"");
    noteReaderContent.innerHTML=sanitizedNoteHtml(note.content||"");
    hydrateNoteImages(note).catch(error=>logDiagnostic("warn","ASSET","노트 이미지를 표시하지 못했습니다.",error))
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
      if(node.nodeColor||node.color){
        const nodeColor=safeColor(node.nodeColor||node.color,"");
        if(nodeColor)box.style.setProperty("--node-color",nodeColor)
      }
      if(node.type==="image"&&node.assetId){
        box.classList.add("image-node");
        box.style.height=`${pos.h}px`;
        const image=element("img","mindmap-readonly-image");
        image.alt=String(node.title||node.assetName||"마인드맵 이미지");
        image.hidden=true;
        const placeholder=element("span","mindmap-image-placeholder","이미지 불러오는 중");
        box.append(image,placeholder);
        hydrateAssetImage(image,node.assetId).then(loaded=>{
          if(!box.isConnected)return;
          image.hidden=!loaded;
          placeholder.textContent=loaded?"":String(node.assetName||node.title||"이미지를 불러오지 못했습니다.");
          placeholder.hidden=loaded
        }).catch(error=>logDiagnostic("warn","ASSET","마인드맵 이미지를 표시하지 못했습니다.",error))
      }else{
        const kind=element("span","mindmap-node-kind",String(node.type||"노드"));
        const label=element("strong","",node.title||node.text||node.assetName||"노드");
        box.append(kind,label);
        if(node.title&&node.text)box.append(element("p","",node.text))
      }
      nodesHost.append(box)
    }
    for(const edge of mindmap.edges||[]){
      const from=positions.get(String(edge.from||"")),to=positions.get(String(edge.to||""));
      if(!from||!to)continue;
      const line=document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1",String(from.cx));line.setAttribute("y1",String(from.cy));line.setAttribute("x2",String(to.cx));line.setAttribute("y2",String(to.cy));
      line.setAttribute("class","mindmap-readonly-edge");
      if(edge.color){
        const edgeColor=safeColor(edge.color,"");
        if(edgeColor)line.setAttribute("style",`stroke:${edgeColor}`)
      }
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

  function syncCheckpointForTopology(objects,topology){
    const revisions=new Map((topology.path||[]).map((item,index)=>[String(item.revision||""),index]));
    return (objects||[]).filter(item=>item?.syncType==="checkpoint"&&String(item.objectKey||"").startsWith("sync/checkpoints/")&&revisions.has(String(item.revision||"")))
      .sort((a,b)=>revisions.get(String(b.revision||""))-revisions.get(String(a.revision||""))||Number(b.createdAtMs||0)-Number(a.createdAtMs||0))[0]||null
  }

  async function readCloudCheckpoint(object){
    const result=await googleDrive.getSyncObject({remoteObjectId:String(object?.remoteObjectId||""),objectKey:String(object?.objectKey||""),contentSha256:String(object?.contentSha256||""),byteSize:Number(object?.byteSize)||0});
    let checkpoint;
    try{checkpoint=JSON.parse(String(result.content||""))}catch{throw new Error("sync-checkpoint-json-invalid")}
    if(checkpoint?.format!=="hamboard-sync-checkpoint"||checkpoint?.formatVersion!==1||checkpoint?.stateSchemaVersion!==1||String(checkpoint.revision||"")!==String(object?.revision||"")||!checkpoint.state||typeof checkpoint.state!=="object"||Array.isArray(checkpoint.state)||Number(checkpoint.state.schemaVersion)!==1)throw new Error("sync-checkpoint-header-invalid");
    return checkpoint
  }

  async function restoreCloudProjection(projected,{loadAssets,onAssetProgress=()=>{}}={}){
    await repository.replaceState(projected,{markBaseline:true});
    const assetResult=loadAssets?await loadAssets(snapshot(),onAssetProgress):{wanted:0,downloaded:0,cached:0,unresolved:[]};
    applyMobileTheme();
    renderAccountButton();
    openLibrary();
    return {state:snapshot(),assets:assetResult}
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

  function updateCloudSyncProgress(runId,message,percent=null){
    if(runId!==cloudSyncProgressRun)return false;
    cloudSourceStatus.hidden=false;
    if(Number.isFinite(percent)){
      const next=Math.max(cloudSyncLastPercent,Math.min(100,Math.max(0,Math.round(percent))));
      cloudSyncLastPercent=next;
      cloudSourceStatus.textContent=`${message} ${next}%`
    }else cloudSourceStatus.textContent=String(message||"");
    return true
  }

  async function syncFromCloud(listing=cloudSyncListing){
    if(cloudSyncImportPromise)return cloudSyncImportPromise;
    const runId=++cloudSyncProgressRun;
    cloudSyncLastPercent=0;
    const operation=(async()=>{
      if(!googleDrive)throw new Error("google-drive-web-transport-unavailable");
      if(!listing){
        const fast=googleDrive.listSyncRestoreSource?await googleDrive.listSyncRestoreSource():null;
        listing=fast||await googleDrive.listSyncObjects()
      }
      if(listing.truncated)throw new Error("sync-object-list-truncated");
      const objects=listing.objects||[],fastMode=listing.fast===true;
      let topology=fastMode?null:commitTopology(objects),head=fastMode?listing.head:topology?.head;
      if(!head)throw new Error("sync-import-empty");

      if(navigator.onLine!==false)setIndicator("connected","동기화 중");
      updateCloudSyncProgress(runId,"동기화 스냅샷을 불러오는 중입니다.",0);
      const checkpointObject=fastMode?listing.checkpoint:syncCheckpointForTopology(objects,topology);
      let canonical,checkpointRevision="",tail=fastMode?[...(listing.commits||[])]:topology.path;
      if(checkpointObject){
        const checkpoint=await readCloudCheckpoint(checkpointObject);
        canonical=syncModel.projectCanonicalState(checkpoint.state,syncModel.CLIENT_PROFILES.desktop);
        checkpointRevision=String(checkpoint.revision||"");
        if(!fastMode){
          const checkpointIndex=topology.path.findIndex(item=>String(item.revision||"")===checkpointRevision);
          tail=checkpointIndex>=0?topology.path.slice(checkpointIndex+1):topology.path
        }
        updateCloudSyncProgress(runId,"동기화 스냅샷을 적용하는 중입니다.",35)
      }else{
        canonical=syncModel.projectCanonicalState({},syncModel.CLIENT_PROFILES.desktop);
        logDiagnostic("warn","SYNC","기존 동기화에 스냅샷이 없어 이번 한 번은 전체 기록을 재생합니다.")
      }
      let downloadedCommits=0;
      const commits=await mapWithConcurrency(tail,6,async object=>{
        const commit=await readCloudCommit(object);
        downloadedCommits++;
        const start=checkpointObject?35:0,span=checkpointObject?25:60;
        updateCloudSyncProgress(runId,"최신 변경사항을 적용하는 중입니다.",start+downloadedCommits/Math.max(1,tail.length)*span);
        return commit
      });
      for(const commit of commits)canonical=syncModel.applyCommitToCanonical(canonical,commit);
      const projected=syncModel.projectCanonicalState(canonical,syncModel.CLIENT_PROFILES.mobileCore);
      updateCloudSyncProgress(runId,"현재 문서의 이미지를 확인하고 있습니다.",60);
      const restored=await restoreCloudProjection(projected,{
        loadAssets:(stateValue,onProgress)=>downloadCurrentSyncAssets(listing,stateValue,onProgress),
        onAssetProgress:progress=>{
          const ratio=progress.total?progress.completed/progress.total:1;
          updateCloudSyncProgress(runId,"현재 문서의 이미지를 불러오는 중입니다.",60+ratio*40)
        }
      });
      if(restored.assets.unresolved.length)logDiagnostic("warn","ASSET",`동기화 이미지 ${restored.assets.unresolved.length}개를 아직 불러오지 못했습니다.`);
      cloudSyncListing=listing;
      const headRevision=String(head.revision);
      if((!checkpointObject||tail.length>=8)&&googleDrive.putSyncCheckpoint)try{
        const published=await googleDrive.putSyncCheckpoint({revision:headRevision,state:canonical});
        listing.objects=[...(listing.objects||[]),published];listing.checkpoint=published;listing.commits=[];listing.fast=true;
        logDiagnostic("info","SYNC",`동기화 스냅샷을 생성했습니다. revision=${headRevision}`)
      }catch(error){logDiagnostic("warn","SYNC","동기화 스냅샷 생성에 실패했습니다. 다음 동기화에서 다시 시도합니다.",error)}
      return {empty:false,revision:headRevision,checkpointRevision,tailCommits:tail.length,assets:restored.assets,state:restored.state}
    })();
    const shared=operation.finally(()=>{if(cloudSyncImportPromise===shared)cloudSyncImportPromise=null});
    cloudSyncImportPromise=shared;
    return shared
  }

  function setCloudSourceBusy(busy){
    const active=busy||!!cloudSyncImportPromise;
    loadSyncSource.disabled=active||!cloudSyncListing;
    cloudDisconnect.disabled=active;
    backupSourceList.querySelectorAll("button").forEach(button=>button.disabled=active)
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
    if(cloudSyncImportPromise){setCloudSourceBusy(true);return}
    if(!googleDrive?.status?.().connected)return;
    cloudSourceStatus.hidden=false;
    cloudSourceStatus.textContent="클라우드 데이터를 확인하고 있습니다.";
    syncSourceMeta.textContent="확인 중…";
    loadSyncSource.disabled=true;
    backupSourceList.replaceChildren(element("div","cloud-source-empty","백업 복원 목록을 확인하고 있습니다."));
    const syncLookup=(async()=>{const fast=googleDrive.listSyncRestoreSource?await googleDrive.listSyncRestoreSource():null;return fast||await googleDrive.listSyncObjects()})();
    const [syncResult,backupResult]=await Promise.allSettled([syncLookup,googleDrive.listBackups()]);
    const problems=[];

    cloudSyncListing=null;
    if(syncResult.status==="fulfilled"){
      try{
        if(syncResult.value.truncated)throw new Error("sync-object-list-truncated");
        const head=syncResult.value.fast===true?syncResult.value.head:commitTopology(syncResult.value.objects||[]).head;
        if(head){
          cloudSyncListing=syncResult.value;
          syncSourceMeta.textContent=`최근 동기화 · ${formatCloudTime(head.createdAtMs)}`;
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
      const canonical=manifest?.state;
      if(!canonical||typeof canonical!=="object"||Array.isArray(canonical))throw new Error("mobile-state-invalid");
      const projection=syncModel.projectCanonicalState(canonical,syncModel.CLIENT_PROFILES.mobileCore);
      cloudSourceStatus.textContent="백업 스냅샷을 적용하는 중입니다. 60%";
      const restored=await restoreCloudProjection(projection,{
        loadAssets:(stateValue,onProgress)=>downloadCurrentBackupAssets(manifest,stateValue,onProgress),
        onAssetProgress:progress=>{
          const ratio=progress.total?progress.completed/progress.total:1;
          cloudSourceStatus.textContent=`현재 문서의 이미지를 불러오는 중입니다. ${Math.round(60+ratio*40)}%`
        }
      });
      if(restored.assets.unresolved.length)logDiagnostic("warn","ASSET",`백업 이미지 ${restored.assets.unresolved.length}개를 아직 불러오지 못했습니다.`)
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
    if(cloudSyncImportPromise)return cloudSyncImportPromise;
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

  function installNoteViewportTracking(){
    window.addEventListener("resize",scheduleNoteViewportSync,{passive:true});
    if(window.visualViewport){
      window.visualViewport.addEventListener("resize",scheduleNoteViewportSync,{passive:true});
      window.visualViewport.addEventListener("scroll",scheduleNoteViewportSync,{passive:true})
    }
    noteReaderContent.addEventListener("focusin",scheduleNoteViewportSync);
    noteReaderContent.addEventListener("focusout",()=>setTimeout(scheduleNoteViewportSync,0));
    scheduleNoteViewportSync()
  }

  async function start(){
    try{
      await repository.load();
      applyMobileTheme();
      logDiagnostic("info","APP","모바일 저장소를 열었습니다.");
      const match=location.hash.match(/^#(project|note|mindmap)\/(.+)$/);
      history.replaceState({hamboard:true,view:"home"},"",appBaseUrl());
      renderHome();
      installNoteViewportTracking();
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
  noteReaderContent.addEventListener("input",()=>{
    captureMobileNoteSelection();
    scheduleMobileNoteSave();
    updateMobileNoteFormatState()
  });
  noteReaderContent.addEventListener("keyup",()=>{captureMobileNoteSelection();updateMobileNoteFormatState()});
  noteReaderContent.addEventListener("pointerup",()=>{captureMobileNoteSelection();updateMobileNoteFormatState()});
  noteReaderContent.addEventListener("focus",captureMobileNoteSelection);
  noteMobileToolbar.addEventListener("pointerdown",event=>{
    if(event.target.closest("button"))captureMobileNoteSelection()
  });
  noteMobileToolbar.addEventListener("click",event=>{
    const keyboardButton=event.target.closest("[data-note-keyboard-dismiss]");
    if(keyboardButton){
      captureMobileNoteSelection();
      noteReaderContent.blur();
      keyboardButton.blur();
      scheduleNoteViewportSync();
      return
    }
    const commandButton=event.target.closest("[data-note-command]");
    if(commandButton){execMobileNoteCommand(commandButton.dataset.noteCommand);return}
    const panelButton=event.target.closest("[data-note-panel]");
    if(panelButton)openMobileNoteFormatPanel(panelButton.dataset.notePanel)
  });
  noteFormatPanel.addEventListener("pointerdown",event=>{
    const button=event.target.closest("button");
    if(button&&!button.disabled)captureMobileNoteSelection();
    else if(event.target.closest("select,input"))captureMobileNoteSelection()
  });
  noteFormatPanel.addEventListener("click",event=>{
    const commandButton=event.target.closest("[data-note-command]");
    if(commandButton){execMobileNoteCommand(commandButton.dataset.noteCommand);return}
    const blockButton=event.target.closest("[data-note-block]");
    if(blockButton){execMobileNoteCommand("formatBlock",blockButton.dataset.noteBlock);return}
    const lineButton=event.target.closest("[data-note-line-height]");
    if(lineButton){applyMobileNoteLineHeight(lineButton.dataset.noteLineHeight);return}
    const insertButton=event.target.closest("[data-note-insert]");
    if(!insertButton||insertButton.disabled)return;
    if(insertButton.dataset.noteInsert==="link")insertMobileNoteLink();
    else if(insertButton.dataset.noteInsert==="fold")insertMobileNoteFold();
    else if(insertButton.dataset.noteInsert==="divider")insertMobileNoteDivider()
  });
  noteFormatPanel.addEventListener("change",event=>{
    const font=event.target.closest("[data-note-font]");
    if(font){execMobileNoteCommand("fontName",font.value);return}
    const color=event.target.closest("[data-note-color]");
    if(color)execMobileNoteCommand(color.dataset.noteColor,color.value)
  });
  document.addEventListener("selectionchange",()=>{
    if(activeDocumentType!=="note")return;
    const selection=window.getSelection();
    if(selection?.rangeCount&&noteReaderContent.contains(selection.anchorNode)){
      noteSavedRange=selection.getRangeAt(0).cloneRange();
      updateMobileNoteFormatState()
    }
  });
  window.addEventListener("pagehide",()=>{flushMobileNoteSave()});
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
  mobileScroll.addEventListener("scroll",()=>{
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
    start,repository,assetRepository,importCanonicalState,applyCloudCommits,syncFromCloud,commitTopology,readCloudCheckpoint,readCloudCommit,openDocument,closeDocument,openLibrary,openMenu,openSettings,openCloudSources,refreshCloudSources,snapshot
  });
  start();
})();
