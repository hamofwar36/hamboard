(function(){
  "use strict";

  const syncModel=window.HamboardSyncStateModel;
  const cloudPayload=window.HamboardCloudPayload;
  const repositoryCore=window.HamboardProjectRepository;
  const googleDrive=window.HamboardMobileGoogleDrive;
  const assetRepositoryCore=window.HamboardMobileAssetRepository;
  if(!syncModel||!cloudPayload||!repositoryCore||!assetRepositoryCore)throw new Error("hamboard-mobile-dependencies-unavailable");
  const syncEngineCore=window.HamboardMobileSyncEngine,syncCoordination=window.HamboardSyncCoordination;
  if(!syncEngineCore||!syncCoordination)throw new Error("hamboard-mobile-sync-dependencies-unavailable");

  const storage=repositoryCore.createIndexedDbStateStorage({databaseName:"hamboard-mobile",storeName:"state",stateKey:"mobile-core"});
  const baseRepository=repositoryCore.createProjectRepository({storage,syncModel,clientProfile:"mobile-core"});
  // Every UI write goes through guardedReplaceState: read-only guard, stale-snapshot rebase, sync notification.
  const repository=Object.freeze({...baseRepository,replaceState:(value,options)=>guardedReplaceState(value,options)});
  let syncEngine=null,stateGeneration=0;
  const snapshotGenerations=new WeakMap(),preApplyStates=new Map();
  const assetRepository=assetRepositoryCore.createIndexedDbAssetRepository({databaseName:"hamboard-mobile-assets",storeName:"assets"});
  const $=selector=>document.querySelector(selector);

  const mobileScroll=$("#mobileApp");
  const libraryScreen=$("#libraryScreen");
  const projectReaderScreen=$("#projectReaderScreen");
  const blockEditorScreen=$("#projectBlockEditorScreen");
  const blockEditorKind=$("#blockEditorKind");
  const blockEditorMainSection=$("#blockEditorMainSection");
  const blockEditorScriptSection=$("#blockEditorScriptSection");
  const blockEditorScriptRows=$("#blockEditorScriptRows");
  const blockEditorScriptPreview=$("#blockEditorScriptPreview");
  const blockEditorScriptAddType=$("#blockEditorScriptAddType");
  const blockEditorScriptTypeMenu=$("#blockEditorScriptTypeMenu");
  const blockEditorScriptAdd=$("#blockEditorScriptAdd");
  const blockEditorContext=$("#blockEditorContext");
  const blockEditorTitle=$("#blockEditorTitle");
  const blockEditorSummary=$("#blockEditorSummary");
  const blockEditorNotes=$("#blockEditorNotes");
  const blockEditorCompletion=$("#blockEditorCompletion");
  const blockEditorStatus=$("#blockEditorStatus");
  const blockEditorDelete=$("#blockEditorDelete");
  const blockEditorFormatBar=$("#blockEditorFormatBar");
  const blockEditorFormatColor=$("#blockEditorFormatColor");
  const blockEditorFormatBlock=$("#blockEditorFormatBlock");
  const noteReaderScreen=$("#noteReaderScreen");
  const noteReaderContent=$("#noteReaderContent");
  const noteEditorControls=$("#noteEditorControls");
  const noteFormatPanel=$("#noteFormatPanel");
  const noteMobileToolbar=$("#noteMobileToolbar");
  const noteKeyboardToggle=$("#noteKeyboardToggle");
  const noteMoreButton=$("#noteMoreButton");
  const noteMoreMenu=$("#noteMoreMenu");
  const noteHtmlMenuLabel=$("#noteHtmlMenuLabel");
  const noteCharCountSummary=$("#noteCharCountSummary");
  const noteHtmlShell=$("#noteHtmlShell");
  const noteHtmlEditor=$("#noteHtmlEditor");
  const noteHtmlStatus=$("#noteHtmlStatus");
  const mindmapReaderScreen=$("#mindmapReaderScreen");
  const menuScreen=$("#menuScreen");
  const trashScreen=$("#trashScreen");
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
  const createActions=$("#createActions");
  const createDelete=$("#createDelete");
  const createSubmit=$("#createSubmit");
  const menuCloud=$("#menuCloud");
  const menuDisplay=$("#menuDisplay");
  const menuAppInfo=$("#menuAppInfo");
  const menuTrash=$("#menuTrash");
  const menuTrashMeta=$("#menuTrashMeta");
  const trashSubtitle=$("#trashSubtitle");
  const trashList=$("#trashList");
  const emptyTrashButton=$("#emptyTrashButton");
  const displaySettingsSection=$("#displaySettingsSection");
  const infoSettingsSection=$("#infoSettingsSection");
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

  let currentScreen=libraryScreen;
  let activeDocumentType="";
  let activeDocumentId="";
  let activeEpisodeId="";
  let activeBlockEditor=null;
  let blockSaveTimer=0;
  let blockSaveChain=Promise.resolve();
  let blockFormatRange=null;
  let blockFormatEditor=null;
  let blockFormatFrame=0;
  let cloudSyncListing=null;
  let cloudSyncImportPromise=null;
  let cloudSyncProgressRun=0;
  let cloudSyncLastPercent=0;
  let cloudBackupEntries=[];
  let cloudReturnView="library";
  let silentReconnectFailed=false;
  let silentReconnectPromise=null;
  let activeCreateType="";
  let activeEditDocument=null;
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
  let noteKeyboardSuppressed=false;
  let noteSaveTimer=0;
  let pendingNoteSave=null;
  let noteSaveChain=Promise.resolve();
  let noteEditorMode="rich";
  let noteHtmlSaveTimer=0;
  let pendingNoteHtmlSave=null;
  let noteHtmlDirty=false;
  let createColorExpanded=false;
  const diagnostics=[];
  const CARD_COLORS=Object.freeze(["#FFB8AE","#FFA8B8","#FFCBA8","#FFB877","#F6D872","#D4E88A","#C8E0B0","#BDE7C4","#AEE9C8","#8FE0D2","#A0E4F0","#A9D6FF","#B0C4DE","#A9B4F2","#CBB8FF","#C9A0DE","#E0A0C8","#F2A6E0","#D2D2D2"]);
  const DEFAULT_STAGE_COLORS=Object.freeze([CARD_COLORS[11],CARD_COLORS[7],CARD_COLORS[4],CARD_COLORS[0]]);
  const MOBILE_SCRIPT_TYPES=Object.freeze({narration:"지문",dialogue:"대사",background:"배경",direction:"연출",page:"페이지",cut:"컷"});
  const MOBILE_SHOT_PRESETS=Object.freeze(["클로즈업","흉상","반신","풀샷","익스트림 클로즈업","오버더숄더","버드아이뷰","하이앵글","로우앵글","임팩트"]);
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
  const snapshot=()=>{const value=baseRepository.snapshot();snapshotGenerations.set(value,stateGeneration);return value};
  const folderName=(id,state)=>state?.folders?.find(folder=>String(folder?.id||"")===String(id||""))?.name||"";
  const allBlocks=unit=>{const result=[],walk=nodes=>(nodes||[]).forEach(node=>{result.push(node);walk(node.children)});for(const stage of unit?.stageDefs||[])walk(unit?.stages?.[stage.id]);return result};
  const projectStats=project=>{const units=project.kind==="long"?(project.episodes||[]):[project],blocks=units.flatMap(allBlocks);return {units:units.length,blocks:blocks.length,completed:blocks.filter(block=>block.completed).length}};
  const scriptLabels={...MOBILE_SCRIPT_TYPES,shot:"구도"};

  const uid=()=>globalThis.crypto?.randomUUID?.()||`mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  const randomCardColor=()=>CARD_COLORS[Math.floor(Math.random()*CARD_COLORS.length)]||CARD_COLORS[0];

  function defaultStoryStages(){
    const stageDefs=["기","승","전","결"].map((name,index)=>({id:uid(),name,hint:"",color:DEFAULT_STAGE_COLORS[index]}));
    const stages={};
    for(const stage of stageDefs)stages[stage.id]=[];
    return {stageDefs,stages}
  }

  function moveMobileStoryItem(state,move){
    const project=(state.projects||[]).find(item=>String(item?.id||"")===move.projectId);
    if(!project)return false;
    const unit=project.kind==="long"?(project.episodes||[]).find(item=>String(item?.id||"")===move.episodeId):project;
    const insert=(source,destination,from,to)=>{
      if(from<0||from>=source.length||to<0||to>destination.length)return false;
      const index=source===destination&&from<to?to-1:to;
      if(source===destination&&from===index)return false;
      destination.splice(index,0,source.splice(from,1)[0]);
      return true
    };
    let changed=false;
    if(move.kind==="episode"){
      if(project.kind!=="long")return false;
      const list=project.episodes||[],from=list.findIndex(item=>String(item?.id||"")===move.sourceId),target=list.findIndex(item=>String(item?.id||"")===move.targetId);
      if(target<0)return false;
      const defaultTitles=new Set(list.filter((item,index)=>String(item?.title||"")===`${index+1}화`).map(item=>String(item.id)));
      changed=insert(list,list,from,target+(move.after?1:0));
      if(changed)list.forEach((item,index)=>{if(defaultTitles.has(String(item.id)))item.title=`${index+1}화`})
    }else if(move.kind==="stage"){
      if(!unit)return false;
      const list=unit.stageDefs||[],from=list.findIndex(item=>String(item?.id||"")===move.sourceId),target=list.findIndex(item=>String(item?.id||"")===move.targetId);
      if(target<0)return false;
      changed=insert(list,list,from,target+(move.after?1:0))
    }else if(move.kind==="block"){
      if(!unit||!unit.stages||typeof unit.stages!=="object")return false;
      const source=unit.stages[move.sourceStageId],destination=unit.stages[move.targetStageId];
      if(!Array.isArray(source)||!Array.isArray(destination))return false;
      const from=move.sourceId?source.findIndex(item=>String(item?.id||"")===move.sourceId):move.sourceIndex;
      const target=move.targetId?destination.findIndex(item=>String(item?.id||"")===move.targetId):move.targetIndex;
      if(target<0)return false;
      changed=insert(source,destination,from,target+(move.after?1:0))
    }
    if(changed)project.updatedAt=new Date().toISOString();
    return changed
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
        rows.push({id,name:String(folder.name||"제목 없는 폴더"),depth});
        walk(children.get(id)||[],depth+1)
      }
    };
    walk(roots,0);
    for(const folder of folders){
      const id=String(folder?.id||"");
      if(id&&!seen.has(id))rows.push({id,name:String(folder.name||"제목 없는 폴더"),depth:0})
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
    activeEditDocument=null;
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
    createDelete.hidden=true;
    createActions.classList.remove("editing");
    createFormBack.textContent="이전";
    createSubmit.innerHTML='<i data-lucide="plus" aria-hidden="true"></i><span>만들기</span>';
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
    activeEditDocument=null;
    activeCreateType=type;
    createProjectKindValue="short";
    createChooser.hidden=true;
    createForm.hidden=false;
    createProjectKind.hidden=type!=="project";
    createSubtitleField.hidden=false;
    createDelete.hidden=true;
    createActions.classList.remove("editing");
    createFormBack.textContent="이전";
    createSubmit.innerHTML='<i data-lucide="plus" aria-hidden="true"></i><span>만들기</span>';
    createTitleLabel.textContent="제목";
    createSubtitleField.querySelector("span").innerHTML="부제 <small>· 선택</small>";
    createFolderLabel.innerHTML=type==="folder"?"상위 폴더 <small>· 선택</small>":"폴더 <small>· 선택</small>";
    createFormKind.textContent=`새 ${config.label}`;
    createFormIcon.innerHTML=`<i data-lucide="${config.icon}" aria-hidden="true"></i>`;
    createSheet.classList.add("form-open");
    createTitleInput.value=config.defaultTitle;
    createSubtitleInput.value="";
    createSubtitleInput.placeholder="부제 입력";
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

  function documentCollectionKey(type){
    return type==="project"?"projects":type==="note"?"notes":type==="mindmap"?"mindmaps":""
  }

  function openDocumentEditForm(type,id){
    const config=CREATE_TYPES[type],key=documentCollectionKey(type);
    if(!config||!key)return;
    const state=snapshot(),item=(state[key]||[]).find(row=>String(row?.id||"")===String(id||""));
    if(!item)return;
    activeCreateType=type;
    activeEditDocument={type,id:String(item.id||"")};
    createChooser.hidden=true;
    createForm.hidden=false;
    createProjectKind.hidden=true;
    createSubtitleField.hidden=false;
    createTitleLabel.textContent="제목";
    createSubtitleField.querySelector("span").innerHTML='부제 <small>· 선택</small>';
    createFolderLabel.innerHTML='폴더 <small>· 선택</small>';
    createFormKind.textContent=config.label+" 정보 편집";
    createFormIcon.innerHTML='<i data-lucide="'+safeIcon(item.icon,config.icon)+'" aria-hidden="true"></i>';
    createSheet.classList.add("form-open");
    createTitleInput.value=String(item.title||"");
    createSubtitleInput.value=String(item.subtitle||"");
    createSubtitleInput.placeholder="부제 입력";
    createColorValue=safeColor(item.color,randomCardColor());
    createColorCustom=!CARD_COLORS.some(color=>color.toLowerCase()===createColorValue.toLowerCase());
    createColorExpanded=false;
    createColorField.hidden=false;
    renderCreateColorOptions();
    fillCreateFolderOptions(false);
    createFolderSelect.value=item.folderId?String(item.folderId):"";
    createFormStatus.hidden=true;
    createFormStatus.textContent="";
    createDelete.hidden=false;
    createActions.classList.add("editing");
    createFormBack.textContent="취소";
    createSubmit.innerHTML='<i data-lucide="check" aria-hidden="true"></i><span>저장</span>';
    openBottomSheet(createSheet);
    refreshLucideIcons();
    releaseMobileInputFocus()
  }

  async function saveEditedDocument(){
    const edit=activeEditDocument;
    if(!edit)return;
    const config=CREATE_TYPES[edit.type],key=documentCollectionKey(edit.type),state=snapshot(),list=state[key]||[];
    const index=list.findIndex(item=>String(item?.id||"")===String(edit.id||""));
    if(!config||!key||index<0){
      createFormStatus.textContent="편집할 문서를 찾지 못했습니다.";
      createFormStatus.hidden=false;
      return
    }
    const item=list[index],selectedColor=safeColor(createColorValue,item.color||randomCardColor());
    item.title=createTitleInput.value.trim()||config.defaultTitle;
    item.subtitle=createSubtitleInput.value.trim();
    item.folderId=createFolderSelect.value?String(createFolderSelect.value):null;
    item.color=selectedColor;
    item.updatedAt=new Date().toISOString();
    createSubmit.disabled=true;
    createFormStatus.hidden=true;
    try{
      await repository.replaceState(state);
      closeBottomSheet(createSheet);
      resetCreateSheet();
      renderLibrary()
    }catch(error){
      logDiagnostic("error","REPOSITORY",config.label+" 정보 저장에 실패했습니다.",error);
      createFormStatus.textContent="저장하지 못했습니다. 다시 시도해 주세요.";
      createFormStatus.hidden=false
    }finally{
      createSubmit.disabled=false
    }
  }

  async function deleteEditedDocument(){
    const edit=activeEditDocument;
    if(!edit)return;
    const key=documentCollectionKey(edit.type),state=snapshot(),list=state[key]||[];
    const index=list.findIndex(item=>String(item?.id||"")===String(edit.id||""));
    if(!key||index<0){
      createFormStatus.textContent="삭제할 문서를 찾지 못했습니다.";
      createFormStatus.hidden=false;
      return
    }
    const item=list[index],fallback=CREATE_TYPES[edit.type]?.defaultTitle||"삭제된 문서";
    const confirmed=await openMobileConfirm({
      title:"삭제하시겠습니까?",
      message:"이 문서를 휴지통으로 이동합니다.",
      confirmLabel:"삭제",
      cancelLabel:"취소",
      destructive:true
    });
    if(!confirmed)return;
    createDelete.disabled=true;
    createFormStatus.hidden=true;
    try{
      pushMobileTrash(state,edit.type,item.title||fallback,item,{index});
      list.splice(index,1);
      await repository.replaceState(state);
      closeBottomSheet(createSheet);
      resetCreateSheet();
      renderLibrary()
    }catch(error){
      logDiagnostic("error","REPOSITORY","문서를 휴지통으로 이동하지 못했습니다.",error);
      createDelete.disabled=false;
      createFormStatus.textContent="삭제하지 못했습니다. 다시 시도해 주세요.";
      createFormStatus.hidden=false
    }
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
    if(text.includes("mobile-pending-save-failed"))return "편집 중인 내용을 저장하지 못해 복원을 멈췄습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.";
    if(text.includes("download-integrity")||text.includes("commit-")||text.includes("backup-"))return "클라우드 데이터 검증에 실패했습니다. PC에서 다시 저장한 뒤 시도해 주세요.";
    if(text.includes("http-401")||text.includes("reconnect-required")||text.includes("not-connected"))return "Google Drive 연결을 갱신하지 못했습니다. 다시 로그인해 주세요.";
    return "클라우드에서 데이터를 불러오지 못했습니다. 네트워크와 연결 상태를 확인해 주세요."
  }

  function setIndicator(state,text){indicator.dataset.state=state;indicator.textContent=text}
  function setStatus(message,{action="",run=null}={}){
    const status=$("#libraryStatus");
    status.replaceChildren(element("p","",message));
    if(action&&run){const button=element("button","",action);button.type="button";button.onclick=run;status.append(button)}
    status.hidden=false
  }
  function hideStatus(){$("#libraryStatus").hidden=true}
  function metaChip(text){return element("span","meta-chip",text)}
  function documentScreen(type){
    return type==="project"?projectReaderScreen:type==="note"?noteReaderScreen:type==="mindmap"?mindmapReaderScreen:null
  }
  const appBaseUrl=()=>location.pathname+location.search;
  function appRouteUrl(route){
    return route?.view==="document"&&route.type&&route.id?`${appBaseUrl()}#${route.type}/${encodeURIComponent(route.id)}`:appBaseUrl()
  }
  function writeRoute(route,{replace=false}={}){
    const state={hamboard:true,...route};
    history[replace?"replaceState":"pushState"](state,"",appRouteUrl(state))
  }
  function documentCount(state=snapshot()){return (state.projects||[]).length+(state.notes||[]).length+(state.mindmaps||[]).length}
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
  function releaseMobileInputFocus(){
    const active=document.activeElement;
    if(active&&active!==document.body&&typeof active.blur==="function")active.blur()
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
    const version=String(window.HAMBOARD_MOBILE_CONFIG?.assetVersion||window.HAMBOARD_MOBILE_CONFIG?.version||"dev");
    try{
      await navigator.serviceWorker.register(`./service-worker.js?v=${encodeURIComponent(version)}`,{scope:"./"})
    }catch(error){
      console.error("모바일 서비스 워커 등록 실패",error);
      logDiagnostic("warn","PWA","설치형 웹앱 초기화에 실패했습니다.",error)
    }
  }
  function renderNoteKeyboardToggle(open){
    if(!noteKeyboardToggle)return;
    const state=open?"open":"closed";
    if(noteKeyboardToggle.dataset.keyboardState===state)return;
    noteKeyboardToggle.dataset.keyboardState=state;
    noteKeyboardToggle.setAttribute("aria-label",open?"키보드 내리기":"키보드 띄우기");
    noteKeyboardToggle.title=open?"키보드 내리기":"키보드 띄우기";
    noteKeyboardToggle.innerHTML=`<i data-lucide="${open?"keyboard-off":"keyboard"}" aria-hidden="true"></i>`;
    refreshLucideIcons()
  }

  function syncNoteViewport(){
    noteViewportFrame=0;
    const viewport=window.visualViewport,noteOpen=document.body.classList.contains("note-open");
    if(!noteOpen){
      noteViewportBaseHeight=0;
      document.documentElement.style.setProperty("--note-keyboard-inset","0px");
      document.body.classList.remove("note-keyboard-open");
      renderNoteKeyboardToggle(false);
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
    document.body.classList.toggle("note-keyboard-open",keyboardOpen);
    renderNoteKeyboardToggle(keyboardOpen)
  }
  function scheduleNoteViewportSync(){
    if(noteViewportFrame)return;
    noteViewportFrame=requestAnimationFrame(syncNoteViewport)
  }

  function showScreen(screen,{heading="햄보드",back=false,account=false,nav=""}={}){
    if(currentScreen&&currentScreen!==screen)currentScreen.hidden=true;
    screen.hidden=false;
    currentScreen=screen;
    const blockEditorOpen=screen===blockEditorScreen;
    const documentOpen=screen===projectReaderScreen||screen===noteReaderScreen||screen===mindmapReaderScreen||blockEditorOpen;
    document.body.classList.toggle("document-open",documentOpen);
    document.body.classList.toggle("note-open",screen===noteReaderScreen);
    document.body.classList.toggle("block-editor-open",blockEditorOpen);
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

  function collectMobileTrashAssetIds(item,set=new Set()){
    if(!item)return set;
    const payload=item.payload;
    if(item.type==="project")collectDocumentAssetIds("project",payload,set);
    else if(item.type==="note")collectDocumentAssetIds("note",payload,set);
    else if(item.type==="mindmap")collectDocumentAssetIds("mindmap",payload,set);
    else if(item.type==="resource"&&payload?.id)set.add(String(payload.id));
    else if(item.type==="quickMemo")for(const id of payload?.imageAssetIds||[])if(id)set.add(String(id));
    else if(item.type==="character"){
      if(payload?.avatarAssetId)set.add(String(payload.avatarAssetId));
      for(const id of payload?.imageAssetIds||[])if(id)set.add(String(id))
    }else if(item.type==="folder"){
      for(const row of payload?.projects||[])collectDocumentAssetIds("project",row?.data,set);
      for(const row of payload?.notes||[])collectDocumentAssetIds("note",row?.data,set);
      for(const row of payload?.mindmaps||[])collectDocumentAssetIds("mindmap",row?.data,set)
    }
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
    for(const item of stateValue.trash||[])collectMobileTrashAssetIds(item,ids);
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
      const {type,item}=entry,descriptor=documentDescriptor(type,item,state),card=element("article",`project-card ${type==="project"?"story-card":type==="note"?"note-card":"mindmap-card"}`);
      card.dataset.documentType=type;
      card.dataset.documentId=String(item.id||"");
      card.style.setProperty("--card-color",descriptor.color);
      const cardInk=cardForeground(descriptor.color);
      if(cardInk){
        card.style.setProperty("--custom-on",cardInk);
        card.style.setProperty("--custom-muted",cardInk)
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

      const fallbackTitle=type==="project"?"제목 없는 작품":type==="note"?"제목 없는 노트":"제목 없는 마인드맵";
      const heading=element("div","project-title",item.title||fallbackTitle);
      const open=element("button","project-card-open");
      open.type="button";
      open.setAttribute("aria-label",(item.title||fallbackTitle)+" 열기");
      open.onclick=()=>openDocument(type,item.id);
      const menu=element("button","document-card-menu");
      menu.type="button";
      menu.setAttribute("aria-label",(item.title||fallbackTitle)+" 정보 편집");
      menu.title="문서 정보 편집";
      menu.innerHTML='<i data-lucide="ellipsis-vertical" aria-hidden="true"></i>';
      menu.onclick=event=>{event.stopPropagation();openDocumentEditForm(type,item.id)};

      card.append(background,veil,folder,heading);
      if(item.cardImageAssetId)hydrateLibraryCardImage(card,item.cardImageAssetId);
      if(descriptor.subtitle)card.append(element("div","work-card-subtitle",descriptor.subtitle));
      if(descriptor.meta)card.append(element("div","project-meta",descriptor.meta));
      card.append(open,menu);
      host.append(card)
    }
    refreshLucideIcons()
  }

  function compactBlockPreview(block){
    if(block.type==="script"){
      return (block.scriptBlocks||[])
        .map(line=>{
          const text=String(line?.text||"").trim(),speaker=line?.type==="dialogue"?String(line?.speaker||"").trim():"";
          if(!text&&!speaker)return "";
          if(line.type==="background")return "# "+text;
          if(line.type==="direction")return "- "+text;
          return speaker&&text?speaker+": "+text:text||speaker
        })
        .filter(Boolean)
        .slice(0,4)
        .join("\n")
    }
    return String(block.summary||"").trim()
  }

  function blockElement(block,{compact=false,stageId="",blockIndex=-1}={}){
    const editable=Boolean(stageId);
    const card=element("article","block-card"+(compact?" compact-block-card":"")+(editable?" editable-block-card":""));
    if(editable){card.dataset.stageId=String(stageId);card.dataset.blockId=String(block.id||"");card.dataset.blockIndex=String(blockIndex)}
    const titleText=String(block.title||"").trim();
    if(editable){
      card.setAttribute("role","button");
      card.tabIndex=0;
      card.setAttribute("aria-label",(titleText||"제목 없는 블록")+" 편집");
      const openEditor=()=>openMobileBlockEditor(stageId,blockIndex);
      card.onclick=openEditor;
      card.onkeydown=event=>{
        if(event.key!=="Enter"&&event.key!==" ")return;
        event.preventDefault();
        openEditor()
      }
    }
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
      const preview=compactBlockPreview(block);
      if(preview)card.append(element("p","block-text block-preview",preview))
    }else if(block.summaryHtml||block.summary){
      const body=element("div","block-text block-rich-preview");
      body.innerHTML=mobileBlockRichHtml(block.summary,block.summaryHtml);
      card.append(body)
    }
    if(block.type!=="script"&&(block.notesHtml||block.notes)){
      const notes=element("div","block-notes block-rich-preview");
      notes.innerHTML=mobileBlockRichHtml(block.notes,block.notesHtml);
      card.append(notes)
    }
    if((block.children||[]).length){
      const children=element("div","child-blocks");
      for(const child of block.children)children.append(blockElement(child));
      card.append(children)
    }
    return card
  }
  const MOBILE_TRASH_LABELS=Object.freeze({project:"작품",mindmap:"마인드맵",note:"노트",folder:"폴더",episode:"화",stage:"파트",block:"블록",character:"캐릭터",memo:"메모",quickMemo:"퀵메모",resource:"이미지"});
  function mobileTrashLabel(type){return MOBILE_TRASH_LABELS[String(type||"")]||"항목"}
  function pushMobileTrash(state,type,label,payload,meta={}){
    state.trash=Array.isArray(state.trash)?state.trash:[];
    const item={id:uid(),type:String(type||""),label:String(label||mobileTrashLabel(type)),payload:clone(payload),meta:clone(meta&&typeof meta==="object"?meta:{}),deletedAt:new Date().toISOString()};
    state.trash.unshift(item);
    return item
  }
  function mobileTrashDate(value){
    const date=new Date(String(value||""));
    if(Number.isNaN(date.getTime()))return "";
    return new Intl.DateTimeFormat("ko-KR",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(date)
  }
  function mobileTrashUnit(state,meta={}){
    const project=(state.projects||[]).find(item=>String(item?.id||"")===String(meta.projectId||""));
    if(!project)return null;
    if(project.kind==="long")return (project.episodes||[]).find(item=>String(item?.id||"")===String(meta.episodeId||""))||null;
    return project
  }
  function mobileTrashFindBlock(unit,stageId,path=[]){
    let list=unit?.stages?.[stageId]||[],node=null;
    for(const id of path||[]){node=list.find(item=>String(item?.id||"")===String(id||""));if(!node)return null;list=Array.isArray(node.children)?node.children:[]}
    return node
  }
  async function restoreMobileTrashItem(id){
    const state=snapshot(),trash=Array.isArray(state.trash)?state.trash:[],trashIndex=trash.findIndex(item=>String(item?.id||"")===String(id||""));
    if(trashIndex<0)return false;
    const item=trash[trashIndex],meta=item?.meta&&typeof item.meta==="object"?item.meta:{},payload=clone(item?.payload),type=String(item?.type||"");
    const insert=(list,value,at=list.length)=>list.splice(Math.max(0,Math.min(Number(at)||0,list.length)),0,value);
    let restored=false;
    try{
      if(type==="project"&&payload&&typeof payload==="object"){state.projects=Array.isArray(state.projects)?state.projects:[];insert(state.projects,payload,meta.index??state.projects.length);restored=true}
      else if(type==="note"&&payload&&typeof payload==="object"){state.notes=Array.isArray(state.notes)?state.notes:[];insert(state.notes,payload,meta.index??state.notes.length);restored=true}
      else if(type==="mindmap"&&payload&&typeof payload==="object"){state.mindmaps=Array.isArray(state.mindmaps)?state.mindmaps:[];insert(state.mindmaps,payload,meta.index??state.mindmaps.length);restored=true}
      else if(type==="folder"&&payload&&typeof payload==="object"){
        state.folders=Array.isArray(state.folders)?state.folders:[];state.projects=Array.isArray(state.projects)?state.projects:[];state.notes=Array.isArray(state.notes)?state.notes:[];state.mindmaps=Array.isArray(state.mindmaps)?state.mindmaps:[];
        const rows=(value,target)=>[...(value||[])].sort((a,b)=>(Number(a?.index)||0)-(Number(b?.index)||0)).forEach(row=>{if(row?.data)insert(target,clone(row.data),row.index)});
        rows(payload.folders,state.folders);rows(payload.projects,state.projects);rows(payload.notes,state.notes);rows(payload.mindmaps,state.mindmaps);restored=true
      }else if(type==="episode"&&payload&&typeof payload==="object"){
        const project=(state.projects||[]).find(row=>String(row?.id||"")===String(meta.projectId||""));
        if(project?.kind==="long"){project.episodes=Array.isArray(project.episodes)?project.episodes:[];insert(project.episodes,payload,meta.index??project.episodes.length);restored=true}
      }else if(type==="stage"){
        const unit=mobileTrashUnit(state,meta),base=payload&&typeof payload==="object"?payload:{},raw=base.stageDef&&typeof base.stageDef==="object"?clone(base.stageDef):null;
        if(unit&&raw){unit.stageDefs=Array.isArray(unit.stageDefs)?unit.stageDefs:[];unit.stages=unit.stages&&typeof unit.stages==="object"?unit.stages:{};let stageId=String(raw.id||uid());if(unit.stageDefs.some(stage=>String(stage?.id||"")===stageId))stageId=uid();raw.id=stageId;insert(unit.stageDefs,raw,meta.index??unit.stageDefs.length);unit.stages[stageId]=Array.isArray(base.blocks)?clone(base.blocks):[];restored=true}
      }else if(type==="block"&&payload&&typeof payload==="object"){
        const unit=mobileTrashUnit(state,meta);
        if(unit?.stages?.[meta.stageId]){let target=unit.stages[meta.stageId];if(Array.isArray(meta.parentPath)&&meta.parentPath.length){const parent=mobileTrashFindBlock(unit,meta.stageId,meta.parentPath);if(parent){parent.children=Array.isArray(parent.children)?parent.children:[];target=parent.children}else target=null}if(target){insert(target,payload,meta.index??target.length);restored=true}}
      }else if(type==="character"&&payload&&typeof payload==="object"){
        let owner=null;if(meta.ownerType==="repository"){state.characterRepository=Array.isArray(state.characterRepository)?state.characterRepository:[];owner={characters:state.characterRepository}}else if(meta.ownerType==="note")owner=(state.notes||[]).find(row=>String(row?.id||"")===String(meta.ownerId||""));else owner=(state.projects||[]).find(row=>String(row?.id||"")===String(meta.ownerId||""));
        if(owner){owner.characters=Array.isArray(owner.characters)?owner.characters:[];insert(owner.characters,payload,meta.index??owner.characters.length);restored=true}
      }else if(type==="memo"&&payload&&typeof payload==="object"){
        const owner=meta.ownerType==="note"?(state.notes||[]).find(row=>String(row?.id||"")===String(meta.ownerId||"")):(state.projects||[]).find(row=>String(row?.id||"")===String(meta.ownerId||""));
        if(owner){owner.memos=Array.isArray(owner.memos)?owner.memos:[];insert(owner.memos,payload,meta.index??owner.memos.length);restored=true}
      }else if(type==="quickMemo"&&payload&&typeof payload==="object"){state.quickMemos=Array.isArray(state.quickMemos)?state.quickMemos:[];insert(state.quickMemos,payload,meta.index??state.quickMemos.length);restored=true}
      else if(type==="resource"&&payload&&typeof payload==="object"){
        const owner=meta.ownerType==="note"?(state.notes||[]).find(row=>String(row?.id||"")===String(meta.ownerId||"")):(state.projects||[]).find(row=>String(row?.id||"")===String(meta.ownerId||""));
        if(owner){owner.resources=Array.isArray(owner.resources)?owner.resources:[];insert(owner.resources,payload,meta.index??owner.resources.length);restored=true}
      }
      if(!restored)return false;
      trash.splice(trashIndex,1);state.trash=trash;await repository.replaceState(state);return true
    }catch(error){console.error("모바일 휴지통 복구 실패",error);logDiagnostic("error","REPOSITORY","휴지통 항목 복구에 실패했습니다.",error);return false}
  }

  function openMobileConfirm({title="삭제하시겠습니까?",message="",confirmLabel="삭제",cancelLabel="취소",destructive=false}={}){
    document.querySelector("[data-mobile-confirm]")?.remove();
    return new Promise(resolve=>{
      const wrap=element("div","nav-sheet-backdrop mobile-confirm-backdrop"),panel=element("section","nav-sheet mobile-confirm-panel");
      wrap.dataset.mobileConfirm="1";
      panel.setAttribute("role","alertdialog");
      panel.setAttribute("aria-modal","true");
      panel.setAttribute("aria-label",title);
      const copy=element("div","mobile-confirm-copy");
      copy.append(element("h3","",title));
      if(message)copy.append(element("p","",message));
      const actions=element("div","mobile-confirm-actions");
      if(Array.from(confirmLabel).length>8)actions.classList.add("wide-submit");
      else if(Array.from(cancelLabel).length>8)actions.classList.add("wide-cancel");
      const cancel=element("button","mobile-confirm-cancel",cancelLabel),confirm=element("button","mobile-confirm-submit"+(destructive?" destructive":""),confirmLabel);
      cancel.type="button";
      confirm.type="button";
      actions.append(cancel,confirm);
      panel.append(copy,actions);
      wrap.append(panel);
      document.body.append(wrap);
      let settled=false;
      const finish=value=>{
        if(settled)return;
        settled=true;
        wrap.remove();
        resolve(value)
      };
      cancel.onclick=()=>finish(false);
      confirm.onclick=()=>finish(true);
      wrap.onclick=event=>{if(event.target===wrap)finish(false)};
      requestAnimationFrame(()=>cancel.focus())
    })
  }

  function mobileProjectContext(projectId=activeDocumentId,episodeId=activeEpisodeId){
    const state=snapshot(),project=(state.projects||[]).find(item=>String(item?.id||"")===String(projectId||""));
    if(!project)return {state,project:null,unit:null};
    if(project.kind==="long"){
      const unit=(project.episodes||[]).find(item=>String(item?.id||"")===String(episodeId||""))||null;
      return {state,project,unit}
    }
    return {state,project,unit:project}
  }

  function closeMobileProjectStageEditor(){
    document.querySelector("[data-project-stage-editor]")?.remove()
  }

  function openMobileProjectStageEditor(stageId=""){
    const projectId=String(activeDocumentId||""),episodeId=String(activeEpisodeId||"");
    const {project,unit}=mobileProjectContext(projectId,episodeId);
    if(!project||!unit)return;
    closeMobileProjectStageEditor();
    const existing=stageId?(unit.stageDefs||[]).find(stage=>String(stage?.id||"")===String(stageId)):null;
    let selectedColor=safeColor(existing?.color||randomCardColor(),randomCardColor()),colorsOpen=false;
    let colorCustom=!CARD_COLORS.some(color=>color.toLowerCase()===selectedColor.toLowerCase());
    const wrap=element("div","nav-sheet-backdrop project-stage-backdrop"),panel=element("section","nav-sheet project-stage-panel");
    wrap.dataset.projectStageEditor=existing?"edit":"create";
    panel.setAttribute("role","dialog");
    panel.setAttribute("aria-modal","true");
    panel.setAttribute("aria-label",existing?"파트 편집":"새 파트 추가");
    panel.innerHTML='<div class="project-stage-editor-head"><div class="create-form-kind"><span class="create-form-kind-icon"><i data-lucide="layout-list" aria-hidden="true"></i></span><strong>'+(existing?"파트 편집":"새 파트 추가")+'</strong></div><button type="button" class="sheet-close" data-project-stage-close aria-label="닫기"><i data-lucide="x" aria-hidden="true"></i></button></div>'+
      '<div class="project-stage-editor-body">'+
      '<label class="create-field"><span>제목</span><input type="text" data-project-stage-title maxlength="120" placeholder="예: 만남, 동행, 균열, 이별"></label>'+
      '<label class="create-field"><span>부제 <small>· 선택</small></span><input type="text" data-project-stage-subtitle maxlength="240" placeholder="파트 부제"></label>'+
      '<fieldset class="create-color-field project-stage-color-field">'+
      '<legend>색상</legend>'+
      '<button class="create-color-toggle" type="button" data-project-stage-color-toggle aria-expanded="false">'+
      '<span class="create-color-preview" data-project-stage-color-preview aria-hidden="true"></span>'+
      '<span class="create-color-toggle-label">색상 선택</span>'+
      '<i data-lucide="chevron-down" aria-hidden="true"></i></button>'+
      '<div class="create-color-options" data-project-stage-color-options hidden>'+
      '<div class="create-color-grid" data-project-stage-color-grid aria-label="파트 색상"></div>'+
      '<div class="create-color-editor" data-project-stage-color-editor hidden>'+
      '<input type="color" data-project-stage-color-picker aria-label="직접 색상 선택">'+
      '<input type="text" data-project-stage-color-hex maxlength="7" spellcheck="false" autocomplete="off" aria-label="HEX 색상">'+
      '</div></div></fieldset>'+
      '<p class="project-stage-editor-status" data-project-stage-status hidden></p>'+
      '<div class="project-stage-editor-footer">'+
      (existing?'<button type="button" class="project-stage-delete" data-project-stage-delete><i data-lucide="trash-2" aria-hidden="true"></i><span>삭제</span></button>':'<span></span>')+
      '<div class="note-sheet-actions"><button type="button" class="secondary" data-project-stage-close>취소</button><button type="button" class="primary" data-project-stage-save>'+(existing?"저장":"추가")+'</button></div>'+
      '</div></div>';
    wrap.append(panel);
    document.body.append(wrap);

    const title=panel.querySelector("[data-project-stage-title]"),subtitle=panel.querySelector("[data-project-stage-subtitle]");
    const colorToggle=panel.querySelector("[data-project-stage-color-toggle]"),colorPreview=panel.querySelector("[data-project-stage-color-preview]");
    const colorOptions=panel.querySelector("[data-project-stage-color-options]"),colorGrid=panel.querySelector("[data-project-stage-color-grid]");
    const colorEditor=panel.querySelector("[data-project-stage-color-editor]"),colorPicker=panel.querySelector("[data-project-stage-color-picker]");
    const colorHex=panel.querySelector("[data-project-stage-color-hex]"),status=panel.querySelector("[data-project-stage-status]"),save=panel.querySelector("[data-project-stage-save]");
    title.value=existing?.name||"";
    subtitle.value=existing?.hint||"";

    const setStatus=(message="")=>{
      status.textContent=String(message||"");
      status.hidden=!message
    };
    const syncColor=()=>{
      selectedColor=safeColor(selectedColor,CARD_COLORS[0]);
      colorPreview.style.setProperty("--swatch",selectedColor);
      colorToggle.setAttribute("aria-expanded",String(colorsOpen));
      colorOptions.hidden=!colorsOpen;
      colorEditor.hidden=!colorCustom;
      colorPicker.value=selectedColor;
      colorHex.value=selectedColor.toUpperCase();
      colorGrid.querySelectorAll("[data-stage-color]").forEach(button=>{
        const active=!colorCustom&&String(button.dataset.stageColor||"").toLowerCase()===selectedColor.toLowerCase();
        button.classList.toggle("active",active);
        button.setAttribute("aria-pressed",String(active))
      });
      const custom=colorGrid.querySelector("[data-stage-color-custom]");
      if(custom){
        custom.classList.toggle("active",colorCustom);
        custom.setAttribute("aria-pressed",String(colorCustom))
      }
    };
    for(const color of CARD_COLORS){
      const button=document.createElement("button");
      button.type="button";
      button.className="create-color-swatch";
      button.dataset.stageColor=color;
      button.style.setProperty("--swatch",color);
      button.setAttribute("aria-label","색상 "+color.toUpperCase());
      button.onclick=()=>{
        selectedColor=color;
        colorCustom=false;
        colorsOpen=false;
        syncColor()
      };
      colorGrid.append(button)
    }
    const customColor=document.createElement("button");
    customColor.type="button";
    customColor.className="create-color-swatch custom";
    customColor.dataset.stageColorCustom="true";
    customColor.setAttribute("aria-label","직접 색상");
    customColor.innerHTML='<i data-lucide="palette" aria-hidden="true"></i>';
    customColor.onclick=()=>{
      colorCustom=true;
      colorsOpen=true;
      syncColor();
      requestAnimationFrame(()=>colorHex.focus())
    };
    colorGrid.append(customColor);
    colorToggle.onclick=()=>{
      colorsOpen=!colorsOpen;
      syncColor()
    };
    colorPicker.oninput=()=>{
      colorCustom=true;
      colorsOpen=true;
      selectedColor=safeColor(colorPicker.value,selectedColor||CARD_COLORS[0]);
      syncColor()
    };
    colorHex.oninput=()=>{
      const value=safeColor(colorHex.value,"");
      if(!value)return;
      colorCustom=true;
      colorsOpen=true;
      selectedColor=value;
      colorPicker.value=value;
      colorPreview.style.setProperty("--swatch",value)
    };
    colorHex.onblur=()=>{
      selectedColor=safeColor(colorHex.value,selectedColor||CARD_COLORS[0]);
      colorCustom=true;
      syncColor()
    };
    panel.querySelectorAll("[data-project-stage-close]").forEach(button=>button.onclick=closeMobileProjectStageEditor);
    wrap.onclick=event=>{if(event.target===wrap)closeMobileProjectStageEditor()};
    const deleteButton=panel.querySelector("[data-project-stage-delete]");
    if(deleteButton)deleteButton.onclick=async()=>{
      const current=mobileProjectContext(projectId,episodeId);
      if(!current.project||!current.unit){
        setStatus("편집할 작품 또는 화를 찾지 못했습니다.");
        return
      }
      const defs=Array.isArray(current.unit.stageDefs)?current.unit.stageDefs:[];
      if(defs.length<=1){
        setStatus("파트는 최소 1개가 필요합니다.");
        return
      }
      const index=defs.findIndex(stage=>String(stage?.id||"")===String(stageId));
      if(index<0){
        setStatus("삭제할 파트를 찾지 못했습니다.");
        return
      }
      const blocks=Array.isArray(current.unit.stages?.[stageId])?current.unit.stages[stageId]:[],blockCount=blocks.length,target=defs[index];
      const confirmed=await openMobileConfirm({
        title:"삭제하시겠습니까?",
        message:blockCount?"이 파트와 안의 블록 "+blockCount+"개가 휴지통으로 이동합니다.":"이 파트를 휴지통으로 이동합니다.",
        confirmLabel:"삭제",
        cancelLabel:"취소",
        destructive:true
      });
      if(!confirmed)return;
      deleteButton.disabled=true;
      setStatus("");
      try{
        pushMobileTrash(current.state,"stage",target?.name||"제목 없는 파트",{stageDef:target,blocks},{projectId:current.project.id,episodeId:current.project.kind==="long"?current.unit.id:null,index});
        defs.splice(index,1);
        if(current.unit.stages&&typeof current.unit.stages==="object")delete current.unit.stages[stageId];
        current.project.updatedAt=new Date().toISOString();
        await repository.replaceState(current.state);
        closeMobileProjectStageEditor();
        if(activeDocumentType==="project"&&String(activeDocumentId)===projectId&&String(activeEpisodeId||"")===episodeId)renderProject(current.project)
      }catch(error){
        console.error("모바일 작품 파트 삭제 실패",error);
        logDiagnostic("error","REPOSITORY","작품 파트 삭제에 실패했습니다.",error);
        deleteButton.disabled=false;
        setStatus("삭제하지 못했습니다. 다시 시도해 주세요.")
      }
    };
    save.onclick=async()=>{
      const nextTitle=title.value.trim()||"새 파트",nextSubtitle=subtitle.value.trim();
      const current=mobileProjectContext(projectId,episodeId);
      if(!current.project||!current.unit){
        setStatus("편집할 작품 또는 화를 찾지 못했습니다.");
        return
      }
      const defs=Array.isArray(current.unit.stageDefs)?current.unit.stageDefs:(current.unit.stageDefs=[]);
      current.unit.stages=current.unit.stages&&typeof current.unit.stages==="object"?current.unit.stages:{};
      if(existing){
        const target=defs.find(stage=>String(stage?.id||"")===String(stageId));
        if(!target){setStatus("편집할 파트를 찾지 못했습니다.");return}
        target.name=nextTitle;
        target.hint=nextSubtitle;
        target.color=selectedColor
      }else{
        const id=uid();
        defs.push({id,name:nextTitle,hint:nextSubtitle,color:selectedColor});
        current.unit.stages[id]=[]
      }
      current.project.updatedAt=new Date().toISOString();
      save.disabled=true;
      setStatus("");
      try{
        await repository.replaceState(current.state);
        closeMobileProjectStageEditor();
        if(activeDocumentType==="project"&&String(activeDocumentId)===projectId&&String(activeEpisodeId||"")===episodeId)renderProject(current.project)
      }catch(error){
        console.error("모바일 작품 파트 저장 실패",error);
        logDiagnostic("error","REPOSITORY","작품 파트 저장에 실패했습니다.",error);
        save.disabled=false;
        setStatus("저장하지 못했습니다. 다시 시도해 주세요.")
      }
    };
    syncColor();
    refreshLucideIcons();
    if(existing)releaseMobileInputFocus();else requestAnimationFrame(()=>{title.focus();title.select()})
  }

  function sanitizedBlockHtml(value,{paste=false}={}){
    const template=document.createElement("template");
    template.innerHTML=String(value||"");
    template.content.querySelectorAll("[data-field-link-token]").forEach(el=>el.replaceWith(document.createTextNode("[["+(el.dataset.fieldLinkToken||"")+"]]")));
    const allowed=new Set(["B","STRONG","I","EM","U","S","STRIKE","A","SPAN","P","DIV","BR","H1","H2","H3","UL","OL","LI","BLOCKQUOTE","PRE","CODE","SUB","SUP","HR"]);
    const styles=new Set(paste?["text-align"]:["color","background-color","text-align"]);
    const aligned=new Set(["P","DIV","H1","H2","H3","LI","BLOCKQUOTE"]);
    const walk=node=>{
      [...node.children].forEach(raw=>{
        let el=raw;
        if(el.tagName==="FONT"&&!paste){
          const replacement=document.createElement("span"),legacyColor=String(el.getAttribute("color")||"").trim();
          if(legacyColor)replacement.style.color=legacyColor;
          while(el.firstChild)replacement.appendChild(el.firstChild);
          el.replaceWith(replacement);
          el=replacement
        }
        if(!allowed.has(el.tagName)){
          const parent=el.parentNode;
          while(el.firstChild)parent.insertBefore(el.firstChild,el);
          el.remove();
          walk(parent);
          return
        }
        if(paste){
          if(aligned.has(el.tagName)){
            const align=String(el.getAttribute("align")||"").toLowerCase();
            if(["left","center","right","justify"].includes(align))el.style.textAlign=align
          }
          const weight=String(el.style.fontWeight||"").toLowerCase(),fontStyle=String(el.style.fontStyle||"").toLowerCase(),decoration=(String(el.style.textDecoration||"")+" "+String(el.style.textDecorationLine||"")).toLowerCase();
          const wrap=tag=>{const wrapper=document.createElement(tag);while(el.firstChild)wrapper.appendChild(el.firstChild);el.appendChild(wrapper)};
          if(el.tagName!=="B"&&el.tagName!=="STRONG"&&(weight==="bold"||Number.parseInt(weight,10)>=600))wrap("strong");
          if(el.tagName!=="I"&&el.tagName!=="EM"&&(fontStyle==="italic"||fontStyle==="oblique"))wrap("em");
          if(el.tagName!=="U"&&decoration.includes("underline"))wrap("u");
          if(el.tagName!=="S"&&el.tagName!=="STRIKE"&&decoration.includes("line-through"))wrap("s")
        }
        for(const attribute of [...el.attributes]){
          const name=attribute.name.toLowerCase(),rawValue=String(attribute.value||"").trim();
          if(name==="href"&&el.tagName==="A"){
            if(!/^(https?:|mailto:|#)/i.test(rawValue))el.removeAttribute(attribute.name)
          }else if(name==="data-divider"&&el.tagName==="HR"&&["solid","dotted","dashed","double"].includes(rawValue)){
          }else if(name==="start"&&el.tagName==="OL"&&/^\d+$/.test(rawValue)){
          }else if(name==="style"){
            if(el.style.fontFamily)el.style.fontFamily=normalizeMobileNoteFont(el.style.fontFamily);
            const kept=[...el.style].filter(key=>styles.has(key)).map(key=>key+":"+el.style.getPropertyValue(key)).join(";");
            if(kept)el.setAttribute("style",kept);else el.removeAttribute("style")
          }else el.removeAttribute(attribute.name)
        }
        if(el.tagName==="A"){el.setAttribute("target","_blank");el.setAttribute("rel","noopener noreferrer")}
        walk(el)
      })
    };
    walk(template.content);
    return template.innerHTML
  }

  function mobileBlockPlainText(root){
    if(!root)return "";
    const inline=node=>{
      if(node.nodeType===Node.TEXT_NODE)return node.data||"";
      if(node.nodeType!==Node.ELEMENT_NODE)return "";
      const el=node;
      if(el.matches?.("[data-field-link-token]"))return "[["+(el.dataset.fieldLinkToken||"")+"]]";
      const inner=[...el.childNodes].map(inline).join("");
      if(el.tagName==="BR")return "\n";
      return inner
    };
    const block=node=>{
      if(node.nodeType===Node.TEXT_NODE)return node.data||"";
      if(node.nodeType!==Node.ELEMENT_NODE)return "";
      const el=node;
      if(el.matches?.("[data-field-link-token]"))return "[["+(el.dataset.fieldLinkToken||"")+"]]";
      if(["H1","H2","H3"].includes(el.tagName))return [...el.childNodes].map(inline).join("")+"\n";
      if(el.tagName==="UL"||el.tagName==="OL"){
        const start=el.tagName==="OL"?Number(el.getAttribute("start")||1):1;
        return [...el.children].filter(child=>child.tagName==="LI").map((li,index)=>(el.tagName==="OL"?(start+index)+".":"-")+" "+[...li.childNodes].map(inline).join("").replace(/\n+$/g,"")).join("\n")+"\n"
      }
      if(["P","DIV","BLOCKQUOTE"].includes(el.tagName)){
        const inner=[...el.childNodes].map(child=>child.nodeType===Node.ELEMENT_NODE&&["UL","OL","H1","H2","H3"].includes(child.tagName)?block(child):inline(child)).join("");
        return inner+"\n"
      }
      if(el.tagName==="BR")return "\n";
      return [...el.childNodes].map(inline).join("")
    };
    const parts=[];
    [...root.childNodes].forEach((node,index)=>{
      const value=block(node),isBlock=node.nodeType===Node.ELEMENT_NODE&&["DIV","P","H1","H2","H3","BLOCKQUOTE","UL","OL"].includes(node.tagName);
      if(index>0&&isBlock&&parts.length&&!String(parts[parts.length-1]).endsWith("\n"))parts.push("\n");
      parts.push(value)
    });
    return parts.join("").replace(/\n{3,}/g,"\n\n").replace(/\n$/g,"")
  }

  function mobileBlockRichHtml(plain,html){
    const rich=sanitizedBlockHtml(html);
    if(rich.trim())return rich;
    const holder=document.createElement("div");
    holder.textContent=String(plain||"");
    return sanitizedBlockHtml(holder.innerHTML.replace(/\n/g,"<br>"))
  }

  function mobileBlockEditorData(editor){
    const html=sanitizedBlockHtml(editor?.innerHTML||""),holder=document.createElement("div");
    holder.innerHTML=html;
    return {plain:mobileBlockPlainText(holder),html}
  }

  function hideMobileBlockFormatBar(){
    blockEditorFormatBar.hidden=true;
    blockFormatRange=null;
    blockFormatEditor=null;
    if(blockFormatFrame){cancelAnimationFrame(blockFormatFrame);blockFormatFrame=0}
  }

  function updateMobileBlockFormatState(){
    if(!blockFormatEditor||!blockFormatRange)return;
    blockEditorFormatBar.querySelectorAll("[data-block-format-command]").forEach(button=>{
      let active=false;
      try{active=!!document.queryCommandState(button.dataset.blockFormatCommand)}catch{}
      button.classList.toggle("active",active)
    });
    let node=blockFormatRange.commonAncestorContainer;
    node=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;
    const tag=node?.closest?.("h1,h2,h3,p")?.tagName?.toLowerCase?.()||"p";
    blockEditorFormatBlock.value=["h1","h2","h3"].includes(tag)?tag:"p"
  }

  function positionMobileBlockFormatBar(range){
    const rect=range?.getBoundingClientRect?.();
    if(!rect)return;
    blockEditorFormatBar.hidden=false;
    blockEditorFormatBar.style.left="8px";
    blockEditorFormatBar.style.top="8px";
    if(blockFormatFrame)cancelAnimationFrame(blockFormatFrame);
    blockFormatFrame=requestAnimationFrame(()=>{
      blockFormatFrame=0;
      if(blockEditorFormatBar.hidden)return;
      const bar=blockEditorFormatBar.getBoundingClientRect(),viewport=window.visualViewport,pad=8,gap=12;
      const viewportLeft=viewport?.offsetLeft||0,viewportTop=viewport?.offsetTop||0;
      const width=viewport?.width||document.documentElement.clientWidth||window.innerWidth;
      const height=viewport?.height||document.documentElement.clientHeight||window.innerHeight;
      const left=Math.max(viewportLeft+pad,Math.min(rect.left+rect.width/2-bar.width/2,viewportLeft+width-bar.width-pad));
      const top=Math.max(viewportTop+pad,Math.min(rect.bottom+gap,viewportTop+height-bar.height-pad));
      blockEditorFormatBar.style.left=Math.round(left)+"px";
      blockEditorFormatBar.style.top=Math.round(top)+"px"
    })
  }

  function syncMobileBlockFormatBar(){
    if(blockEditorScreen.hidden){hideMobileBlockFormatBar();return}
    const selection=window.getSelection();
    if(!selection?.rangeCount||selection.isCollapsed){
      if(blockEditorFormatBar.contains(document.activeElement)&&blockFormatRange&&blockFormatEditor)return;
      hideMobileBlockFormatBar();
      return
    }
    const range=selection.getRangeAt(0),editor=[blockEditorSummary,blockEditorNotes].find(item=>item.contains(range.commonAncestorContainer));
    if(!editor){hideMobileBlockFormatBar();return}
    blockFormatEditor=editor;
    blockFormatRange=range.cloneRange();
    updateMobileBlockFormatState();
    positionMobileBlockFormatBar(range)
  }

  function restoreMobileBlockFormatSelection(){
    if(!blockFormatEditor||!blockFormatRange||!blockFormatEditor.contains(blockFormatRange.commonAncestorContainer))return false;
    const selection=window.getSelection();
    try{
      blockFormatEditor.focus({preventScroll:true});
      selection.removeAllRanges();
      selection.addRange(blockFormatRange.cloneRange());
      return true
    }catch{return false}
  }

  function execMobileBlockFormat(command,value=null){
    if(!restoreMobileBlockFormatSelection())return false;
    let ok=false;
    try{
      if(command==="foreColor")document.execCommand("styleWithCSS",false,true);
      ok=document.execCommand(command,false,value)
    }catch(error){
      console.error("모바일 일반 블록 서식 적용 실패",error);
      logDiagnostic("warn","PROJECT","일반 블록 서식을 적용하지 못했습니다.",error)
    }finally{
      if(command==="foreColor")try{document.execCommand("styleWithCSS",false,false)}catch{}
    }
    const selection=window.getSelection();
    if(selection?.rangeCount&&blockFormatEditor.contains(selection.getRangeAt(0).commonAncestorContainer))blockFormatRange=selection.getRangeAt(0).cloneRange();
    scheduleMobileGeneralBlockSave();
    requestAnimationFrame(syncMobileBlockFormatBar);
    return ok
  }

  function bindMobileBlockRichEditor(editor){
    editor.addEventListener("input",scheduleMobileGeneralBlockSave);
    editor.addEventListener("paste",event=>{
      const html=event.clipboardData?.getData("text/html")||"",plain=event.clipboardData?.getData("text/plain")||"";
      if(!html&&!plain)return;
      event.preventDefault();
      try{
        if(html)document.execCommand("insertHTML",false,sanitizedBlockHtml(html,{paste:true}));
        else document.execCommand("insertText",false,plain)
      }catch(error){
        console.error("모바일 일반 블록 붙여넣기 실패",error);
        logDiagnostic("warn","PROJECT","일반 블록 붙여넣기를 처리하지 못했습니다.",error)
      }
      scheduleMobileGeneralBlockSave()
    });
    editor.addEventListener("blur",()=>setTimeout(syncMobileBlockFormatBar,0))
  }

  function setMobileBlockEditorStatus(message=""){
    blockEditorStatus.textContent=String(message||"");
    blockEditorStatus.hidden=!message
  }

  function syncMobileBlockCompletion(){
    const completed=Boolean(activeBlockEditor?.completed);
    blockEditorCompletion.innerHTML='<i data-lucide="'+(completed?"circle-check":"circle")+'" aria-hidden="true"></i><span>'+(completed?"완료":"미완료")+'</span>';
    blockEditorCompletion.setAttribute("aria-pressed",String(completed));
    refreshLucideIcons()
  }

  function mobileScriptLine(type="narration",text=""){
    const divider=type==="page"||type==="cut";
    return {id:uid(),type,text,speaker:"",characterId:"",background:"",shot:"",...(divider?{autoLabel:true}:{})}
  }

  function renumberMobileScriptLines(){
    const counts={page:0,cut:0};
    for(const line of activeBlockEditor?.scriptBlocks||[]){
      if(line.type!=="page"&&line.type!=="cut")continue;
      counts[line.type]++;
      if(line.autoLabel===undefined&&new RegExp("^\\s*"+line.type.toUpperCase()+"\\s+\\d+\\s*$","i").test(String(line.text||"")))line.autoLabel=true;
      if(line.autoLabel===true)line.text=line.type.toUpperCase()+" "+String(counts[line.type]).padStart(2,"0")
    }
  }

  function mobileScriptCharacters(){
    return activeBlockEditor?.characters||[]
  }

  function matchMobileScriptCharacter(name,characters=mobileScriptCharacters()){
    const query=String(name||"").trim().toLocaleLowerCase("ko-KR");
    return query?characters.find(character=>
      [character.name,...(Array.isArray(character.aliases)?character.aliases:[])].some(value=>String(value||"").toLocaleLowerCase("ko-KR")===query)
    ):null
  }

  function mobileScriptPreviewHtml(value){
    const escape=value=>{const node=document.createElement("span");node.textContent=value;return node.innerHTML};
    return String(value||"").split("\n").map(raw=>{
      let line=escape(raw),tag="div";
      if(/^###\s+/.test(line)){tag="h3";line=line.replace(/^###\s+/,"")}
      else if(/^##\s+/.test(line)){tag="h2";line=line.replace(/^##\s+/,"")}
      else if(/^#\s+/.test(line)){tag="h1";line=line.replace(/^#\s+/,"")}
      else if(/^>\s?/.test(line)){tag="blockquote";line=line.replace(/^>\s?/,"")}
      else if(/^[-*]\s+/.test(line))line="• "+line.replace(/^[-*]\s+/,"");
      line=line.replace(/`([^`]+)`/g,"<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>")
        .replace(/__([^_]+)__/g,"<strong>$1</strong>")
        .replace(/~~([^~]+)~~/g,"<s>$1</s>")
        .replace(/\*([^*]+)\*/g,"<em>$1</em>");
      return "<"+tag+">"+(line||"<br>")+"</"+tag+">"
    }).join("")
  }

  function resizeMobileScriptText(field){
    field.style.height="auto";
    field.style.height=Math.max(34,field.scrollHeight)+"px"
  }

  function selectMobileScriptRow(id){
    if(activeBlockEditor?.type!=="script")return;
    activeBlockEditor.activeLineId=String(id||"");
    blockEditorScriptRows.querySelectorAll(".project-script-row").forEach(row=>{
      const selected=row.dataset.lineId===activeBlockEditor.activeLineId;
      row.classList.toggle("active",selected);
      if(!selected){
        row.classList.remove("editing");
        const menu=row.querySelector(".project-script-row-menu");
        if(menu)menu.hidden=true;
        row.querySelectorAll(".project-script-picker-menu").forEach(pickerMenu=>{pickerMenu.hidden=true});
        row.querySelectorAll('[aria-expanded="true"]').forEach(button=>button.setAttribute("aria-expanded","false"))
      }
    })
  }

  function mobileScriptPicker(kind,label,options){
    const picker=element("div","project-script-picker");
    picker.dataset.scriptPicker=kind;
    if(kind==="type")picker.classList.add("project-script-type-picker");
    const toggle=element("button","project-script-picker-toggle");
    toggle.type="button";toggle.dataset.scriptAction="picker";
    toggle.setAttribute("aria-label",kind==="type"?"줄 유형 변경":kind==="character"?"작품 캐릭터 선택":"연출 프리셋 선택");
    toggle.setAttribute("aria-expanded","false");
    toggle.append(element("span","project-script-picker-label",label));
    const menu=element("div","project-script-picker-menu");
    menu.hidden=true;
    options.forEach(([value,name])=>{
      const choice=element("button","",name);
      choice.type="button";choice.dataset.scriptChoice=kind;choice.dataset.scriptValue=String(value);
      menu.append(choice)
    });
    picker.append(toggle,menu);
    return picker
  }

  function renderMobileScriptRows(focusId=""){
    const edit=activeBlockEditor;
    if(edit?.type!=="script")return;
    const preview=Boolean(edit.preview),characters=mobileScriptCharacters();
    if(focusId)edit.activeLineId=String(focusId);
    if(!edit.scriptBlocks.some(line=>String(line.id)===edit.activeLineId))edit.activeLineId="";
    blockEditorScriptRows.replaceChildren();
    blockEditorScriptSection.classList.toggle("preview",preview);
    blockEditorScriptPreview.textContent=preview?"편집으로 돌아가기":"미리보기";
    blockEditorScriptPreview.setAttribute("aria-pressed",String(preview));
    edit.scriptBlocks.forEach((line,index)=>{
      const divider=line.type==="page"||line.type==="cut";
      const marker=line.type==="background"?"#":line.type==="direction"?"-":"";
      const row=element("div","project-script-row"+(divider?" project-script-divider":"")+(preview?" project-script-preview-row":"")+(marker?" project-script-marked":""));
      row.dataset.lineId=String(line.id);
      row.dataset.lineType=String(line.type||"narration");
      const character=line.type==="dialogue"?characters.find(item=>String(item.id)===String(line.characterId||""))||matchMobileScriptCharacter(line.speaker,characters):null;
      if(character?.color)row.style.setProperty("--dialogue-color",safeColor(character.color,"#6A6E78"));
      if(divider){
        const marker=element(preview?"span":"button","project-script-divider-label",String(line.text||line.type.toUpperCase()));
        if(!preview){
          marker.type="button";
          marker.dataset.scriptAction="divider";
          marker.setAttribute("aria-label",MOBILE_SCRIPT_TYPES[line.type]+" 이름 수정")
        }
        row.append(element("span","project-script-divider-rule"),marker,element("span","project-script-divider-rule"));
        if(!preview){
          const editor=element("div","project-script-divider-edit");
          const input=element("input","");
          input.type="text";input.value=String(line.text||"");input.dataset.scriptField="divider-text";
          input.setAttribute("aria-label",MOBILE_SCRIPT_TYPES[line.type]+" 이름");
          const auto=element("button","","자동 번호");
          auto.type="button";auto.dataset.scriptAction="auto";
          editor.append(input,auto);
          row.append(editor)
        }
      }else if(preview){
        const body=element("div","project-script-preview-body");
        if(line.type==="dialogue"&&line.speaker)body.append(element("strong","project-script-speaker",line.speaker));
        const content=element("div","project-script-preview-content");
        content.innerHTML=mobileScriptPreviewHtml(line.text);
        body.append(content);
        if(marker)row.append(element("span","project-script-row-label",marker));
        row.append(body)
      }else{
        if(line.type==="dialogue"){
          const speaker=element("input","project-script-speaker-input");
          speaker.type="text";speaker.placeholder="화자 이름";speaker.value=String(line.speaker||"");
          speaker.dataset.scriptField="speaker";
          speaker.setAttribute("aria-label",(index+1)+"번째 줄 화자");
          row.append(speaker)
        }
        const field=element("textarea","project-script-text");
        field.dataset.scriptField="text";field.rows=1;field.value=String(line.text||"");
        field.setAttribute("aria-label",(index+1)+"번째 "+(scriptLabels[line.type]||"지문")+" 내용");
        field.placeholder=line.type==="dialogue"?"대사를 입력하세요":line.type==="direction"?"연출 / 구도를 입력하세요":line.type==="background"?"장소·시간·분위기를 입력하세요":"행동, 서술, 메모 등을 입력하세요";
        const main=element("div","project-script-line-main"+(marker?" project-script-marked":""));
        if(marker)main.append(element("span","project-script-row-label",marker));
        main.append(field);
        row.append(main)
      }
      if(!preview){
        const tools=element("div","project-script-row-tools");
        tools.append(mobileScriptPicker("type",MOBILE_SCRIPT_TYPES[line.type]||"지문",Object.entries(MOBILE_SCRIPT_TYPES)));
        if(line.type==="dialogue"&&characters.length){
          const selected=characters.find(item=>String(item.id)===String(line.characterId||""))||matchMobileScriptCharacter(line.speaker,characters);
          tools.append(mobileScriptPicker("character",selected?.name||"캐릭터 선택",characters.map(item=>[item.id,String(item.name||"이름 없음")])))
        }
        if(line.type==="direction"){
          tools.append(mobileScriptPicker("shot",MOBILE_SHOT_PRESETS.includes(line.text)?line.text:"연출 선택",MOBILE_SHOT_PRESETS.map(preset=>[preset,preset])))
        }
        const insert=element("button","project-script-insert","＋ 다음 줄");
        insert.type="button";insert.dataset.scriptAction="insert";
        const more=element("button","project-script-more","⋯");
        more.type="button";more.dataset.scriptAction="menu";
        more.setAttribute("aria-label",(index+1)+"번째 줄 작업");
        more.setAttribute("aria-expanded","false");
        const menu=element("div","project-script-row-menu");
        menu.hidden=true;
        for(const [action,label,disabled] of [["up","위로 이동",index===0],["down","아래로 이동",index===edit.scriptBlocks.length-1],["delete","줄 삭제",false]]){
          const button=element("button","",label);
          button.type="button";button.dataset.scriptAction=action;button.disabled=disabled;
          menu.append(button)
        }
        tools.append(insert,more,menu);
        row.append(tools);
        if(edit.activeLineId===String(line.id))row.classList.add("active")
      }
      blockEditorScriptRows.append(row)
    });
    blockEditorScriptRows.querySelectorAll("textarea").forEach(resizeMobileScriptText);
    if(focusId){
      const selected=[...blockEditorScriptRows.querySelectorAll(".project-script-row")].find(row=>row.dataset.lineId===String(focusId));
      selected?.querySelector("textarea,[data-script-action=divider]")?.focus()
    }
  }

  function addMobileScriptLine(type="narration",afterId=""){
    const edit=activeBlockEditor;
    if(edit?.type!=="script")return;
    const line=mobileScriptLine(MOBILE_SCRIPT_TYPES[type]?type:"narration");
    const index=edit.scriptBlocks.findIndex(item=>String(item.id)===String(afterId));
    edit.scriptBlocks.splice(index<0?edit.scriptBlocks.length:index+1,0,line);
    renumberMobileScriptLines();
    edit.preview=false;
    blockEditorScriptTypeMenu.hidden=true;
    blockEditorScriptAddType.setAttribute("aria-expanded","false");
    renderMobileScriptRows(line.id);
    scheduleMobileGeneralBlockSave()
  }
  function blockEditorHasContent(){
    const scriptContent=activeBlockEditor?.type==="script"&&activeBlockEditor.scriptBlocks.some(line=>String(line.text||"").trim()||String(line.speaker||"").trim());
    return Boolean(blockEditorTitle.value.trim()||scriptContent||activeBlockEditor?.type!=="script"&&mobileBlockPlainText(blockEditorSummary).trim()||mobileBlockPlainText(blockEditorNotes).trim()||activeBlockEditor?.completed)
  }

  async function persistMobileBlock(){
    const edit=activeBlockEditor;
    if(!edit)return true;
    const current=mobileProjectContext(edit.projectId,edit.episodeId);
    if(!current.project||!current.unit){
      setMobileBlockEditorStatus("편집할 작품 또는 화를 찾지 못했습니다.");
      return false
    }
    current.unit.stages=current.unit.stages&&typeof current.unit.stages==="object"?current.unit.stages:{};
    const list=Array.isArray(current.unit.stages[edit.stageId])?current.unit.stages[edit.stageId]:null;
    if(!list){
      setMobileBlockEditorStatus("편집할 파트를 찾지 못했습니다.");
      return false
    }
    if(edit.creating){
      if(!blockEditorHasContent())return true;
      const summary=mobileBlockEditorData(blockEditorSummary),notes=mobileBlockEditorData(blockEditorNotes);
      const block={
        id:uid(),
        type:edit.type,
        title:blockEditorTitle.value.trim(),
        summary:edit.type==="script"?"":summary.plain,
        notes:notes.plain,
        summaryHtml:edit.type==="script"?"":summary.html,
        notesHtml:notes.html,
        tags:[],
        completed:Boolean(edit.completed),
        children:[],
        ...(edit.type==="script"?{scriptBlocks:clone(edit.scriptBlocks)}:{})
      };
      list.push(block);
      edit.blockIndex=list.length-1;
      edit.blockId=String(block.id);
      edit.creating=false
    }else{
      let target=edit.blockId?list.find(item=>String(item?.id||"")===edit.blockId):null;
      if(!target&&edit.blockIndex>=0&&edit.blockIndex<list.length)target=list[edit.blockIndex];
      if(!target||target.type!==edit.type){
        setMobileBlockEditorStatus("편집할 블록을 찾지 못했습니다.");
        return false
      }
      const summary=mobileBlockEditorData(blockEditorSummary),notes=mobileBlockEditorData(blockEditorNotes);
      target.title=blockEditorTitle.value.trim();
      target.notes=notes.plain;
      target.notesHtml=notes.html;
      if(edit.type==="script")target.scriptBlocks=clone(edit.scriptBlocks);
      else{
        target.summary=summary.plain;
        target.summaryHtml=summary.html
      }
      target.completed=Boolean(edit.completed);
      edit.blockId=String(target.id||edit.blockId||"")
    }
    current.project.updatedAt=new Date().toISOString();
    try{
      await repository.replaceState(current.state);
      if(activeBlockEditor===edit){
        blockEditorDelete.hidden=edit.creating;
        blockEditorDelete.disabled=false;
        setMobileBlockEditorStatus("")
      }
      return true
    }catch(error){
      console.error("모바일 블록 자동 저장 실패",error);
      logDiagnostic("error","REPOSITORY","블록 자동 저장에 실패했습니다.",error);
      if(activeBlockEditor===edit)setMobileBlockEditorStatus("자동 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.");
      return false
    }
  }

  function queueMobileGeneralBlockSave(){
    const edit=activeBlockEditor;
    if(!edit)return Promise.resolve(true);
    blockSaveChain=blockSaveChain.then(()=>activeBlockEditor===edit?persistMobileBlock():true);
    return blockSaveChain
  }

  function scheduleMobileGeneralBlockSave(){
    if(!activeBlockEditor)return;
    clearTimeout(blockSaveTimer);
    blockSaveTimer=setTimeout(()=>{
      blockSaveTimer=0;
      queueMobileGeneralBlockSave()
    },350)
  }

  async function flushMobileGeneralBlockSave(){
    clearTimeout(blockSaveTimer);
    blockSaveTimer=0;
    return queueMobileGeneralBlockSave()
  }

  function closeMobileGeneralBlockEditor(){
    clearTimeout(blockSaveTimer);
    blockSaveTimer=0;
    hideMobileBlockFormatBar();
    activeBlockEditor=null;
    const project=(snapshot().projects||[]).find(item=>String(item?.id||"")===String(activeDocumentId||""));
    if(!project){renderHome();return}
    showScreen(projectReaderScreen,{heading:"홈",back:true,account:false,nav:"library"});
    renderProject(project)
  }

  function openMobileBlockEditor(stageId,blockIndex=-1,type="detail"){
    const projectId=String(activeDocumentId||""),episodeId=String(activeEpisodeId||"");
    const initial=mobileProjectContext(projectId,episodeId);
    const blocks=Array.isArray(initial.unit?.stages?.[stageId])?initial.unit.stages[stageId]:null;
    const index=Number(blockIndex),existing=blocks&&Number.isInteger(index)&&index>=0&&index<blocks.length?blocks[index]:null;
    if(!initial.project||!initial.unit||!blocks)return;
    type=existing?.type==="script"?"script":existing?"detail":type==="script"?"script":"detail";
    const stage=(initial.unit.stageDefs||[]).find(item=>String(item?.id||"")===String(stageId||""));
    clearTimeout(blockSaveTimer);
    blockSaveTimer=0;
    activeBlockEditor={
      projectId,episodeId,stageId:String(stageId||""),blockIndex:existing?index:-1,
      blockId:existing?String(existing.id||""):"",creating:!existing,completed:Boolean(existing?.completed),type,
      scriptBlocks:type==="script"&&Array.isArray(existing?.scriptBlocks)?clone(existing.scriptBlocks):type==="script"?[mobileScriptLine()]:[],
      characters:type==="script"&&Array.isArray(initial.project.characters)?initial.project.characters:[],
      preview:false
    };
    if(type==="script"&&!activeBlockEditor.scriptBlocks.length)activeBlockEditor.scriptBlocks=[mobileScriptLine()];
    if(type==="script")renumberMobileScriptLines();
    blockEditorScriptTypeMenu.hidden=true;
    blockEditorScriptAddType.setAttribute("aria-expanded","false");
    blockEditorKind.textContent=type==="script"?"스크립트 블록":"일반 블록";
    blockEditorMainSection.hidden=type==="script";
    blockEditorScriptSection.hidden=type!=="script";
    blockEditorTitle.value=String(existing?.title||"");
    blockEditorSummary.innerHTML=mobileBlockRichHtml(existing?.summary,existing?.summaryHtml);
    blockEditorNotes.innerHTML=mobileBlockRichHtml(existing?.notes,existing?.notesHtml);
    if(type==="script")renderMobileScriptRows();
    blockEditorContext.textContent=(stage?.name||"파트")+(initial.project.kind==="long"&&initial.unit?.title?" · "+initial.unit.title:"");
    blockEditorDelete.hidden=!existing;
    blockEditorDelete.disabled=false;
    setMobileBlockEditorStatus("");
    hideMobileBlockFormatBar();
    syncMobileBlockCompletion();
    showScreen(blockEditorScreen,{heading:existing?(type==="script"?"스크립트 편집":"블록 편집"):(type==="script"?"새 스크립트":"새 블록"),back:true,account:false,nav:"library"});
    releaseMobileInputFocus()
  }

  async function deleteMobileBlock(){
    const edit=activeBlockEditor;
    if(!edit||edit.creating)return;
    clearTimeout(blockSaveTimer);
    blockSaveTimer=0;
    await blockSaveChain;
    if(activeBlockEditor!==edit)return;
    const current=mobileProjectContext(edit.projectId,edit.episodeId),list=Array.isArray(current.unit?.stages?.[edit.stageId])?current.unit.stages[edit.stageId]:null;
    const target=(list||[]).find(item=>String(item?.id||"")===String(edit.blockId||""))||(list&&edit.blockIndex>=0&&edit.blockIndex<list.length?list[edit.blockIndex]:null);
    if(!current.project||!current.unit||!target||target.type!==edit.type){
      setMobileBlockEditorStatus("삭제할 블록을 찾지 못했습니다.");
      return
    }
    const confirmed=await openMobileConfirm({
      title:"블록을 삭제하시겠습니까?",
      message:Array.isArray(target.children)&&target.children.length?"하위 블록도 함께 휴지통으로 이동합니다.":"이 블록을 휴지통으로 이동합니다.",
      confirmLabel:"삭제",
      cancelLabel:"취소",
      destructive:true
    });
    if(!confirmed)return;
    blockEditorDelete.disabled=true;
    setMobileBlockEditorStatus("");
    try{
      const index=list.indexOf(target);
      pushMobileTrash(current.state,"block",target.title||"제목 없는 블록",target,{projectId:current.project.id,episodeId:current.project.kind==="long"?current.unit.id:null,stageId:edit.stageId,index});
      list.splice(index,1);
      current.project.updatedAt=new Date().toISOString();
      await repository.replaceState(current.state);
      closeMobileGeneralBlockEditor()
    }catch(error){
      console.error("모바일 블록 삭제 실패",error);
      logDiagnostic("error","REPOSITORY","블록 삭제에 실패했습니다.",error);
      blockEditorDelete.disabled=false;
      setMobileBlockEditorStatus("삭제하지 못했습니다. 다시 시도해 주세요.")
    }
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
    const addPart=element("button","part-step part-add","");
    addPart.type="button";
    addPart.title="파트 추가";
    addPart.setAttribute("aria-label","파트 추가");
    addPart.innerHTML='<i data-lucide="plus" aria-hidden="true"></i>';
    addPart.onclick=()=>openMobileProjectStageEditor();
    tracker.append(addPart);
    host.append(tracker);

    const carousel=element("div","stage-carousel"),sections=[];
    for(const stage of stageDefs){
      const section=element("section","stage-section"),stageHead=element("header","stage-heading"),stripe=element("span","stage-color"),copy=element("div",""),stageColor=safeColor(stage.color,"#A9D6FF");
      section.dataset.stageId=String(stage.id);
      stageHead.dataset.stageId=String(stage.id);
      section.style.setProperty("--stage-color",stageColor);
      stripe.style.setProperty("--stage-color",stageColor);
      copy.append(element("h4","",stage.name||"파트"));
      if(stage.hint)copy.append(element("p","",stage.hint));
      const edit=element("button","stage-edit-button","");
      edit.type="button";
      edit.setAttribute("aria-label",(stage.name||"파트")+" 편집");
      edit.title="파트 편집";
      edit.innerHTML='<i data-lucide="pencil" aria-hidden="true"></i>';
      edit.onclick=()=>openMobileProjectStageEditor(stage.id);
      stageHead.append(stripe,copy,edit);
      const blocks=element("div","block-list"),items=Array.isArray(unit.stages?.[stage.id])?unit.stages[stage.id]:[];
      if(items.length)items.forEach((block,blockIndex)=>blocks.append(blockElement(block,{compact:compactBlocks,stageId:stage.id,blockIndex})));
      else blocks.append(element("div","empty-stage","등록된 블록이 없습니다."));
      const addBlock=element("button","stage-add-block","");
      addBlock.type="button";
      addBlock.innerHTML='<i data-lucide="plus" aria-hidden="true"></i><span>일반 블록 추가</span>';
      addBlock.onclick=()=>openMobileBlockEditor(stage.id);
      const addScript=element("button","stage-add-block","");
      addScript.type="button";
      addScript.innerHTML='<i data-lucide="plus" aria-hidden="true"></i><span>스크립트 블록 추가</span>';
      addScript.onclick=()=>openMobileBlockEditor(stage.id,-1,"script");
      const addActions=element("div","stage-add-actions");
      addActions.append(addBlock,addScript);
      section.append(stageHead,blocks,addActions);
      carousel.append(section);
      sections.push(section)
    }

    if(!sections.length){
      const empty=element("div","project-stage-empty"),copy=element("span","","아직 파트가 없습니다."),button=element("button","","첫 파트 추가");
      button.type="button";
      button.onclick=()=>openMobileProjectStageEditor();
      empty.append(copy,button);
      host.append(empty)
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
  function closeMobileEpisodeEditor(){
    document.querySelector("[data-episode-editor]")?.remove()
  }

  function openMobileEpisodeEditor(episodeId=""){
    const projectId=String(activeDocumentId||""),state=snapshot();
    const project=(state.projects||[]).find(item=>String(item?.id||"")===projectId);
    if(!project||project.kind!=="long")return;
    const isNew=!episodeId,episode=isNew?null:(project.episodes||[]).find(item=>String(item?.id||"")===String(episodeId));
    if(!isNew&&!episode)return;
    let selectedColor=safeColor(episode?.color||randomCardColor(),CARD_COLORS[0]),colorsOpen=false;
    let colorCustom=!CARD_COLORS.some(color=>color.toLowerCase()===selectedColor.toLowerCase());
    closeMobileEpisodeEditor();
    const wrap=element("div","nav-sheet-backdrop project-stage-backdrop"),panel=element("section","nav-sheet project-stage-panel");
    wrap.dataset.episodeEditor="1";
    panel.setAttribute("role","dialog");
    panel.setAttribute("aria-modal","true");
    panel.setAttribute("aria-label",isNew?"새 화 추가":"화 편집");
    panel.innerHTML='<div class="project-stage-editor-head"><div class="create-form-kind"><span class="create-form-kind-icon"><i data-lucide="files" aria-hidden="true"></i></span><strong>'+(isNew?"새 화 추가":"화 편집")+'</strong></div><button type="button" class="sheet-close" data-episode-editor-close aria-label="닫기"><i data-lucide="x" aria-hidden="true"></i></button></div>'+
      '<div class="project-stage-editor-body">'+
      '<label class="create-field"><span>제목</span><input type="text" data-episode-title maxlength="120" autocomplete="off"></label>'+
      '<label class="create-field"><span>부제 <small>· 선택</small></span><input type="text" data-episode-subtitle maxlength="240" autocomplete="off" placeholder="화 부제"></label>'+
      '<fieldset class="create-color-field project-stage-color-field">'+
      '<legend>색상</legend>'+
      '<button class="create-color-toggle" type="button" data-episode-color-toggle aria-expanded="false">'+
      '<span class="create-color-preview" data-episode-color-preview aria-hidden="true"></span>'+
      '<span class="create-color-toggle-label">색상 선택</span>'+
      '<i data-lucide="chevron-down" aria-hidden="true"></i></button>'+
      '<div class="create-color-options" data-episode-color-options hidden>'+
      '<div class="create-color-grid" data-episode-color-grid aria-label="화 색상"></div>'+
      '<div class="create-color-editor" data-episode-color-editor hidden>'+
      '<input type="color" data-episode-color-picker aria-label="직접 색상 선택">'+
      '<input type="text" data-episode-color-hex maxlength="7" spellcheck="false" autocomplete="off" aria-label="HEX 색상">'+
      '</div></div></fieldset>'+
      '<p class="project-stage-editor-status" data-episode-status hidden></p>'+
      '<div class="note-sheet-actions"><button type="button" class="secondary" data-episode-editor-close>취소</button><button type="button" class="primary" data-episode-save>'+(isNew?"추가":"저장")+'</button></div>'+
      '</div>';
    wrap.append(panel);
    document.body.append(wrap);

    const title=panel.querySelector("[data-episode-title]"),subtitle=panel.querySelector("[data-episode-subtitle]");
    const colorToggle=panel.querySelector("[data-episode-color-toggle]"),colorPreview=panel.querySelector("[data-episode-color-preview]");
    const colorOptions=panel.querySelector("[data-episode-color-options]"),colorGrid=panel.querySelector("[data-episode-color-grid]");
    const colorEditor=panel.querySelector("[data-episode-color-editor]"),colorPicker=panel.querySelector("[data-episode-color-picker]");
    const colorHex=panel.querySelector("[data-episode-color-hex]"),status=panel.querySelector("[data-episode-status]"),save=panel.querySelector("[data-episode-save]");
    title.value=String(episode?.title||(project.episodes||[]).length+1+"화");
    subtitle.value=String(episode?.subtitle||"");
    const syncColor=()=>{
      selectedColor=safeColor(selectedColor,CARD_COLORS[0]);
      colorPreview.style.setProperty("--swatch",selectedColor);
      colorToggle.setAttribute("aria-expanded",String(colorsOpen));
      colorOptions.hidden=!colorsOpen;
      colorEditor.hidden=!colorCustom;
      colorPicker.value=selectedColor;
      colorHex.value=selectedColor.toUpperCase();
      colorGrid.querySelectorAll("[data-episode-color]").forEach(button=>{
        const active=!colorCustom&&String(button.dataset.episodeColor||"").toLowerCase()===selectedColor.toLowerCase();
        button.classList.toggle("active",active);
        button.setAttribute("aria-pressed",String(active))
      });
      const custom=colorGrid.querySelector("[data-episode-color-custom]");
      if(custom){
        custom.classList.toggle("active",colorCustom);
        custom.setAttribute("aria-pressed",String(colorCustom))
      }
    };
    for(const color of CARD_COLORS){
      const button=document.createElement("button");
      button.type="button";
      button.className="create-color-swatch";
      button.dataset.episodeColor=color;
      button.style.setProperty("--swatch",color);
      button.setAttribute("aria-label","색상 "+color.toUpperCase());
      button.onclick=()=>{
        selectedColor=color;
        colorCustom=false;
        colorsOpen=false;
        syncColor()
      };
      colorGrid.append(button)
    }
    const customColor=document.createElement("button");
    customColor.type="button";
    customColor.className="create-color-swatch custom";
    customColor.dataset.episodeColorCustom="true";
    customColor.setAttribute("aria-label","직접 색상");
    customColor.innerHTML='<i data-lucide="palette" aria-hidden="true"></i>';
    customColor.onclick=()=>{
      colorCustom=true;
      colorsOpen=true;
      syncColor();
      requestAnimationFrame(()=>colorHex.focus())
    };
    colorGrid.append(customColor);
    colorToggle.onclick=()=>{colorsOpen=!colorsOpen;syncColor()};
    colorPicker.oninput=()=>{
      colorCustom=true;
      colorsOpen=true;
      selectedColor=safeColor(colorPicker.value,selectedColor||CARD_COLORS[0]);
      syncColor()
    };
    colorHex.oninput=()=>{
      const value=safeColor(colorHex.value,"");
      if(!value)return;
      colorCustom=true;
      colorsOpen=true;
      selectedColor=value;
      colorPicker.value=value;
      colorPreview.style.setProperty("--swatch",value)
    };
    colorHex.onblur=()=>{
      selectedColor=safeColor(colorHex.value,selectedColor||CARD_COLORS[0]);
      colorCustom=true;
      syncColor()
    };
    const setStatus=message=>{
      status.textContent=String(message||"");
      status.hidden=!message
    };
    panel.querySelectorAll("[data-episode-editor-close]").forEach(button=>button.onclick=closeMobileEpisodeEditor);
    wrap.onclick=event=>{if(event.target===wrap)closeMobileEpisodeEditor()};
    save.onclick=async()=>{
      const current=snapshot(),targetProject=(current.projects||[]).find(item=>String(item?.id||"")===projectId);
      const target=targetProject?.kind==="long"&&!isNew?(targetProject.episodes||[]).find(item=>String(item?.id||"")===String(episodeId)):null;
      if(targetProject?.kind!=="long"||(!isNew&&!target)){
        setStatus(isNew?"작품을 찾지 못했습니다.":"편집할 화를 찾지 못했습니다.");
        return
      }
      const next=target||{id:uid(),...defaultStoryStages()};
      next.title=title.value.trim()||"제목 없는 화";
      next.subtitle=subtitle.value.trim();
      next.color=selectedColor;
      if(isNew){targetProject.episodes=Array.isArray(targetProject.episodes)?targetProject.episodes:[];targetProject.episodes.push(next)}
      targetProject.updatedAt=new Date().toISOString();
      save.disabled=true;
      setStatus("");
      try{
        await repository.replaceState(current);
        closeMobileEpisodeEditor();
        if(activeDocumentType==="project"&&String(activeDocumentId)===projectId){
          activeEpisodeId="";
          renderProject(targetProject)
        }
      }catch(error){
        console.error(isNew?"모바일 화 추가 실패":"모바일 화 정보 저장 실패",error);
        logDiagnostic("error","REPOSITORY",isNew?"화를 추가하지 못했습니다.":"화 정보 저장에 실패했습니다.",error);
        save.disabled=false;
        setStatus("저장하지 못했습니다. 다시 시도해 주세요.")
      }
    };
    syncColor();
    refreshLucideIcons();
    releaseMobileInputFocus()
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
      const activeIndex=list.findIndex(item=>String(item.id)===activeEpisodeId);
      if(activeIndex<0){
        activeEpisodeId="";
        content.replaceChildren();
        const addEpisode=element("button","episode-add-button","");
        addEpisode.type="button";
        addEpisode.innerHTML='<i data-lucide="plus" aria-hidden="true"></i><span>새 화 추가</span>';
        addEpisode.onclick=()=>openMobileEpisodeEditor();
        episodes.append(addEpisode);
        if(!list.length)content.replaceChildren(element("div","status-card","등록된 화가 없습니다."));
        const showCompletion=snapshot().settings?.completionEnabled!==false;
        list.forEach((episode,index)=>{
          const card=element("article","episode-button");
          card.dataset.episodeId=String(episode.id);
          const episodeColor=safeColor(episode.color,"#A9D6FF"),cardInk=cardForeground(episodeColor);
          card.style.setProperty("--card-color",episodeColor);
          card.style.setProperty("--custom-on",cardInk);
          card.style.setProperty("--custom-muted",cardInk);
          const blocks=allBlocks(episode),done=blocks.filter(block=>block.completed).length,todo=blocks.length-done;
          card.append(
            element("span","episode-number",(index+1)+"화"),
            element("strong","episode-title",episode.title||(index+1)+"화"),
            element("span","episode-desc",episode.subtitle||blocks.length+"개 블록")
          );
          if(showCompletion){
            const completion=element("span","episode-completion");
            completion.append(element("span","","완성 "+done),element("span","","미완성 "+todo));
            card.append(completion)
          }
          const open=element("button","episode-card-open");
          open.type="button";
          open.setAttribute("aria-label",(episode.title||(index+1)+"화")+" 열기");
          open.onclick=()=>{
            activeEpisodeId=String(episode.id);
            renderProject(project);
            scrollAppToTop({smooth:true})
          };
          const menu=element("button","episode-card-menu");
          menu.type="button";
          menu.title="화 편집";
          menu.setAttribute("aria-label",(episode.title||(index+1)+"화")+" 편집");
          menu.innerHTML='<i data-lucide="ellipsis-vertical" aria-hidden="true"></i>';
          menu.onclick=event=>{event.stopPropagation();openMobileEpisodeEditor(episode.id)};
          card.append(open,menu);
          episodes.append(card)
        });
        refreshLucideIcons();
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

  // Long-press sorting keeps scrolling and ordinary taps available until the hold completes.
  let mobileSort=null,mobileSortBusy=false,suppressSortClickUntil=0;
  function mobileSortSource(target){
    if(!(target instanceof Element)||target.closest(".episode-card-menu,.stage-edit-button,input,textarea,[contenteditable]"))return null;
    const episode=target.closest(".episode-button");
    if(episode&&projectReaderScreen.contains(episode))return {kind:"episode",element:episode,sourceId:episode.dataset.episodeId};
    if(target.closest("button"))return null;
    const heading=target.closest(".stage-heading");
    if(heading&&projectReaderScreen.contains(heading))return {kind:"stage",element:heading.closest(".stage-section"),sourceId:heading.dataset.stageId};
    const block=target.closest(".editable-block-card");
    if(block&&projectReaderScreen.contains(block))return {kind:"block",element:block,sourceId:block.dataset.blockId,sourceIndex:Number(block.dataset.blockIndex),sourceStageId:block.dataset.stageId};
    return null
  }
  function clearMobileSortMarker(sort){
    sort.markerElement?.classList.remove("mobile-sort-before","mobile-sort-after","mobile-sort-target");
    sort.markerList?.classList.remove("mobile-sort-before","mobile-sort-after","mobile-sort-empty");
    sort.markerElement=null;sort.markerList=null;sort.target=null
  }
  function closestMobileSortItem(items,x,y){
    return items.reduce((best,item)=>{
      const rect=item.getBoundingClientRect(),dx=Math.max(rect.left-x,0,x-rect.right),dy=Math.max(rect.top-y,0,y-rect.bottom),distance=dx*dx+dy*dy;
      return !best||distance<best.distance?{item,distance}:best
    },null)?.item||null
  }
  function updateMobileSortTarget(sort){
    clearMobileSortMarker(sort);
    const {x,y}=sort;
    if(sort.kind==="episode"){
      const list=$("#episodeList"),rect=list.getBoundingClientRect();
      if(x<rect.left-24||x>rect.right+24||y<rect.top-24||y>rect.bottom+24)return;
      const cards=[...list.querySelectorAll(".episode-button")],card=closestMobileSortItem(cards,x,y);
      if(!card)return;
      const bounds=card.getBoundingClientRect(),after=y>bounds.top+bounds.height/2;
      card.classList.add(after?"mobile-sort-after":"mobile-sort-before");
      sort.markerElement=card;sort.target={targetId:card.dataset.episodeId,after};
      return
    }
    const carousel=$("#projectContent .stage-carousel");
    if(!carousel)return;
    const rect=carousel.getBoundingClientRect();
    if(x<rect.left-24||x>rect.right+24||y<rect.top-32||y>rect.bottom+32)return;
    const sections=[...carousel.querySelectorAll(".stage-section")];
    const under=document.elementFromPoint(x,y)?.closest(".stage-section");
    const section=under&&carousel.contains(under)?under:closestMobileSortItem(sections,x,y);
    if(!section)return;
    const bounds=section.getBoundingClientRect();
    if(sort.kind==="stage"){
      const after=x>bounds.left+bounds.width/2;
      section.classList.add(after?"mobile-sort-after":"mobile-sort-before");
      sort.markerElement=section;sort.target={targetId:section.dataset.stageId,after};
      return
    }
    const list=section.querySelector(".block-list"),blocks=[...list.querySelectorAll(":scope > .editable-block-card")];
    const card=closestMobileSortItem(blocks,x,y);
    section.classList.add("mobile-sort-target");sort.markerElement=section;
    if(card){
      const cardRect=card.getBoundingClientRect(),after=y>cardRect.top+cardRect.height/2;
      card.classList.add(after?"mobile-sort-after":"mobile-sort-before");
      sort.markerList=card;
      sort.target={targetStageId:section.dataset.stageId,targetId:card.dataset.blockId,targetIndex:Number(card.dataset.blockIndex),after}
    }else{
      list.classList.add("mobile-sort-empty");sort.markerList=list;
      sort.target={targetStageId:section.dataset.stageId,targetId:"",targetIndex:0,after:false}
    }
  }
  function moveMobileSortPreview(sort){
    sort.preview.style.left=`${Math.max(8,Math.min(sort.x+12,window.innerWidth-220))}px`;
    sort.preview.style.top=`${Math.max(8,Math.min(sort.y+12,window.innerHeight-65))}px`;
    updateMobileSortTarget(sort)
  }
  function scrollMobileSort(sort){
    if(mobileSort!==sort||!sort.active)return;
    let moved=false;
    const carousel=$("#projectContent .stage-carousel");
    if(sort.kind!=="episode"&&carousel){
      const rect=carousel.getBoundingClientRect();
      if(sort.y>=rect.top-35&&sort.y<=rect.bottom+35){
        const speed=sort.x<rect.left+58?-14:sort.x>rect.right-58?14:0;
        if(speed){const before=carousel.scrollLeft;carousel.scrollLeft+=speed;moved=carousel.scrollLeft!==before}
      }
    }
    const viewport=mobileScroll.getBoundingClientRect(),vertical=sort.y<viewport.top+70?-12:sort.y>viewport.bottom-70?12:0;
    if(vertical){const before=mobileScroll.scrollTop;mobileScroll.scrollTop+=vertical;moved=mobileScroll.scrollTop!==before||moved}
    if(moved)updateMobileSortTarget(sort);
    sort.scrollFrame=requestAnimationFrame(()=>scrollMobileSort(sort))
  }
  function activateMobileSort(sort){
    if(mobileSort!==sort||!sort.element.isConnected)return;
    sort.active=true;
    sort.element.classList.add("mobile-sort-source");
    const preview=element("div","mobile-sort-preview",sort.element.querySelector(".episode-title,.stage-heading h4,.block-head h5")?.textContent?.trim()||sort.element.textContent.trim().slice(0,60)||"블록");
    preview.setAttribute("aria-hidden","true");sort.preview=preview;
    document.body.append(preview);
    document.body.classList.add("mobile-sorting");
    const carousel=$("#projectContent .stage-carousel");
    if(carousel&&sort.kind!=="episode"){sort.carousel=carousel;carousel.style.scrollSnapType="none"}
    moveMobileSortPreview(sort);
    sort.scrollFrame=requestAnimationFrame(()=>scrollMobileSort(sort))
  }
  function cancelMobileSort(){
    const sort=mobileSort;
    if(!sort)return;
    clearTimeout(sort.holdTimer);
    if(sort.scrollFrame)cancelAnimationFrame(sort.scrollFrame);
    clearMobileSortMarker(sort);
    sort.element.classList.remove("mobile-sort-source");
    sort.preview?.remove();sort.carousel?.style.removeProperty("scroll-snap-type");
    document.body.classList.remove("mobile-sorting");
    mobileSort=null
  }
  async function finishMobileSort(){
    const sort=mobileSort;if(!sort)return;
    const move=sort.active&&sort.target?{
      ...sort.target,kind:sort.kind,projectId:sort.projectId,episodeId:sort.episodeId,
      sourceId:sort.sourceId,sourceIndex:sort.sourceIndex,sourceStageId:sort.sourceStageId
    }:null;
    if(sort.active)suppressSortClickUntil=Date.now()+250;
    cancelMobileSort();
    if(!move||mobileSortBusy||activeDocumentId!==move.projectId||activeEpisodeId!==move.episodeId)return;
    const state=snapshot();
    if(!moveMobileStoryItem(state,move))return;
    mobileSortBusy=true;
    try{
      await repository.replaceState(state);
      const project=(snapshot().projects||[]).find(item=>String(item?.id||"")===move.projectId);
      if(project&&activeDocumentId===move.projectId)renderProject(project)
    }catch(error){
      logDiagnostic("error","REPOSITORY","드래그로 변경한 순서를 저장하지 못했습니다.",error);
      showSyncToast("순서를 저장하지 못했습니다. 다시 시도해 주세요.")
    }finally{mobileSortBusy=false}
  }
  function beginMobileSort(target,x,y,input,id){
    if(mobileSortBusy||mobileSort||projectReaderScreen.hidden)return;
    const source=mobileSortSource(target);
    if(!source)return;
    const sort={...source,projectId:String(activeDocumentId||""),episodeId:String(activeEpisodeId||""),input,id,x,y,startX:x,startY:y,active:false};
    mobileSort=sort;
    sort.holdTimer=setTimeout(()=>activateMobileSort(sort),380)
  }
  function trackMobileSort(x,y,event){
    const sort=mobileSort;if(!sort)return;
    sort.x=x;sort.y=y;
    if(!sort.active){if(Math.hypot(x-sort.startX,y-sort.startY)>9)cancelMobileSort();return}
    event?.preventDefault();
    moveMobileSortPreview(sort)
  }
  projectReaderScreen.addEventListener("touchstart",event=>{
    if(event.touches.length!==1)return;
    const touch=event.changedTouches[0];beginMobileSort(event.target,touch.clientX,touch.clientY,"touch",touch.identifier)
  },{passive:true});
  document.addEventListener("touchmove",event=>{
    const sort=mobileSort;if(!sort||sort.input!=="touch")return;
    if(event.touches.length!==1){cancelMobileSort();return}
    const touch=[...event.touches].find(item=>item.identifier===sort.id);
    if(touch)trackMobileSort(touch.clientX,touch.clientY,event)
  },{passive:false});
  document.addEventListener("touchend",event=>{
    const sort=mobileSort;
    if(sort?.input==="touch"&&[...event.changedTouches].some(item=>item.identifier===sort.id))finishMobileSort()
  });
  document.addEventListener("touchcancel",()=>{if(mobileSort?.input==="touch")cancelMobileSort()});
  projectReaderScreen.addEventListener("pointerdown",event=>{
    if(event.pointerType==="touch"||event.button!==0)return;
    beginMobileSort(event.target,event.clientX,event.clientY,"pointer",event.pointerId)
  });
  document.addEventListener("pointermove",event=>{
    if(mobileSort?.input==="pointer"&&mobileSort.id===event.pointerId)trackMobileSort(event.clientX,event.clientY,event)
  });
  document.addEventListener("pointerup",event=>{
    if(mobileSort?.input==="pointer"&&mobileSort.id===event.pointerId)finishMobileSort()
  });
  document.addEventListener("pointercancel",event=>{if(mobileSort?.input==="pointer"&&mobileSort.id===event.pointerId)cancelMobileSort()});
  projectReaderScreen.addEventListener("click",event=>{
    if(Date.now()>suppressSortClickUntil)return;
    event.preventDefault();event.stopImmediatePropagation()
  },true);
  projectReaderScreen.addEventListener("contextmenu",event=>{if(mobileSort){event.preventDefault();event.stopPropagation()}});
  window.addEventListener("blur",cancelMobileSort);

  function sanitizedNoteHtml(value){
    const template=document.createElement("template");
    template.innerHTML=String(value||"");
    const allowed=new Set(["B","STRONG","I","EM","U","S","STRIKE","A","SPAN","FONT","P","DIV","BR","H1","H2","H3","UL","OL","LI","BLOCKQUOTE","PRE","CODE","SUB","SUP","HR","DETAILS","SUMMARY","IMG"]);
    const styles=new Set(["color","background-color","text-align","font-family","line-height"]);
    const walk=node=>{
      [...node.children].forEach(raw=>{
        let el=raw;
        if(el.tagName==="FONT"){
          const replacement=document.createElement("span"),legacyColor=String(el.getAttribute("color")||"").trim(),legacyFace=String(el.getAttribute("face")||"").trim();
          if(legacyColor)replacement.style.color=legacyColor;
          if(legacyFace)replacement.style.fontFamily=normalizeMobileNoteFont(legacyFace);
          while(el.firstChild)replacement.appendChild(el.firstChild);
          el.replaceWith(replacement);
          el=replacement
        }
        if(!allowed.has(el.tagName)){
          const parent=el.parentNode;
          while(el.firstChild)parent.insertBefore(el.firstChild,el);
          el.remove();
          walk(parent);
          return
        }
        for(const attribute of [...el.attributes]){
          const name=attribute.name.toLowerCase(),rawValue=String(attribute.value||"").trim();
          if(name==="href"&&el.tagName==="A"){
            if(!/^(https?:|mailto:|#)/i.test(rawValue))el.removeAttribute(attribute.name)
          }else if(name==="data-divider"&&el.tagName==="HR"&&["solid","dotted","dashed","double"].includes(rawValue)){
          }else if(name==="data-quote"&&el.tagName==="BLOCKQUOTE"&&["box","mark","pull"].includes(rawValue)){
          }else if(name==="start"&&el.tagName==="OL"&&/^\d+$/.test(rawValue)){
          }else if(name==="data-note-image"&&el.tagName==="IMG"&&rawValue){
          }else if(name==="data-note-image-width"&&el.tagName==="IMG"&&Number(rawValue)>0&&Number(rawValue)<=100){
          }else if(name==="alt"&&el.tagName==="IMG"){
          }else if(name==="style"){
            const kept=[...el.style].filter(key=>styles.has(key)).map(key=>key+":"+el.style.getPropertyValue(key)).join(";");
            if(kept)el.setAttribute("style",kept);else el.removeAttribute("style")
          }else el.removeAttribute(attribute.name)
        }
        if(el.tagName==="A"){el.setAttribute("target","_blank");el.setAttribute("rel","noopener noreferrer")}
        walk(el)
      })
    };
    walk(template.content);
    return template.innerHTML
  }

  function formatMobileNoteHtmlSource(html){
    const root=document.createElement("div");
    root.innerHTML=sanitizedNoteHtml(html||"");
    const source=[...root.childNodes].map(node=>node.nodeType===Node.TEXT_NODE?String(node.textContent||"").trim():node.outerHTML||"").filter(Boolean).join("\n");
    return source.replace(/<br\s*\/?>(?!\n)/gi,"$&\n").replace(/<\/(?:p|div|h1|h2|h3|blockquote|li|ul|ol|pre|details|summary)>(?!\n)/gi,"$&\n").replace(/\n{3,}/g,"\n\n").trim()
  }

  function mobileNoteCharacterText(html){
    const root=document.createElement("div");
    root.innerHTML=sanitizedNoteHtml(html||"");
    const blockTags=new Set(["DIV","P","H1","H2","H3","LI","UL","OL","BLOCKQUOTE","PRE","DETAILS","SUMMARY"]);
    const walk=node=>{
      if(node.nodeType===Node.TEXT_NODE)return String(node.data||"");
      if(node.nodeType!==Node.ELEMENT_NODE&&node.nodeType!==Node.DOCUMENT_FRAGMENT_NODE)return "";
      if(node.nodeType===Node.ELEMENT_NODE&&(node.tagName==="BR"||node.tagName==="HR"))return "\n";
      let out="",children=[...node.childNodes];
      children.forEach((child,index)=>{
        out+=walk(child);
        if(child.nodeType===Node.ELEMENT_NODE&&blockTags.has(child.tagName)&&index<children.length-1&&!out.endsWith("\n"))out+="\n"
      });
      return out
    };
    return walk(root).replace(/\r/g,"")
  }

  function mobileNoteCharacterCounts(){
    const html=noteEditorMode==="html"&&noteHtmlEditor?noteHtmlEditor.value:noteHtmlForStorage();
    const value=mobileNoteCharacterText(html),compact=value.replace(/\s/g,"");
    return {withSpaces:value.length,withoutSpaces:compact.length}
  }

  function updateMobileNoteCharacterCount(){
    if(activeDocumentType!=="note"||!noteCharCountSummary)return;
    const counts=mobileNoteCharacterCounts();
    noteCharCountSummary.textContent=counts.withSpaces.toLocaleString("ko-KR")+"자 · 공백 제외 "+counts.withoutSpaces.toLocaleString("ko-KR")+"자"
  }

  function mobileNoteCorrectionPlainText(root,units=null){
    if(!root)return "";
    const blockTags=new Set(["DIV","P","H1","H2","H3","LI","UL","OL","BLOCKQUOTE","PRE"]);
    const appendBreak=()=>{if(units)units.push({char:"\n",node:null,offset:-1});return "\n"};
    const walk=node=>{
      if(node.nodeType===Node.TEXT_NODE){
        const chars=Array.from(node.data||"");
        if(units)chars.forEach((char,offset)=>units.push({char,node,offset}));
        return chars.join("")
      }
      if(node.nodeType!==Node.ELEMENT_NODE)return "";
      const el=node;
      if(el.tagName==="BR"||el.tagName==="HR")return appendBreak();
      let out="",children=[...el.childNodes];
      children.forEach((child,index)=>{
        out+=walk(child);
        if(child.nodeType===Node.ELEMENT_NODE&&blockTags.has(child.tagName)&&index<children.length-1&&!out.endsWith("\n"))out+=appendBreak()
      });
      return out
    };
    return walk(root).replace(/\r/g,"")
  }

  function applyMobileNoteCorrectionTextDiff(originalHtml,originalText,correctedText){
    const root=document.createElement("div"),units=[];
    root.innerHTML=sanitizedNoteHtml(originalHtml);
    const mapped=mobileNoteCorrectionPlainText(root,units);
    if(mapped!==originalText)throw new Error("교정 전 노트의 텍스트 구조가 달라졌습니다.");
    const before=Array.from(originalText),after=Array.from(correctedText);
    if(before.join("")===after.join(""))return root.innerHTML;
    const backtrack=(trace,dMax)=>{
      let x=before.length,y=after.length,edits=[];
      for(let d=dMax;d>=0;d--){
        const v=trace[d],k=x-y,left=v.get(k-1),right=v.get(k+1);
        const prevK=k===-d||(k!==d&&(left??-Infinity)<(right??-Infinity))?k+1:k-1;
        const prevX=v.get(prevK)??0,prevY=prevX-prevK;
        while(x>prevX&&y>prevY){edits.push({type:"equal",char:before[x-1]});x--;y--}
        if(d===0)break;
        if(x===prevX){edits.push({type:"insert",char:after[y-1]});y--}
        else{edits.push({type:"delete",char:before[x-1]});x--}
      }
      return edits.reverse()
    };
    const max=before.length+after.length,trace=[];
    let frontier=new Map([[1,0]]),edits=null;
    for(let d=0;d<=max&&!edits;d++){
      trace.push(new Map(frontier));
      for(let k=-d;k<=d;k+=2){
        const left=frontier.get(k-1),right=frontier.get(k+1);
        let x=k===-d||(k!==d&&(left??-Infinity)<(right??-Infinity))?(right??0):(left??0)+1,y=x-k;
        while(x<before.length&&y<after.length&&before[x]===after[y]){x++;y++}
        frontier.set(k,x);
        if(x>=before.length&&y>=after.length){edits=backtrack(trace,d);break}
      }
    }
    if(!edits)throw new Error("교정문 차이를 계산하지 못했습니다.");
    const deleted=new Map(),inserted=new Map(),textNodes=new Set();
    units.forEach(unit=>{if(unit.node)textNodes.add(unit.node)});
    const deleteChar=unit=>{
      if(!unit?.node)throw new Error("교정 과정에서 문단 구조가 변경되어 서식을 안전하게 유지할 수 없습니다.");
      if(!deleted.has(unit.node))deleted.set(unit.node,new Set());
      deleted.get(unit.node).add(unit.offset)
    };
    const insertAt=(node,offset,value)=>{
      if(!node||!value)return;
      if(!inserted.has(node))inserted.set(node,new Map());
      const map=inserted.get(node);
      map.set(offset,(map.get(offset)||"")+value)
    };
    let oldPos=0;
    for(let index=0;index<edits.length;){
      if(edits[index].type==="equal"){oldPos++;index++;continue}
      const start=oldPos,removed=[];
      let addition="";
      while(index<edits.length&&edits[index].type!=="equal"){
        const edit=edits[index++];
        if(edit.type==="delete"){removed.push(units[oldPos]);oldPos++}
        else if(edit.type==="insert")addition+=edit.char
      }
      if(removed.some(unit=>unit?.char==="\n"&&!unit.node)||addition.includes("\n"))throw new Error("교정 과정에서 문단 구조가 변경되어 서식을 안전하게 유지할 수 없습니다.");
      removed.forEach(deleteChar);
      if(addition){
        const anchor=removed.find(unit=>unit?.node);
        if(anchor)insertAt(anchor.node,anchor.offset,addition);
        else{
          const next=units.slice(start).find(unit=>unit?.node);
          if(next)insertAt(next.node,next.offset,addition);
          else{
            const prev=[...units.slice(0,start)].reverse().find(unit=>unit?.node);
            if(prev)insertAt(prev.node,prev.offset+1,addition);
            else root.appendChild(document.createTextNode(addition))
          }
        }
      }
    }
    textNodes.forEach(node=>{
      const chars=Array.from(node.data||""),cuts=deleted.get(node)||new Set(),adds=inserted.get(node)||new Map();
      let out="";
      for(let offset=0;offset<=chars.length;offset++){
        if(adds.has(offset))out+=adds.get(offset);
        if(offset<chars.length&&!cuts.has(offset))out+=chars[offset]
      }
      node.data=out
    });
    return root.innerHTML
  }

  function closeMobileNoteCorrection(){
    document.querySelector("[data-note-correction]")?.remove()
  }

  async function openMobileNoteCorrection(){
    if(activeDocumentType!=="note"||!activeDocumentId)return;
    if(noteEditorMode==="html")await setMobileNoteEditorMode("rich");
    await flushMobileNoteSave();
    closeMobileNoteCorrection();
    const noteId=String(activeDocumentId),originalHtml=noteHtmlForStorage(),source=document.createElement("div");
    source.innerHTML=originalHtml;
    const originalPlain=mobileNoteCorrectionPlainText(source).replace(/\n+$/,"");
    const wrap=element("div","nav-sheet-backdrop note-correction-backdrop"),panel=element("section","nav-sheet note-correction-panel");
    wrap.dataset.noteCorrection="1";
    panel.setAttribute("role","dialog");
    panel.setAttribute("aria-modal","true");
    panel.setAttribute("aria-label","맞춤법 검사 도우미");
    panel.innerHTML='<div class="note-tool-sheet-head"><h3>맞춤법 검사 도우미</h3><button type="button" class="sheet-close" data-note-correction-close aria-label="닫기"><i data-lucide="x" aria-hidden="true"></i></button></div>'+
      '<div class="note-correction-body">'+
      '<section class="note-correction-step"><span class="note-correction-step-number">1</span><div><strong>현재 노트 원문</strong><p>서식을 제외한 노트 전문을 복사합니다.</p><button type="button" class="note-correction-action" data-note-correction-copy><i data-lucide="copy" aria-hidden="true"></i><span>전체 복사</span></button></div></section>'+
      '<section class="note-correction-step"><span class="note-correction-step-number">2</span><div><strong>외부에서 교정</strong><p>맞춤법 검사기에서 수정한 뒤 교정된 글 전체를 다시 복사하세요.</p></div></section>'+
      '<section class="note-correction-step"><span class="note-correction-step-number">3</span><div><div class="note-correction-result-head"><strong>교정 결과</strong><button type="button" class="note-correction-action" data-note-correction-paste><i data-lucide="clipboard-paste" aria-hidden="true"></i><span>전체 붙여넣기</span></button></div><textarea class="note-correction-text" data-note-correction-text placeholder="교정된 글 전체를 붙여넣으세요."></textarea></div></section>'+
      '<p class="note-correction-help"><i data-lucide="check" aria-hidden="true"></i><span>원문과 교정문을 비교해 기존 서식은 유지하고 달라진 텍스트만 반영합니다.</span></p>'+
      '<p class="note-correction-status" data-note-correction-status hidden></p>'+
      '<div class="note-sheet-actions"><button type="button" class="secondary" data-note-correction-close>취소</button><button type="button" class="primary" data-note-correction-apply>변경사항 반영</button></div></div>';
    wrap.append(panel);
    document.body.append(wrap);
    const correction=panel.querySelector("[data-note-correction-text]"),status=panel.querySelector("[data-note-correction-status]");
    const setCorrectionStatus=(message,error=false)=>{
      status.textContent=String(message||"");
      status.hidden=!message;
      status.classList.toggle("error",!!error)
    };
    panel.querySelectorAll("[data-note-correction-close]").forEach(button=>button.onclick=closeMobileNoteCorrection);
    wrap.onclick=event=>{if(event.target===wrap)closeMobileNoteCorrection()};
    panel.querySelector("[data-note-correction-copy]").onclick=async()=>{
      try{
        if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(originalPlain);
        else{
          const area=document.createElement("textarea");
          area.value=originalPlain;area.style.position="fixed";area.style.opacity="0";document.body.append(area);area.select();
          if(!document.execCommand("copy"))throw new Error("copy-failed");
          area.remove()
        }
        setCorrectionStatus("노트 원문 전체를 복사했습니다.")
      }catch(error){
        console.error("모바일 노트 원문 복사 실패",error);
        logDiagnostic("warn","CLIPBOARD","노트 원문 전체 복사에 실패했습니다.",error);
        setCorrectionStatus("전체 복사에 실패했습니다.",true)
      }
    };
    panel.querySelector("[data-note-correction-paste]").onclick=async()=>{
      try{
        let value="";
        if(navigator.clipboard?.readText)value=await navigator.clipboard.readText();
        else{
          correction.focus();
          if(!document.execCommand("paste"))throw new Error("paste-unavailable");
          value=correction.value
        }
        correction.value=String(value||"").replace(/\r/g,"");
        correction.focus();
        setCorrectionStatus(value?"클립보드의 교정문 전체를 붙여넣었습니다.":"클립보드가 비어 있습니다.",!value)
      }catch(error){
        console.error("모바일 노트 교정문 붙여넣기 실패",error);
        logDiagnostic("warn","CLIPBOARD","교정문 전체 붙여넣기에 실패했습니다.",error);
        correction.focus();
        setCorrectionStatus("자동 붙여넣기를 사용할 수 없습니다. 입력칸을 길게 눌러 직접 붙여넣어 주세요.",true)
      }
    };
    panel.querySelector("[data-note-correction-apply]").onclick=async()=>{
      if(activeDocumentType!=="note"||String(activeDocumentId)!==noteId){
        setCorrectionStatus("교정할 노트가 현재 열려 있지 않습니다.",true);
        return
      }
      const currentHtml=noteHtmlForStorage();
      if(currentHtml!==originalHtml){
        setCorrectionStatus("도우미를 연 뒤 노트 내용이 변경되었습니다. 닫고 다시 시작해 주세요.",true);
        return
      }
      const corrected=String(correction.value||"").replace(/\r/g,"").replace(/\n+$/,"");
      if(!corrected.trim()){
        correction.focus();
        setCorrectionStatus("교정된 글 전체를 붙여넣어 주세요.",true);
        return
      }
      if(corrected===originalPlain){
        setCorrectionStatus("변경된 내용이 없습니다.");
        return
      }
      try{
        const nextHtml=sanitizedNoteHtml(applyMobileNoteCorrectionTextDiff(originalHtml,originalPlain,corrected));
        noteReaderContent.innerHTML=nextHtml;
        noteSavedRange=null;
        scheduleMobileNoteSave();
        await flushMobileNoteSave();
        const state=snapshot(),note=(state.notes||[]).find(item=>String(item?.id||"")===noteId);
        if(note)hydrateNoteImages(note).catch(error=>logDiagnostic("warn","ASSET","노트 이미지를 표시하지 못했습니다.",error));
        updateMobileNoteCharacterCount();
        closeMobileNoteCorrection()
      }catch(error){
        console.error("모바일 노트 교정문 반영 실패",error);
        logDiagnostic("error","NOTE","교정문 변경사항을 노트에 반영하지 못했습니다.",error);
        setCorrectionStatus("문단 구조가 바뀌어 기존 서식을 안전하게 유지할 수 없습니다.",true)
      }
    };
    if(!originalPlain.trim())setCorrectionStatus("교정할 노트 내용이 없습니다.",true);
    refreshLucideIcons()
  }

  const MOBILE_NOTE_FONT_PRETENDARD="Pretendard";
  const MOBILE_NOTE_FONT_SERIF="Source Han Serif KR";
  const MOBILE_NOTE_FONT_SYSTEM="system-ui";

  function normalizeMobileNoteFont(value){
    const font=String(value||"__default__").trim()||"__default__",normalized=font.replace(/["']/g,"").toLowerCase();
    if(normalized==="sans-serif")return MOBILE_NOTE_FONT_PRETENDARD;
    if(normalized==="serif")return MOBILE_NOTE_FONT_SERIF;
    if(normalized==="monospace")return MOBILE_NOTE_FONT_SYSTEM;
    return font
  }

  function applyMobileNoteDefaultStyle(note){
    if(!noteReaderContent)return;
    const style=note?.defaultStyle&&typeof note.defaultStyle==="object"?note.defaultStyle:{};
    const font=normalizeMobileNoteFont(style.fontFamily);
    noteReaderContent.style.fontFamily=font==="__default__"||font===MOBILE_NOTE_FONT_SYSTEM?"":font;
    noteReaderContent.style.textAlign=["left","center","right","justify"].includes(style.textAlign)?style.textAlign:"left";
    noteReaderContent.style.setProperty("--note-first-line-indent",style.firstLineIndent===true?"1em":"0");
    noteReaderContent.style.setProperty("--note-paragraph-spacing",style.paragraphSpacing===true?"1.6em":".25em")
  }

  function closeMobileNoteMenu(){
    if(!noteMoreMenu||!noteMoreButton)return;
    noteMoreMenu.hidden=true;
    noteMoreButton.setAttribute("aria-expanded","false")
  }

  function syncMobileNoteMenu(){
    if(noteHtmlMenuLabel)noteHtmlMenuLabel.textContent=noteEditorMode==="html"?"기본 편집으로 돌아가기":"HTML로 편집";
    updateMobileNoteCharacterCount()
  }

  function closeMobileNoteToolSheet(){
    document.querySelector("[data-note-tool-sheet]")?.remove()
  }

  function openMobileNoteToolSheet(){
    closeMobileNoteToolSheet();
    const wrap=element("div","nav-sheet-backdrop note-tool-sheet-backdrop"),panel=element("section","nav-sheet note-tool-sheet-panel");
    wrap.dataset.noteToolSheet="style";
    panel.setAttribute("role","dialog");
    panel.setAttribute("aria-modal","true");
    const head=element("div","note-tool-sheet-head"),heading=element("h3","","기본 스타일"),close=element("button","sheet-close");
    close.type="button";close.setAttribute("aria-label","닫기");close.innerHTML='<i data-lucide="x" aria-hidden="true"></i>';head.append(heading,close);
    const body=element("div","note-tool-sheet-body");
      const current=(()=>{
        const state=snapshot(),note=(state.notes||[]).find(item=>String(item?.id||"")===String(activeDocumentId||"")),style=note?.defaultStyle&&typeof note.defaultStyle==="object"?note.defaultStyle:{};
        return {font:String(style.fontFamily||"__default__").trim()||"__default__",align:["left","center","right","justify"].includes(style.textAlign)?style.textAlign:"left",indent:style.firstLineIndent===true,spacing:style.paragraphSpacing===true}
      })();
      current.font=normalizeMobileNoteFont(current.font);
      if(current.font===MOBILE_NOTE_FONT_PRETENDARD||current.font===MOBILE_NOTE_FONT_SYSTEM)current.font="__default__";
      const standard=new Set(["__default__",MOBILE_NOTE_FONT_SERIF]),extra=standard.has(current.font)?"":'<option value="'+esc(current.font)+'">현재 설정 · '+esc(current.font)+'</option>';
      body.innerHTML='<label class="note-style-row"><span>글꼴</span><select data-note-default-font><option value="__default__">프리텐다드</option><option value="Source Han Serif KR">본명조</option>'+extra+'</select></label>'+
        '<div class="note-style-row"><span>글 정렬</span><div class="note-style-align" data-note-default-align><button type="button" value="left" aria-label="왼쪽 정렬"><i data-lucide="align-left"></i></button><button type="button" value="center" aria-label="가운데 정렬"><i data-lucide="align-center"></i></button><button type="button" value="right" aria-label="오른쪽 정렬"><i data-lucide="align-right"></i></button><button type="button" value="justify" aria-label="양쪽 정렬"><i data-lucide="align-justify"></i></button></div></div>'+
        '<label class="note-style-row"><span>들여쓰기</span><select data-note-default-indent><option value="off">사용 안 함</option><option value="on">사용함</option></select></label>'+
        '<label class="note-style-row"><span>문단 사이 여백 주기</span><select data-note-default-spacing><option value="off">사용 안 함</option><option value="on">사용함</option></select></label>'+
        '<div class="note-sheet-actions"><button type="button" class="secondary" data-note-sheet-close>취소</button><button type="button" class="primary" data-note-style-save>저장</button></div>';
      const font=body.querySelector("[data-note-default-font]"),indent=body.querySelector("[data-note-default-indent]"),spacing=body.querySelector("[data-note-default-spacing]"),align=body.querySelector("[data-note-default-align]");
      font.value=current.font;indent.value=current.indent?"on":"off";spacing.value=current.spacing?"on":"off";
      let alignValue=current.align;
      const syncAlign=()=>align.querySelectorAll("button").forEach(button=>button.classList.toggle("active",button.value===alignValue));
      align.querySelectorAll("button").forEach(button=>button.onclick=()=>{alignValue=button.value;syncAlign()});syncAlign();
      body.querySelector("[data-note-style-save]").onclick=async()=>{
        const state=snapshot(),note=(state.notes||[]).find(item=>String(item?.id||"")===String(activeDocumentId||""));
        if(!note){closeMobileNoteToolSheet();return}
        note.defaultStyle={fontFamily:String(font.value||"__default__"),textAlign:alignValue,firstLineIndent:indent.value==="on",paragraphSpacing:spacing.value==="on"};
        note.updatedAt=new Date().toISOString();
        try{
          await repository.replaceState(state);
          if(activeDocumentType==="note"&&String(activeDocumentId)===String(note.id))applyMobileNoteDefaultStyle(note);
          closeMobileNoteToolSheet()
        }catch(error){
          console.error("모바일 노트 기본 스타일 저장 실패",error);
          logDiagnostic("error","REPOSITORY","노트 기본 스타일 저장에 실패했습니다.",error)
        }
      }
    panel.append(head,body);wrap.append(panel);document.body.append(wrap);
    close.onclick=closeMobileNoteToolSheet;
    body.querySelectorAll("[data-note-sheet-close]").forEach(button=>button.onclick=closeMobileNoteToolSheet);
    wrap.onclick=event=>{if(event.target===wrap)closeMobileNoteToolSheet()};
    refreshLucideIcons()
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
    // Read the saved range before focusing: the focus listener re-captures whatever caret the browser picks.
    let range=noteSavedRange&&editor.contains(noteSavedRange.commonAncestorContainer)?noteSavedRange.cloneRange():null;
    editor.focus({preventScroll:true});
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

  function scheduleMobileNoteHtmlSave(){
    if(activeDocumentType!=="note"||!activeDocumentId||!noteHtmlEditor)return;
    pendingNoteHtmlSave={noteId:String(activeDocumentId),source:String(noteHtmlEditor.value||"")};
    noteHtmlDirty=true;
    if(noteHtmlStatus)noteHtmlStatus.textContent="자동 저장 중…";
    if(noteHtmlSaveTimer)clearTimeout(noteHtmlSaveTimer);
    noteHtmlSaveTimer=setTimeout(()=>{noteHtmlSaveTimer=0;flushMobileNoteHtmlSave()},450)
  }

  function flushMobileNoteHtmlSave(){
    if(noteHtmlSaveTimer){clearTimeout(noteHtmlSaveTimer);noteHtmlSaveTimer=0}
    const payload=pendingNoteHtmlSave;
    pendingNoteHtmlSave=null;
    if(!payload)return noteSaveChain;
    const content=sanitizedNoteHtml(payload.source);
    noteSaveChain=noteSaveChain.then(async()=>{
      const state=snapshot(),note=(state.notes||[]).find(item=>String(item?.id||"")===payload.noteId);
      if(!note)return;
      if(String(note.content||"")!==content){
        note.content=content;
        note.updatedAt=new Date().toISOString();
        await repository.replaceState(state);
        if(!libraryScreen.hidden)renderLibrary()
      }
      if(activeDocumentType==="note"&&String(activeDocumentId)===payload.noteId&&noteEditorMode==="html"){
        noteHtmlDirty=false;
        if(noteHtmlStatus)noteHtmlStatus.textContent="자동 저장됨"
      }
    }).catch(error=>{
      if(!pendingNoteHtmlSave)pendingNoteHtmlSave=payload;
      noteHtmlDirty=true;
      if(noteHtmlStatus)noteHtmlStatus.textContent="저장 실패";
      console.error("모바일 노트 HTML 저장 실패",error);
      logDiagnostic("error","REPOSITORY","노트 HTML 저장에 실패했습니다.",error)
    });
    return noteSaveChain
  }

  async function setMobileNoteEditorMode(mode){
    const next=mode==="html"?"html":"rich";
    if(activeDocumentType!=="note"||noteEditorMode===next)return;
    closeMobileNoteMenu();
    if(next==="html"){
      const source=noteHtmlForStorage();
      await flushMobileNoteSave();
      noteEditorMode="html";
      noteHtmlDirty=false;
      noteHtmlEditor.value=formatMobileNoteHtmlSource(source);
      noteReaderContent.hidden=true;
      noteHtmlShell.hidden=false;
      document.body.classList.add("note-html-mode");
      if(noteHtmlStatus)noteHtmlStatus.textContent="자동 저장됨";
      syncMobileNoteMenu();
      requestAnimationFrame(()=>noteHtmlEditor.focus({preventScroll:true}))
    }else{
      pendingNoteHtmlSave={noteId:String(activeDocumentId),source:String(noteHtmlEditor.value||"")};
      await flushMobileNoteHtmlSave();
      const state=snapshot(),note=(state.notes||[]).find(item=>String(item?.id||"")===String(activeDocumentId||""));
      noteEditorMode="rich";
      noteHtmlDirty=false;
      noteHtmlShell.hidden=true;
      noteReaderContent.hidden=false;
      document.body.classList.remove("note-html-mode");
      noteReaderContent.innerHTML=sanitizedNoteHtml(note?.content||"");
      if(note){applyMobileNoteDefaultStyle(note);hydrateNoteImages(note).catch(error=>logDiagnostic("warn","ASSET","노트 이미지를 표시하지 못했습니다.",error))}
      syncMobileNoteMenu();
      requestAnimationFrame(()=>noteReaderContent.focus({preventScroll:true}))
    }
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

  function normalizeMobileNoteLinkUrl(value){
    const raw=String(value||"").trim();
    if(!raw)return "";
    if(/^(https?:|mailto:)/i.test(raw)||raw.startsWith("#"))return /\s/.test(raw)?null:raw;
    if(/^[a-z][a-z0-9+.-]*:/i.test(raw)&&!/^[^:\/]+:\d+(\/|$)/.test(raw))return null;
    if(/\s/.test(raw))return null;
    if(/^[^@\/]+@[^@\/]+\.[^@\/]+$/.test(raw))return "mailto:"+raw;
    return "https://"+raw.replace(/^\/+/,"")
  }

  function closeMobileNoteLinkSheet(){
    document.querySelector("[data-note-link-sheet]")?.remove()
  }

  function insertMobileNoteLink(){
    if(activeDocumentType!=="note")return;
    captureMobileNoteSelection();
    const editor=noteReaderContent,saved=noteSavedRange&&editor.contains(noteSavedRange.commonAncestorContainer)?noteSavedRange.cloneRange():null;
    let node=saved?.commonAncestorContainer||null;
    node=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
    const found=node?.closest?.("a"),anchor=found&&found!==editor&&editor.contains(found)?found:null;
    const selectedText=saved&&!saved.collapsed?saved.toString().trim():"",needsText=!anchor&&!selectedText;
    const title=anchor?"링크 편집":"링크 삽입";
    closeMobileNoteLinkSheet();
    const wrap=element("div","nav-sheet-backdrop note-tool-sheet-backdrop"),panel=element("section","nav-sheet note-tool-sheet-panel");
    wrap.dataset.noteLinkSheet="1";
    panel.setAttribute("role","dialog");
    panel.setAttribute("aria-modal","true");
    panel.setAttribute("aria-label",title);
    const head=element("div","note-tool-sheet-head"),close=element("button","sheet-close");
    close.type="button";
    close.setAttribute("aria-label","닫기");
    close.innerHTML='<i data-lucide="x" aria-hidden="true"></i>';
    head.append(element("h3","",title),close);
    const body=element("div","note-tool-sheet-body");
    const urlField=element("label","create-field"),urlInput=element("input");
    urlInput.type="url";
    urlInput.inputMode="url";
    urlInput.autocomplete="off";
    urlInput.spellcheck=false;
    urlInput.placeholder="https://example.com";
    urlInput.value=anchor?.getAttribute("href")||"";
    urlField.append(element("span","","주소"),urlInput);
    body.append(urlField);
    let textInput=null;
    if(needsText){
      const textField=element("label","create-field"),label=element("span","","표시할 텍스트 ");
      label.append(element("small","","· 선택"));
      textInput=element("input");
      textInput.type="text";
      textInput.autocomplete="off";
      textInput.placeholder="비워두면 주소를 그대로 표시합니다";
      textField.append(label,textInput);
      body.append(textField)
    }else if(selectedText){
      body.append(element("p","note-link-target","선택한 “"+selectedText.slice(0,60)+(selectedText.length>60?"…":"")+"”에 링크를 겁니다."))
    }
    const error=element("p","note-correction-status error");
    error.hidden=true;
    error.setAttribute("role","alert");
    body.append(error);
    const actions=element("div","mobile-confirm-actions note-link-actions"+(anchor?" has-remove":""));
    let removeButton=null;
    if(anchor){
      removeButton=element("button","create-delete","링크 해제");
      removeButton.type="button";
      actions.append(removeButton)
    }
    const cancel=element("button","mobile-confirm-cancel","취소"),submitButton=element("button","mobile-confirm-submit",anchor?"저장":"삽입");
    cancel.type="button";
    submitButton.type="button";
    actions.append(cancel,submitButton);
    panel.append(head,body,actions);
    wrap.append(panel);
    document.body.append(wrap);
    refreshLucideIcons();
    const showError=message=>{error.textContent=message;error.hidden=!message};
    const backToEditor=()=>{
      closeMobileNoteLinkSheet();
      if(saved&&saved.startContainer.isConnected&&editor.contains(saved.commonAncestorContainer))noteSavedRange=saved.cloneRange();
      restoreMobileNoteSelection()
    };
    const finish=()=>{
      captureMobileNoteSelection();
      scheduleMobileNoteSave();
      updateMobileNoteFormatState();
      updateMobileNoteCharacterCount()
    };
    const submit=()=>{
      const url=normalizeMobileNoteLinkUrl(urlInput.value);
      if(url===""){showError("연결할 주소를 입력하세요.");urlInput.focus();return}
      if(url===null){showError("http, https, 메일 주소만 연결할 수 있습니다.");urlInput.focus();return}
      const label=String(textInput?.value||"").trim();
      backToEditor();
      if(anchor&&anchor.isConnected){anchor.setAttribute("href",url);finish();return}
      if(needsText){
        const selection=window.getSelection();
        if(!selection?.rangeCount)return;
        const range=selection.getRangeAt(0),text=document.createTextNode(label||url.replace(/^mailto:/i,""));
        range.deleteContents();
        range.insertNode(text);
        const target=document.createRange();
        target.selectNodeContents(text);
        noteSavedRange=target.cloneRange();
        execMobileNoteCommand("createLink",url);
        const after=window.getSelection();
        if(after?.rangeCount)after.collapseToEnd()
      }else execMobileNoteCommand("createLink",url);
      finish()
    };
    const remove=()=>{
      backToEditor();
      if(!anchor?.isConnected)return;
      const first=anchor.firstChild,last=anchor.lastChild;
      anchor.replaceWith(...anchor.childNodes);
      if(first&&last&&first.isConnected){
        const range=document.createRange();
        range.setStartBefore(first);
        range.setEndAfter(last);
        noteSavedRange=range.cloneRange();
        restoreMobileNoteSelection()
      }
      finish()
    };
    submitButton.onclick=submit;
    cancel.onclick=backToEditor;
    close.onclick=backToEditor;
    if(removeButton)removeButton.onclick=remove;
    wrap.onclick=event=>{if(event.target===wrap)backToEditor()};
    [urlInput,textInput].filter(Boolean).forEach(input=>{
      input.addEventListener("input",()=>showError(""));
      input.addEventListener("keydown",event=>{
        if(event.isComposing)return;
        if(event.key==="Enter"){event.preventDefault();if(input===urlInput&&textInput&&!textInput.value)textInput.focus();else submit()}
        else if(event.key==="Escape"){event.preventDefault();backToEditor()}
      })
    });
    requestAnimationFrame(()=>urlInput.focus())
  }

  function insertMobileNoteDivider(style="solid"){
    const editor=noteReaderContent,range=restoreMobileNoteSelection();
    if(!range)return;
    const divider=["solid","dotted","dashed","double"].includes(style)?style:"solid",selection=window.getSelection();
    range.deleteContents();
    let node=range.startContainer;
    node=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;
    let block=node?.closest?.("p,div,h1,h2,h3,blockquote,li");
    if(block===editor&&range.startContainer?.nodeType===Node.TEXT_NODE&&range.startContainer.parentNode===editor){
      const paragraph=document.createElement("p");
      editor.insertBefore(paragraph,range.startContainer);
      paragraph.appendChild(range.startContainer);
      block=paragraph
    }
    const hr=document.createElement("hr");
    hr.dataset.divider=divider;
    let next=document.createElement("p");
    next.appendChild(document.createElement("br"));
    if(block&&block!==editor&&editor.contains(block)){
      if(block.tagName==="LI"){
        const list=block.closest("ul,ol");
        (list||block).after(hr,next)
      }else{
        const tail=document.createRange();
        tail.setStart(range.startContainer,range.startOffset);
        tail.setEnd(block,block.childNodes.length);
        const fragment=tail.extractContents(),after=block.cloneNode(false);
        if(fragment.childNodes.length)after.append(fragment);else after.appendChild(document.createElement("br"));
        if(!block.childNodes.length)block.appendChild(document.createElement("br"));
        block.after(hr,after);
        next=after
      }
    }else{
      range.insertNode(hr);
      hr.after(next)
    }
    const caret=document.createRange();
    caret.selectNodeContents(next);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    noteSavedRange=caret.cloneRange();
    scheduleMobileNoteSave();
    updateMobileNoteFormatState();
    updateMobileNoteCharacterCount()
  }

  function mobileNoteQuoteStyleOf(quote){
    const value=String(quote?.dataset?.quote||"");
    return ["line","box","mark","pull"].includes(value)?value:"line"
  }

  function mobileNoteQuotesInRange(range){
    const editor=noteReaderContent;
    if(!range)return [];
    const found=new Set(),add=node=>{
      const el=(node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement)?.closest?.("blockquote");
      if(el&&el!==editor&&editor.contains(el))found.add(el)
    };
    add(range.startContainer);
    add(range.endContainer);
    if(!range.collapsed)editor.querySelectorAll("blockquote").forEach(quote=>{try{if(range.intersectsNode(quote))found.add(quote)}catch{}});
    return [...found].filter(quote=>![...found].some(other=>other!==quote&&other.contains(quote)))
  }

  function unwrapMobileNoteQuote(quote){
    if(!quote?.parentNode)return;
    const style=quote.getAttribute("style")||"",nodes=[];
    const isBlock=node=>node.nodeType===Node.ELEMENT_NODE&&/^(P|DIV|H1|H2|H3|UL|OL|PRE|BLOCKQUOTE|DETAILS|HR)$/.test(node.tagName);
    let run=null;
    [...quote.childNodes].forEach(child=>{
      if(isBlock(child)){run=null;nodes.push(child);return}
      if(!run){
        if(child.nodeType===Node.TEXT_NODE&&!String(child.nodeValue||"").trim())return;
        run=document.createElement("p");
        if(style)run.setAttribute("style",style);
        nodes.push(run)
      }
      run.appendChild(child)
    });
    if(!nodes.length){
      const empty=document.createElement("p");
      empty.appendChild(document.createElement("br"));
      nodes.push(empty)
    }
    quote.replaceWith(...nodes)
  }

  function applyMobileNoteQuoteStyle(style="line"){
    if(activeDocumentType!=="note")return;
    const editor=noteReaderContent,range=restoreMobileNoteSelection();
    if(!range||!editor.contains(range.commonAncestorContainer))return;
    const target=style==="none"?"none":["line","box","mark","pull"].includes(style)?style:"line",selection=window.getSelection();
    let quotes=mobileNoteQuotesInRange(range);
    if(target==="none"){
      if(!quotes.length)return;
      const mark={startNode:range.startContainer,startOffset:range.startOffset,endNode:range.endContainer,endOffset:range.endOffset};
      quotes.forEach(unwrapMobileNoteQuote);
      if(mark.startNode.isConnected&&mark.endNode.isConnected&&editor.contains(mark.startNode)){
        try{
          const restored=document.createRange();
          restored.setStart(mark.startNode,mark.startOffset);
          restored.setEnd(mark.endNode,mark.endOffset);
          selection.removeAllRanges();
          selection.addRange(restored)
        }catch{}
      }
    }else{
      if(!quotes.length){
        execMobileNoteCommand("formatBlock","blockquote");
        quotes=selection?.rangeCount?mobileNoteQuotesInRange(selection.getRangeAt(0)):[]
      }
      quotes.forEach(quote=>{
        if(target==="line")quote.removeAttribute("data-quote");
        else quote.dataset.quote=target
      })
    }
    captureMobileNoteSelection();
    scheduleMobileNoteSave();
    updateMobileNoteFormatState();
    updateMobileNoteCharacterCount()
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
    if(noteKeyboardSuppressed){
      captureMobileNoteSelection();
      if(document.activeElement===noteReaderContent)noteReaderContent.blur();
      setMobileNoteKeyboardSuppressed(false)
    }
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
      '<label class="note-format-select"><i data-lucide="type"></i><span>글꼴</span><select data-note-font><option value="Pretendard">프리텐다드</option><option value="Source Han Serif KR">본명조</option></select></label>'+
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
      '</div><div class="note-format-panel-title note-format-subtitle">인용문</div><div class="note-format-grid note-quote-grid">'+
      '<button type="button" class="note-format-action" data-note-quote="line"><span class="note-quote-preview line"></span><span>기본 선</span></button>'+
      '<button type="button" class="note-format-action" data-note-quote="box"><span class="note-quote-preview box"></span><span>박스</span></button>'+
      '<button type="button" class="note-format-action" data-note-quote="mark"><span class="note-quote-preview mark"></span><span>따옴표</span></button>'+
      '<button type="button" class="note-format-action" data-note-quote="pull"><span class="note-quote-preview pull"></span><span>강조</span></button>'+
      '<button type="button" class="note-format-action" data-note-quote="none"><i data-lucide="remove-formatting"></i><span>해제</span></button>'+
      '</div><div class="note-line-height-row"><span><i data-lucide="list-chevrons-up-down"></i>행간</span>'+
      '<button type="button" data-note-line-height="1">100%</button><button type="button" data-note-line-height="1.4">140%</button><button type="button" data-note-line-height="1.6">160%</button><button type="button" data-note-line-height="1.8">180%</button><button type="button" data-note-line-height="2">200%</button></div>';
    return '<div class="note-format-panel-title">삽입</div><div class="note-format-grid">'+
      '<button type="button" class="note-format-action" data-note-insert="link"><i data-lucide="link"></i><span>링크</span></button>'+
      '<button type="button" class="note-format-action" data-note-insert="image" disabled aria-disabled="true" title="모바일 이미지 저장 연결 후 지원"><i data-lucide="image-plus"></i><span>이미지</span></button>'+
      '<button type="button" class="note-format-action" data-note-insert="fold"><i data-lucide="fold-vertical"></i><span>접기</span></button>'+
      '<button type="button" class="note-format-action" data-note-insert="divider" data-note-divider="solid"><span class="note-divider-preview"></span><span>실선</span></button>'+
      '<button type="button" class="note-format-action" data-note-insert="divider" data-note-divider="dotted"><span class="note-divider-preview dotted"></span><span>점선</span></button>'+
      '<button type="button" class="note-format-action" data-note-insert="divider" data-note-divider="dashed"><span class="note-divider-preview dashed"></span><span>파선</span></button>'+
      '<button type="button" class="note-format-action" data-note-insert="divider" data-note-divider="double"><span class="note-divider-preview double"></span><span>이중선</span></button>'+
      '</div><p class="note-format-panel-note">이미지는 모바일 Asset 저장 경로를 연결한 뒤 활성화됩니다.</p>'
  }

  function setMobileNoteKeyboardSuppressed(suppressed){
    noteKeyboardSuppressed=!!suppressed;
    if(noteKeyboardSuppressed)noteReaderContent.setAttribute("inputmode","none");
    else noteReaderContent.removeAttribute("inputmode")
  }

  function openMobileNoteFormatPanel(key){
    if(noteFormatPanelKey===key){closeMobileNoteFormatPanel();return}
    captureMobileNoteSelection();
    if(!noteKeyboardSuppressed){
      // Formatting mode: hide the keyboard once, keep the caret/selection without it.
      const hadFocus=document.activeElement===noteReaderContent;
      setMobileNoteKeyboardSuppressed(true);
      if(hadFocus){noteReaderContent.blur();restoreMobileNoteSelection()}
      scheduleNoteViewportSync();
      setTimeout(scheduleNoteViewportSync,120)
    }
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
    const activeQuote=node?.closest?.("blockquote"),activeQuoteStyle=activeQuote&&activeQuote!==noteReaderContent&&noteReaderContent.contains(activeQuote)?mobileNoteQuoteStyleOf(activeQuote):"";
    noteFormatPanel.querySelectorAll("[data-note-quote]").forEach(button=>{
      const value=button.dataset.noteQuote;
      if(value==="none"){button.disabled=!activeQuoteStyle;button.setAttribute("aria-disabled",String(!activeQuoteStyle))}
      else button.classList.toggle("active",value===activeQuoteStyle)
    });
    const lineHeight=String(block?.style?.lineHeight||"1.6");
    noteFormatPanel.querySelectorAll("[data-note-line-height]").forEach(button=>button.classList.toggle("active",button.dataset.noteLineHeight===lineHeight))
  }

  function renderNote(note){
    $("#noteReaderTitle").textContent=note.title||"제목 없는 노트";
    $("#noteReaderSubtitle").textContent=note.subtitle||"";
    $("#noteReaderSubtitle").hidden=!note.subtitle;
    closeMobileNoteFormatPanel();
    closeMobileNoteMenu();
    closeMobileNoteToolSheet();
    closeMobileNoteCorrection();
    noteSavedRange=null;
    noteEditorMode="rich";
    noteHtmlDirty=false;
    document.body.classList.remove("note-html-mode");
    noteReaderContent.hidden=false;
    noteHtmlShell.hidden=true;
    noteReaderContent.dataset.noteId=String(note.id||"");
    noteReaderContent.innerHTML=sanitizedNoteHtml(note.content||"");
    noteHtmlEditor.value=formatMobileNoteHtmlSource(note.content||"");
    applyMobileNoteDefaultStyle(note);
    syncMobileNoteMenu();
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
    activeBlockEditor=null;
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
    activeBlockEditor=null;
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
    const count=(snapshot().trash||[]).length;
    if(menuTrashMeta)menuTrashMeta.textContent=count?"삭제된 항목 "+count+"개":"삭제된 항목이 없습니다.";
    showScreen(menuScreen,{heading:"메뉴",back:false,account:false,nav:"menu"})
  }

  function openMenu({replace=false}={}){
    renderMenu();
    writeRoute({view:"menu"},{replace})
  }

  function renderMobileTrash(){
    const items=Array.isArray(snapshot().trash)?snapshot().trash:[];
    trashList.replaceChildren();
    trashSubtitle.textContent=items.length?"삭제된 항목 "+items.length+"개":"삭제된 항목이 없습니다.";
    emptyTrashButton.hidden=!items.length;
    if(!items.length){trashList.append(element("div","mobile-trash-empty","휴지통이 비어 있습니다."));return}
    for(const item of items){
      const row=element("article","mobile-trash-item"),copy=element("div","mobile-trash-copy"),actions=element("div","mobile-trash-actions");
      copy.append(element("span","mobile-trash-kind",mobileTrashLabel(item.type)),element("strong","",item.label||"삭제된 항목"));
      const deleted=mobileTrashDate(item.deletedAt);if(deleted)copy.append(element("small","",deleted));
      const restore=element("button","mobile-trash-restore","복구"),remove=element("button","mobile-trash-delete","영구 삭제");
      restore.type="button";remove.type="button";
      restore.onclick=async()=>{restore.disabled=true;const ok=await restoreMobileTrashItem(item.id);if(!ok){restore.disabled=false;await openMobileConfirm({title:"복구할 수 없습니다.",message:"원래 위치가 없거나 모바일에서 지원하지 않는 휴지통 항목입니다.",confirmLabel:"확인",cancelLabel:"닫기"})}renderMobileTrash()};
      remove.onclick=async()=>{
        const confirmed=await openMobileConfirm({title:"영구 삭제하시겠습니까?",message:"이 작업은 되돌릴 수 없습니다.",confirmLabel:"영구 삭제",cancelLabel:"취소",destructive:true});if(!confirmed)return;
        const state=snapshot();state.trash=(state.trash||[]).filter(entry=>String(entry?.id||"")!==String(item.id||""));
        try{await repository.replaceState(state);renderMobileTrash()}catch(error){console.error("모바일 휴지통 영구 삭제 실패",error);logDiagnostic("error","REPOSITORY","휴지통 영구 삭제에 실패했습니다.",error)}
      };
      actions.append(restore,remove);row.append(copy,actions);trashList.append(row)
    }
  }
  function renderTrashScreen(){activeDocumentType="";activeDocumentId="";activeEpisodeId="";showScreen(trashScreen,{heading:"휴지통",back:true,account:false,nav:"menu"});renderMobileTrash()}
  function openTrash({replace=false}={}){renderTrashScreen();writeRoute({view:"trash"},{replace})}

  function renderSettingsScreen(section="display"){
    activeDocumentType="";
    activeDocumentId="";
    activeEpisodeId="";
    const target=section==="info"?"info":"display";
    displaySettingsSection.hidden=target!=="display";
    infoSettingsSection.hidden=target!=="info";
    showScreen(settingsScreen,{heading:target==="info"?"앱 정보":"디스플레이",back:true,account:false,nav:"menu"});
    renderSettings();
    renderInstallAction()
  }

  function openSettings(section="display",{replace=false}={}){
    const target=section==="info"?"info":"display";
    renderSettingsScreen(target);
    writeRoute({view:"settings",section:target},{replace})
  }

  // ---- two-way cloud sync -------------------------------------------------------------
  // The engine (mobile-sync-engine.js) owns pull/merge/push. This block connects it to the UI:
  // write guard, read-only banner, return gate, lifecycle events and the cloud screen.
  let mobileReturnGateActive=false,mobileReturnRun=0,mobileHiddenAt=0,syncToastTimer=0,syncNoticeAt=0,assetRefreshTimer=0;
  const MOBILE_SHORT_AWAY_MS=3000;

  function mobileDeviceName(){const ua=String(navigator.userAgent||"");return /iPhone/.test(ua)?"iPhone":/iPad/.test(ua)?"iPad":/Android/.test(ua)?"Android":"모바일"}
  function hasPendingMobileSaves(){return !!(noteSaveTimer||pendingNoteSave||noteHtmlSaveTimer||pendingNoteHtmlSave||blockSaveTimer)}
  async function flushPendingMobileSaves({strict=false}={}){
    const blockSaved=blockSaveTimer?await flushMobileGeneralBlockSave():true;
    flushMobileNoteSave();flushMobileNoteHtmlSave();
    await noteSaveChain.catch(()=>{});
    const lastBlockSaved=await blockSaveChain.catch(()=>false);
    if(strict&&(pendingNoteSave||pendingNoteHtmlSave||blockSaved===false||lastBlockSaved===false))throw new Error("mobile-pending-save-failed")
  }
  function remoteDeviceText(remote){return `${syncCoordination.deviceLabel(remote,mobileDeviceName())}에서 수정 중입니다`}
  function showSyncToast(message){
    let toast=document.getElementById("mobileSyncToast");
    if(!toast){toast=element("div","mobile-sync-toast");toast.id="mobileSyncToast";toast.setAttribute("role","status");toast.setAttribute("aria-live","polite");document.body.append(toast)}
    toast.textContent=String(message||"");toast.classList.add("visible");
    clearTimeout(syncToastTimer);syncToastTimer=setTimeout(()=>toast.classList.remove("visible"),3200)
  }
  function noticeReadonly(){
    if(Date.now()-syncNoticeAt<2500)return;syncNoticeAt=Date.now();
    const remote=syncEngine?._readonly?.();
    showSyncToast(remote?`${remoteDeviceText(remote)}. 반영될 때까지 읽기 전용입니다.`:"최신 내용을 확인하는 중입니다.")
  }
  function renderSyncReadonly(remote){
    let banner=document.getElementById("mobileSyncReadonly");
    document.body.classList.toggle("sync-remote-readonly",!!remote);
    if(!remote){banner?.remove();return}
    if(!banner){banner=element("div","mobile-sync-readonly");banner.id="mobileSyncReadonly";banner.setAttribute("role","status");document.body.append(banner)}
    banner.textContent=`${syncCoordination.deviceLabel(remote,mobileDeviceName())} 수정 중 · 읽기 전용`
  }
  function rerenderCurrentView(changedKeys=null){
    try{
      if(!libraryScreen.hidden){renderLibrary();return}
      if(activeBlockEditor)return;
      if(activeDocumentType&&activeDocumentId){
        const key=`${activeDocumentType}:${activeDocumentId}`;
        if(changedKeys&&!changedKeys.has("*")&&!changedKeys.has(key))return;
        renderDocument(activeDocumentType,activeDocumentId);return
      }
      if(!trashScreen.hidden&&typeof renderMobileTrash==="function")renderMobileTrash()
    }catch(error){logDiagnostic("warn","SYNC","동기화 후 화면을 갱신하지 못했습니다.",error)}
  }
  function scheduleSyncAssetRefresh(){
    clearTimeout(assetRefreshTimer);
    assetRefreshTimer=setTimeout(async()=>{
      try{const result=await downloadCurrentSyncAssets({objects:[]},snapshot());if(result.downloaded)rerenderCurrentView(new Set(["*"]))}
      catch(error){logDiagnostic("warn","ASSET","동기화 이미지 확인을 미뤘습니다.",error)}
    },400)
  }

  // Stale-snapshot protection: a UI flow that took snapshot() before a remote apply and writes
  // afterwards would otherwise silently revert the remote change (and push that revert).
  function rebaseStaleWrite(value,generation){
    const before=preApplyStates.get(generation);
    if(generation!==stateGeneration-1||!before)throw new Error("mobile-sync-stale-write");
    const result=syncEngineCore.mergeStates({syncModel,profile:syncModel.CLIENT_PROFILES.mobileCore,base:before,remote:baseRepository.snapshot(),local:value});
    logDiagnostic("info","SYNC",`원격 반영 직후의 저장을 최신 상태 위에 다시 적용했습니다.${result.conflicts.length?` 충돌 ${result.conflicts.length}건을 병합 규칙에 따라 처리했습니다.`:""}`);
    return result.merged
  }
  async function guardedReplaceState(value,options={}){
    if(options?.markBaseline)return baseRepository.replaceState(value,options);
    if(syncEngine?.isReadonly()){noticeReadonly();setTimeout(()=>rerenderCurrentView(new Set(["*"])),0);throw new Error("mobile-sync-readonly")}
    const generation=value&&typeof value==="object"?snapshotGenerations.get(value):undefined;
    let next=value;
    if(generation!==undefined&&generation<stateGeneration){
      try{next=rebaseStaleWrite(value,generation)}
      catch(error){showSyncToast("다른 기기의 변경사항이 방금 반영되었습니다. 다시 한 번 저장해 주세요.");setTimeout(()=>rerenderCurrentView(new Set(["*"])),0);throw error}
    }
    const result=await baseRepository.replaceState(next,options);
    syncEngine?.notifyLocalWrite();
    return result
  }
  async function engineWriteLocal(next,info={}){
    preApplyStates.set(stateGeneration,baseRepository.snapshot());
    for(const key of [...preApplyStates.keys()])if(key<stateGeneration-1)preApplyStates.delete(key);
    stateGeneration++;
    await baseRepository.replaceState(next);
    applyMobileTheme();renderAccountButton();
    rerenderCurrentView(info.remoteApplied instanceof Set?info.remoteApplied:new Set(["*"]));
    scheduleSyncAssetRefresh()
  }

  function showMobileReturnGate({waiting=null,message=""}={}){
    mobileReturnGateActive=true;
    let layer=document.getElementById("mobileSyncGate");
    if(!layer){
      releaseMobileInputFocus();
      layer=element("div","mobile-sync-gate");layer.id="mobileSyncGate";
      layer.innerHTML='<section class="mobile-sync-gate-card" role="status" aria-live="polite"><strong></strong><p></p><div class="mobile-sync-gate-actions"><button type="button" data-sync-gate-retry>다시 확인</button><button type="button" data-sync-gate-skip>로컬에서 편집</button></div></section>';
      document.body.append(layer);
      layer.querySelector("[data-sync-gate-retry]").onclick=()=>runMobileReturnCheck({force:true});
      layer.querySelector("[data-sync-gate-skip]").onclick=()=>{
        mobileReturnRun++;
        if(syncEngine?.isReadonly()){syncEngine.overrideRemote();logDiagnostic("warn","SYNC","다른 기기의 편집을 기다리지 않고 편집을 시작했습니다.");showSyncToast("기다리지 않고 편집합니다. 같은 문서를 고치면 충돌 복사본이 생길 수 있습니다.")}
        else showSyncToast("최신 내용 확인 전에 편집합니다. 같은 문서를 고치면 충돌 복사본이 생길 수 있습니다.");
        hideMobileReturnGate()
      };
      setTimeout(()=>{if(layer.isConnected)layer.classList.add("visible")},350)
    }
    layer.querySelector("strong").textContent=waiting?"다른 기기에서 수정 중":"최신 내용 확인 중";
    layer.querySelector("p").textContent=message||(waiting?`${remoteDeviceText(waiting)}. 변경사항이 올라오면 자동으로 편집할 수 있습니다.`:"다른 기기의 변경사항을 확인하고 있습니다.");
    layer.querySelector("[data-sync-gate-skip]").textContent=waiting?"기다리지 않고 편집":"로컬에서 편집";
    if(waiting||message)layer.classList.add("visible")
  }
  function hideMobileReturnGate(){mobileReturnGateActive=false;document.getElementById("mobileSyncGate")?.remove()}
  async function runMobileReturnCheck({force=false}={}){
    const status=syncEngine?.status();
    if(!status?.linked||status.suspended)return null;
    if(!force&&mobileReturnGateActive)return null;
    const run=++mobileReturnRun;showMobileReturnGate();
    try{
      const result=await syncEngine.checkOnReturn({isCancelled:()=>run!==mobileReturnRun,onWaiting:remote=>{if(run===mobileReturnRun)showMobileReturnGate({waiting:remote})}});
      if(run!==mobileReturnRun||result?.cancelled)return result;
      if(result?.skipped==="offline"||result?.skipped==="disconnected"){hideMobileReturnGate();showSyncToast(result.skipped==="offline"?"오프라인이라 최신 내용을 확인하지 못했습니다.":"클라우드에 로그인되어 있지 않아 최신 내용을 확인하지 못했습니다.");return result}
      if(result?.waitingTimedOut){showMobileReturnGate({message:"다른 기기의 변경사항이 아직 올라오지 않았습니다. 그 기기에서 햄보드를 열어 동기화하거나, 기다리지 않고 편집할 수 있습니다."});return result}
      if(result?.failed||result?.blocked){showMobileReturnGate({message:result?.blocked==="branched-history"?"동기화 기록이 갈라져 있어 PC에서 먼저 정리해야 합니다. 로컬에서 편집할 수 있습니다.":"최신 내용을 확인하지 못했습니다. 다시 확인하거나 로컬에서 편집하세요."});return result}
      hideMobileReturnGate();return result
    }catch(error){
      if(run===mobileReturnRun){logDiagnostic("error","SYNC","최신 내용 확인에 실패했습니다.",error);showMobileReturnGate({message:"최신 내용을 확인하지 못했습니다. 다시 확인하거나 로컬에서 편집하세요."})}
      return null
    }
  }
  function installMobileSyncGuards(){
    if(document.documentElement.dataset.mobileSyncGuards)return;document.documentElement.dataset.mobileSyncGuards="1";
    const editable="input,textarea,[contenteditable='true'],[contenteditable='']";
    for(const type of ["beforeinput","paste","cut","drop"])document.addEventListener(type,event=>{
      if(!(syncEngine?.isReadonly()||mobileReturnGateActive))return;
      const target=event.target;
      if(!target?.closest?.(editable)||target.closest("#mobileSyncGate,#librarySearch"))return;
      event.preventDefault();noticeReadonly()
    },true);
    document.addEventListener("visibilitychange",()=>{
      if(!syncEngine)return;
      if(document.hidden){
        mobileHiddenAt=Date.now();syncEngine.stopPolling();
        flushPendingMobileSaves().then(()=>syncEngine.leave()).catch(error=>logDiagnostic("warn","SYNC","화면 전환 전 업로드를 미뤘습니다.",error))
      }else returnToMobileApp()
    });
    window.addEventListener("pagehide",()=>{if(syncEngine)flushPendingMobileSaves().then(()=>syncEngine.leave()).catch(()=>{})});
    window.addEventListener("pageshow",event=>{if(event.persisted)returnToMobileApp()});
    window.addEventListener("online",()=>{if(syncEngine?.status().linked)syncEngine.sync("online")})
  }
  function returnToMobileApp(){
    if(!syncEngine)return;
    const away=mobileHiddenAt?Date.now()-mobileHiddenAt:Infinity;mobileHiddenAt=0;
    if(away<MOBILE_SHORT_AWAY_MS){syncEngine.startPolling();return}
    runMobileReturnCheck().finally(()=>syncEngine.startPolling({immediate:false}))
  }
  function handleSyncStatus(name,detail){
    if(name==="readonly"){renderSyncReadonly(detail);return}
    if(name==="conflicts"){
      const rows=Array.isArray(detail)?detail:[];if(!rows.length)return;
      const copied=rows.filter(item=>/copy/.test(String(item?.kind||""))).length,merged=rows.filter(item=>["field-merged","initial-merged"].includes(String(item?.kind||""))).length,remoteKept=rows.filter(item=>/remote-kept|local-deleted-remote-modified/.test(String(item?.kind||""))).length,parts=[];
      if(copied)parts.push(`복사본 보존 ${copied}건`);
      if(merged)parts.push(`자동 병합 ${merged}건`);
      if(remoteKept)parts.push(`같은 필드 충돌로 클라우드 값 유지 ${remoteKept}건`);
      showSyncToast(`동기화 충돌 ${rows.length}건: ${parts.join(" · ")||"내용을 확인했습니다."}`);
      logDiagnostic("warn","SYNC",`동기화 충돌 ${rows.length}건: ${parts.join(" · ")||"분류 없음"}`);return
    }
    if(name==="result"&&googleDrive?.status?.().connected&&navigator.onLine!==false){
      const status=syncEngine?.status();
      if(status?.suspended)setIndicator("local","동기화 멈춤");
      else if(detail?.failed||detail?.blocked){setIndicator("error","동기화 보류");if(detail?.error)logDiagnostic("warn","SYNC",`자동 동기화 보류: ${detail.error}`)}
      else if(status?.linked&&(detail?.synced||detail?.skipped==="lease"))setIndicator("connected",detail?.committed?"올림 완료":"동기화됨")
    }
  }
  // Pause auto-sync before a restore/import replaces local state. Returns true only when this call
  // turned an active sync into a paused one, so an aborted restore can undo exactly that pause.
  async function pauseSyncForRestore(reason){
    const status=syncEngine?.status();
    if(!status?.linked||status.suspended)return false;
    await syncEngine.suspend(reason);
    return true
  }
  async function resumeSyncAfterAbortedRestore(reason){
    try{
      await syncEngine.resume(reason);syncEngine.startPolling();
      logDiagnostic("info","SYNC","복원이 적용 전에 중단되어 자동 동기화를 다시 켰습니다.");
      return true
    }catch(error){logDiagnostic("warn","SYNC","중단된 복원 뒤 자동 동기화를 다시 켜지 못했습니다.",error);return false}
  }
  async function startMobileLink(){
    const result=await syncEngine.link({confirm:async info=>{
      let uploadLocalOnly=true,preserveConflicts=true;
      if(info.localOnly){
        const discard=await openMobileConfirm({
          title:"이 기기에만 있는 항목이 있습니다",
          message:`클라우드에 없는 항목 ${info.localOnly}개가 이 기기에 있습니다. PC에도 올릴까요, 아니면 이 기기에서 지울까요?`,
          confirmLabel:"이 기기에서 지우기",cancelLabel:"PC에도 올리기",destructive:true
        });
        uploadLocalOnly=!discard
      }
      if(info.copies){
        const overwrite=await openMobileConfirm({
          title:"양쪽 내용이 다른 항목이 있습니다",
          message:`같은 항목 ${info.copies}개가 이 기기와 클라우드에서 서로 다릅니다. 이 기기 내용을 충돌 복사본으로 보존할까요, 아니면 클라우드 기준으로 덮어쓸까요?`,
          confirmLabel:"클라우드 기준으로 덮어쓰기",cancelLabel:"복사본으로 보존",destructive:true
        });
        preserveConflicts=!overwrite
      }
      return {uploadLocalOnly,preserveConflicts}
    }});
    if(result?.cancelled)return result;
    syncEngine.startPolling({immediate:false});
    logDiagnostic("info","SYNC",`자동 동기화를 시작했습니다. 이 기기에만 있던 항목 ${result.localOnly||0}개 · ${result.uploadedLocalOnly?"업로드":"삭제"} · 충돌 복사본 ${result.conflictCopies||0}개`);
    // Folders that differed follow the cloud; keep the phone's previous names findable.
    const folders=Array.isArray(result.foldersFollowedCloud)?result.foldersFollowedCloud:[];
    const renamed=folders.filter(item=>item.localName&&item.localName!==item.cloudName);
    for(const item of renamed)logDiagnostic("info","SYNC",`폴더 이름을 클라우드 기준으로 맞췄습니다: 이 기기 '${item.localName}' → 클라우드 '${item.cloudName}'`);
    if(folders.length>renamed.length)logDiagnostic("info","SYNC",`이름 외 설정이 달랐던 폴더 ${folders.length-renamed.length}개를 클라우드 기준으로 맞췄습니다.`);
    // link() returns the first sync's result: only claim success when that sync actually finished.
    const finished=result?.synced===true,pendingUpload=!!syncEngine.status().dirty;
    if(!finished)logDiagnostic("warn","SYNC",`자동 동기화를 연결했지만 첫 동기화를 마치지 못했습니다: ${result?.error||result?.blocked||result?.skipped||result?.deferred||"unknown"}`);
    const folderNote=renamed.length?` 이름이 달랐던 폴더 ${renamed.length}개는 클라우드 이름을 따랐고, 이 기기의 이전 이름은 진단 기록에 남겼습니다.`:"";
    const message=finished?`자동 동기화를 시작했습니다.${folderNote}`:pendingUpload?`자동 동기화를 연결했지만 이 기기의 변경사항을 아직 올리지 못했습니다. 자동으로 다시 시도합니다.${folderNote}`:`자동 동기화를 연결했지만 최신 상태 확인을 마치지 못했습니다. 자동으로 다시 시도합니다.${folderNote}`;
    showSyncToast(message);
    result.linkMessage=message;
    return result
  }
  async function maybeStartMobileLink(){
    const connection=await restoreGoogleConnection();
    if(!connection?.connected||syncEngine?.status().linked)return;
    if(documentCount()===0&&!(snapshot().folders||[]).length){try{await startMobileLink()}catch(error){logDiagnostic("warn","SYNC","자동 동기화 연결을 미뤘습니다.",error)}return}
    setStatus("이 기기의 문서를 클라우드와 자동으로 동기화하려면 연결을 시작하세요.",{action:"자동 동기화 시작",run:()=>openCloudSources("library")})
  }
  function consumeMobileAuthResult(){
    try{
      const url=new URL(location.href),value=String(url.searchParams.get("auth")||"");
      if(!value)return "";
      url.searchParams.delete("auth");
      history.replaceState(history.state,"",url.pathname+url.search+url.hash);
      return value
    }catch{return ""}
  }

  async function askMobileSyncImportAfterConnect(){
    const connection=await restoreGoogleConnection();
    if(!connection?.connected||syncEngine?.status().linked){maybeStartMobileLink();return}
    let head=null;
    try{
      const fast=googleDrive.listSyncRestoreSource?await googleDrive.listSyncRestoreSource():null,listing=fast||await googleDrive.listSyncObjects();
      if(listing?.truncated)throw new Error("sync-object-list-truncated");
      head=listing?.fast===true?listing.head:requireCloudCommitTopology(listing?.objects||[]).head
    }catch(error){
      logDiagnostic("warn","SYNC","계정 연결 직후 동기화 데이터를 확인하지 못했습니다.",error);
      maybeStartMobileLink();
      return
    }
    if(!head){
      showSyncToast("계정을 연결했습니다. 클라우드에 저장된 동기화 데이터는 아직 없습니다.");
      maybeStartMobileLink();
      return
    }
    const localCount=documentCount();
    const confirmed=await openMobileConfirm({
      title:"기존 동기화 데이터를 불러오시겠습니까?",
      message:`Google Drive에 햄보드 동기화 데이터가 있습니다(최근 동기화 · ${formatCloudTime(head.createdAtMs)}). 불러오면 이 기기와 자동 동기화를 시작합니다.${localCount?" 이 기기에만 있는 문서는 다음 단계에서 처리 방법을 고를 수 있습니다.":""}`,
      confirmLabel:"불러오기",cancelLabel:"나중에"
    });
    if(!confirmed){
      setStatus("클라우드의 동기화 데이터를 아직 불러오지 않았습니다.",{action:"자동 동기화 시작",run:()=>openCloudSources("library")});
      return
    }
    showSyncToast("클라우드 데이터를 불러오는 중입니다.");
    try{
      const result=await startMobileLink();
      if(!result?.cancelled)renderHome()
    }catch(error){
      console.error("계정 연결 직후 동기화 불러오기 실패",error);
      logDiagnostic("error","SYNC","계정 연결 직후 동기화 데이터를 불러오지 못했습니다.",error);
      setStatus(cloudErrorMessage(error),{action:"다시 시도",run:()=>openCloudSources("library")})
    }
  }

  async function initMobileSync({justConnected=false}={}){
    if(!googleDrive?.listSyncTopology)return;
    try{
      syncEngine=syncEngineCore.createMobileSyncEngine({
        drive:googleDrive,syncModel,coordination:syncCoordination,metaStore:syncEngineCore.createIndexedDbMetaStore(),
        readLocal:()=>baseRepository.snapshot(),writeLocal:engineWriteLocal,displayName:mobileDeviceName(),
        hooks:{flushPendingSaves:flushPendingMobileSaves,hasPendingSaves:hasPendingMobileSaves,ensureConnected:async()=>{await restoreGoogleConnection();return googleDrive?.status?.().connected===true},onStatus:handleSyncStatus},
        log:(level,event,detail)=>{if(level!=="info")logDiagnostic(level==="error"?"error":"warn","SYNC",String(event),detail instanceof Error?detail:null)}
      });
      const status=await syncEngine.init();installMobileSyncGuards();
      if(status.linked&&!status.suspended)runMobileReturnCheck().finally(()=>syncEngine.startPolling({immediate:false}));
      else if(!status.linked)justConnected?askMobileSyncImportAfterConnect():maybeStartMobileLink();
      else setIndicator("local","동기화 멈춤")
    }catch(error){console.error("모바일 자동 동기화 시작 실패",error);logDiagnostic("error","SYNC","자동 동기화를 시작하지 못했습니다.",error)}
  }

  async function importCanonicalState(source){
    const canonical=source?.format==="hamboard-cloud-backup"&&source.state?source.state:source?.state&&typeof source.state==="object"?source.state:source;
    if(!canonical||typeof canonical!=="object"||Array.isArray(canonical))throw new Error("mobile-state-invalid");
    const projection=syncModel.projectCanonicalState(canonical,syncModel.CLIENT_PROFILES.mobileCore);
    const pausedForImport=await pauseSyncForRestore("file-import");
    try{await flushPendingMobileSaves({strict:true})}
    catch(error){if(pausedForImport)await resumeSyncAfterAbortedRestore("file-import");throw error}
    // From here local state is replaced; a failure keeps sync paused so the partial import is never pushed.
    await repository.replaceState(projection,{markBaseline:true});
    if(syncEngine?.status().linked)showSyncToast("파일에서 불러와 자동 동기화를 멈췄습니다. 클라우드 화면에서 다시 시작할 수 있습니다.");
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

  function requireCloudCommitTopology(objects=[]){
    if(!syncCoordination?.commitTopology)throw new Error("sync-topology-helper-missing");
    const topology=syncCoordination.commitTopology(objects,"");
    if(topology?.error)throw new Error(`sync-import-${topology.error}`);
    return topology
  }

  function syncCheckpointForTopology(objects,topology){
    const revisions=new Map((topology.path||[]).map((item,index)=>[String(item.revision||""),index]));
    return (objects||[]).filter(item=>item?.syncType==="checkpoint"&&String(item.objectKey||"").startsWith("sync/checkpoints/")&&revisions.has(String(item.revision||"")))
      .sort((a,b)=>revisions.get(String(b.revision||""))-revisions.get(String(a.revision||""))||Number(b.createdAtMs||0)-Number(a.createdAtMs||0))[0]||null
  }

  async function readCloudCheckpoint(object){
    const checkpoint=await googleDrive.getSyncValue(object);
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
    const commit=await googleDrive.getSyncValue(object);
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
      let topology=fastMode?null:requireCloudCommitTopology(objects),head=fastMode?listing.head:topology?.head;
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
    loadSyncSource.disabled=active||(!cloudSyncListing&&!syncEngine?.status().linked);
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
        const head=syncResult.value.fast===true?syncResult.value.head:requireCloudCommitTopology(syncResult.value.objects||[]).head;
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
    const engineStatus=syncEngine?.status();
    if(engineStatus?.linked&&cloudSyncListing)syncSourceMeta.textContent+=engineStatus.suspended?" · 자동 동기화 멈춤":" · 자동 동기화 켜짐";
    renderSyncSourceAction();
    renderAccountButton()
  }

  async function loadBackupSource(entry){
    setCloudSourceBusy(true);
    let pausedForRestore=false,restoreApplied=false;
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
      let manifest=await googleDrive.getBackupManifest(entry);
      let canonical;
      if(manifest.formatVersion===3){
        manifest=await cloudPayload.hydrateSections(manifest,googleDrive.getBackupPage,{
          skipSections:["versions","workTracking","deviceStateDelta","syncContext","missingAssets"]
        });
        if(manifest.cloudUserData?.schemaVersion!==1||manifest.cloudUserData?.cloudUserDataVersion!==syncModel.CLOUD_USER_DATA_VERSION)throw new Error("mobile-backup-cloud-data-invalid");
        canonical=syncModel.applyCloudUserData({},manifest.cloudUserData,syncModel.CLIENT_PROFILES.desktop)
      }else canonical=cloudPayload.unpackUserState(manifest,syncModel);
      if(!canonical||typeof canonical!=="object"||Array.isArray(canonical))throw new Error("mobile-state-invalid");
      const projection=syncModel.projectCanonicalState(canonical,syncModel.CLIENT_PROFILES.mobileCore);
      // Keep the old state intact until sync is paused and the backup's assets have been prepared.
      pausedForRestore=await pauseSyncForRestore("backup-restore");
      await flushPendingMobileSaves({strict:true});
      cloudSourceStatus.textContent="백업 이미지를 준비하는 중입니다. 60%";
      const assets=await downloadCurrentBackupAssets(manifest,projection,progress=>{
          const ratio=progress.total?progress.completed/progress.total:1;
          cloudSourceStatus.textContent=`현재 문서의 이미지를 불러오는 중입니다. ${Math.round(60+ratio*40)}%`
      });
      cloudSourceStatus.textContent="백업 스냅샷을 적용하는 중입니다.";
      restoreApplied=true;
      await restoreCloudProjection(projection);
      if(syncEngine?.status().linked)showSyncToast("백업을 불러와 자동 동기화를 멈췄습니다. 클라우드 화면에서 다시 시작할 수 있습니다.");
      if(assets.unresolved.length){
        logDiagnostic("warn","ASSET",`백업 이미지 ${assets.unresolved.length}개를 아직 불러오지 못했습니다.`);
        setStatus(`백업 이미지 ${assets.unresolved.length}개를 불러오지 못했습니다. 클라우드에서 같은 백업을 다시 불러와 주세요.`,{action:"클라우드 열기",run:()=>openCloudSources("library")})
      }
    }catch(error){
      console.error("모바일 백업 불러오기 실패",error);
      logDiagnostic("error","CLOUD","수동 백업 불러오기에 실패했습니다.",error);
      const resumed=pausedForRestore&&!restoreApplied?await resumeSyncAfterAbortedRestore("backup-restore"):false;
      cloudSourceStatus.textContent=`${cloudErrorMessage(error)}${resumed?" 기기 데이터는 바뀌지 않았고 자동 동기화를 다시 켰습니다.":restoreApplied&&syncEngine?.status().suspended?" 일부가 적용되었을 수 있어 자동 동기화는 멈춘 상태로 둡니다.":""}`;
      renderBackupSources(cloudBackupEntries);
      if(String(error?.message||"").includes("reconnect"))renderAccountButton()
    }finally{
      setCloudSourceBusy(false)
    }
  }

  function renderSyncSourceAction(){
    const status=syncEngine?.status();
    loadSyncSource.textContent=!status?"최신 데이터 불러오기":status.suspended?"클라우드 기준으로 다시 시작":status.linked?"지금 동기화":"자동 동기화 시작";
    setCloudSourceBusy(false)
  }
  async function loadSelectedSync(){
    if(cloudSyncImportPromise)return cloudSyncImportPromise;
    setCloudSourceBusy(true);
    cloudSourceStatus.hidden=false;
    try{
      const status=syncEngine?.status();
      if(!syncEngine)await syncFromCloud(cloudSyncListing);
      else if(status.suspended){
        const confirmed=await openMobileConfirm({title:"클라우드 기준으로 다시 시작할까요?",message:"백업이나 파일에서 불러온 뒤 자동 동기화가 멈춰 있습니다. 계속하면 이 기기의 데이터를 클라우드의 최신 상태로 바꾸고 자동 동기화를 다시 시작합니다.",confirmLabel:"클라우드로 맞추기",cancelLabel:"취소",destructive:true});
        if(!confirmed)return;
        cloudSourceStatus.textContent="클라우드 데이터를 불러오는 중입니다.";
        await syncEngine.resetFromCloud();syncEngine.startPolling({immediate:false});openLibrary()
      }else if(!status.linked){
        cloudSourceStatus.textContent="클라우드와 연결하는 중입니다.";
        const result=await startMobileLink();
        cloudSourceStatus.textContent=result?.cancelled?"":result?.linkMessage||"";cloudSourceStatus.hidden=!cloudSourceStatus.textContent;
        if(!result?.cancelled)openLibrary()
      }else{
        cloudSourceStatus.textContent="동기화하는 중입니다.";
        const result=await syncEngine.sync("manual");
        if(result?.failed)throw new Error(result.error||"sync-failed");
        cloudSourceStatus.textContent=result?.blocked?cloudErrorMessage(new Error(result.blocked)):"동기화했습니다."
      }
      renderSyncSourceAction()
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
    if(route.view==="trash"){renderTrashScreen();return}
    if(route.view==="settings"){renderSettingsScreen(route.section==="info"?"info":"display");return}
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
      const authResult=consumeMobileAuthResult();
      const match=location.hash.match(/^#(project|note|mindmap)\/(.+)$/);
      history.replaceState({hamboard:true,view:"home"},"",appBaseUrl());
      renderHome();
      installNoteViewportTracking();
      if(match)openDocument(match[1],decodeURIComponent(match[2]));
      refreshLucideIcons();
      registerMobileServiceWorker();
      renderInstallAction();
      if(authResult==="denied")showSyncToast("Google 계정 연결을 취소했습니다.");
      else if(authResult&&authResult!=="connected")showSyncToast("Google 계정을 연결하지 못했습니다. 다시 시도해 주세요.");
      initMobileSync({justConnected:authResult==="connected"})
    }catch(error){
      console.error("모바일 저장소를 열지 못했습니다.",error);
      logDiagnostic("error","REPOSITORY","모바일 저장소를 열지 못했습니다.",error);
      setStatus("모바일 저장소를 열지 못했습니다. 브라우저의 사이트 데이터 설정을 확인해 주세요.")
    }
  }

  backButton.onclick=async()=>{
    if(!blockEditorScreen.hidden){
      const saved=await flushMobileGeneralBlockSave();
      if(saved)closeMobileGeneralBlockEditor();
      return
    }
    if(activeDocumentType){if(activeDocumentType==="note"){flushMobileNoteSave();flushMobileNoteHtmlSave()}openLibrary({replace:true})}
    else handleBack()
  };
  blockEditorTitle.addEventListener("input",scheduleMobileGeneralBlockSave);
  [blockEditorSummary,blockEditorNotes].forEach(bindMobileBlockRichEditor);
  blockEditorScriptAdd.onclick=()=>addMobileScriptLine();
  blockEditorScriptAddType.onclick=()=>{
    const open=blockEditorScriptTypeMenu.hidden;
    blockEditorScriptTypeMenu.hidden=!open;
    blockEditorScriptAddType.setAttribute("aria-expanded",String(open))
  };
  blockEditorScriptTypeMenu.onclick=event=>{
    const choice=event.target.closest("[data-script-add-type]");
    if(choice)addMobileScriptLine(choice.dataset.scriptAddType)
  };
  blockEditorScriptPreview.onclick=()=>{
    if(activeBlockEditor?.type!=="script")return;
    activeBlockEditor.preview=!activeBlockEditor.preview;
    renderMobileScriptRows()
  };
  blockEditorScriptRows.addEventListener("input",event=>{
    const row=event.target.closest("[data-line-id]"),edit=activeBlockEditor;
    if(edit?.type!=="script"||!row)return;
    const line=edit.scriptBlocks.find(item=>String(item.id)===row.dataset.lineId);
    if(!line)return;
    if(event.target.dataset.scriptField==="text"){
      line.text=event.target.value;
      resizeMobileScriptText(event.target);
      if(line.type==="direction"){
        const label=row.querySelector('[data-script-picker="shot"] .project-script-picker-label');
        if(label)label.textContent=MOBILE_SHOT_PRESETS.includes(line.text)?line.text:"연출 선택"
      }
    }else if(event.target.dataset.scriptField==="divider-text"){
      line.text=event.target.value;
      line.autoLabel=false;
      row.querySelector(".project-script-divider-label").textContent=line.text||line.type.toUpperCase()
    }else if(event.target.dataset.scriptField==="speaker"){
      line.speaker=event.target.value;
      const character=matchMobileScriptCharacter(line.speaker);
      line.characterId=String(character?.id||"");
      if(character?.color)row.style.setProperty("--dialogue-color",safeColor(character.color,"#6A6E78"));
      else row.style.removeProperty("--dialogue-color");
      const label=row.querySelector('[data-script-picker="character"] .project-script-picker-label');
      if(label)label.textContent=character?.name||"캐릭터 선택"
    }else return;
    scheduleMobileGeneralBlockSave()
  });
  blockEditorScriptRows.addEventListener("focusin",event=>{
    const row=event.target.closest("[data-line-id]");
    if(row)selectMobileScriptRow(row.dataset.lineId)
  });
  blockEditorScriptRows.addEventListener("click",event=>{
    const edit=activeBlockEditor,row=event.target.closest("[data-line-id]");
    if(edit?.type!=="script"||!row)return;
    selectMobileScriptRow(row.dataset.lineId);
    const choice=event.target.closest("[data-script-choice]");
    if(choice){
      const line=edit.scriptBlocks.find(item=>String(item.id)===row.dataset.lineId);
      if(!line)return;
      if(choice.dataset.scriptChoice==="type"){
        const next=choice.dataset.scriptValue;
        if(!MOBILE_SCRIPT_TYPES[next])return;
        if(next!==line.type){
          if((line.type==="page"||line.type==="cut")&&line.autoLabel===true)line.text="";
          line.type=next;
          if(next!=="dialogue"){line.speaker="";line.characterId=""}
          line.background="";line.shot="";
          if(next==="page"||next==="cut"){line.autoLabel=true;line.text=""}
          else delete line.autoLabel;
          renumberMobileScriptLines();
          renderMobileScriptRows(line.id);
          scheduleMobileGeneralBlockSave()
        }else{
          choice.parentElement.hidden=true;
          choice.closest(".project-script-picker").querySelector('[data-script-action="picker"]').setAttribute("aria-expanded","false")
        }
        return
      }else if(choice.dataset.scriptChoice==="character"){
        const character=mobileScriptCharacters().find(item=>String(item.id)===choice.dataset.scriptValue);
        if(!character)return;
        line.characterId=String(character.id);
        line.speaker=String(character.name||"");
        row.querySelector('[data-script-field="speaker"]').value=line.speaker;
        if(character.color)row.style.setProperty("--dialogue-color",safeColor(character.color,"#6A6E78"));
        else row.style.removeProperty("--dialogue-color")
      }else if(choice.dataset.scriptChoice==="shot"){
        line.text=choice.dataset.scriptValue;
        const field=row.querySelector('[data-script-field="text"]');
        field.value=line.text;
        resizeMobileScriptText(field)
      }else return;
      choice.closest(".project-script-picker").querySelector(".project-script-picker-label").textContent=choice.textContent;
      choice.parentElement.hidden=true;
      choice.closest(".project-script-picker").querySelector('[data-script-action="picker"]').setAttribute("aria-expanded","false");
      scheduleMobileGeneralBlockSave();
      return
    }
    const button=event.target.closest("[data-script-action]");
    if(!button)return;
    const index=edit.scriptBlocks.findIndex(item=>String(item.id)===row.dataset.lineId);
    if(index<0)return;
    const action=button.dataset.scriptAction,line=edit.scriptBlocks[index];
    if(action==="picker"){
      const menu=button.closest(".project-script-picker").querySelector(".project-script-picker-menu"),open=menu.hidden;
      row.querySelectorAll(".project-script-picker-menu").forEach(other=>{other.hidden=true});
      row.querySelectorAll('[data-script-action="picker"]').forEach(toggle=>toggle.setAttribute("aria-expanded","false"));
      const rowMenu=row.querySelector(".project-script-row-menu");
      if(rowMenu)rowMenu.hidden=true;
      row.querySelector('[data-script-action="menu"]')?.setAttribute("aria-expanded","false");
      menu.hidden=!open;
      button.setAttribute("aria-expanded",String(open));
      return
    }
    if(action==="insert"){addMobileScriptLine("narration",line.id);return}
    if(action==="divider"){
      row.classList.toggle("editing");
      if(row.classList.contains("editing"))row.querySelector('[data-script-field="divider-text"]')?.focus();
      return
    }
    if(action==="auto"){
      line.autoLabel=true;
      renumberMobileScriptLines();
      row.querySelector(".project-script-divider-label").textContent=line.text;
      row.querySelector('[data-script-field="divider-text"]').value=line.text;
      row.classList.remove("editing");
      scheduleMobileGeneralBlockSave();
      return
    }
    if(action==="menu"){
      row.querySelectorAll(".project-script-picker-menu").forEach(pickerMenu=>{pickerMenu.hidden=true});
      row.querySelectorAll('[data-script-action="picker"]').forEach(toggle=>toggle.setAttribute("aria-expanded","false"));
      const menu=row.querySelector(".project-script-row-menu"),open=menu.hidden;
      menu.hidden=!open;
      button.setAttribute("aria-expanded",String(open));
      return
    }
    if(action==="delete"){
      edit.scriptBlocks.splice(index,1);
      if(!edit.scriptBlocks.length)edit.scriptBlocks.push(mobileScriptLine())
      edit.activeLineId=String(edit.scriptBlocks[Math.min(index,edit.scriptBlocks.length-1)].id)
    }else if(action==="up"&&index>0){
      edit.scriptBlocks.splice(index-1,0,edit.scriptBlocks.splice(index,1)[0])
    }else if(action==="down"&&index<edit.scriptBlocks.length-1){
      edit.scriptBlocks.splice(index+1,0,edit.scriptBlocks.splice(index,1)[0])
    }else return;
    renumberMobileScriptLines();
    renderMobileScriptRows();
    scheduleMobileGeneralBlockSave()
  });
  blockEditorScreen.addEventListener("pointerdown",event=>{
    if(!event.target.closest(".project-block-script-add")){
      blockEditorScriptTypeMenu.hidden=true;
      blockEditorScriptAddType.setAttribute("aria-expanded","false")
    }
    if(!event.target.closest(".project-script-picker")){
      blockEditorScriptRows.querySelectorAll(".project-script-picker-menu").forEach(menu=>{menu.hidden=true});
      blockEditorScriptRows.querySelectorAll('[data-script-action="picker"]').forEach(toggle=>toggle.setAttribute("aria-expanded","false"))
    }
  });
  blockEditorFormatBar.addEventListener("pointerdown",event=>{
    const button=event.target.closest("[data-block-format-command]");
    if(button)event.preventDefault()
  });
  blockEditorFormatBar.addEventListener("click",event=>{
    const button=event.target.closest("[data-block-format-command]");
    if(button)execMobileBlockFormat(button.dataset.blockFormatCommand)
  });
  blockEditorFormatColor.addEventListener("pointerdown",()=>{const selection=window.getSelection();if(selection?.rangeCount&&!selection.isCollapsed){blockFormatRange=selection.getRangeAt(0).cloneRange()}});
  blockEditorFormatColor.addEventListener("input",()=>execMobileBlockFormat("foreColor",blockEditorFormatColor.value));
  blockEditorFormatBlock.addEventListener("pointerdown",()=>{const selection=window.getSelection();if(selection?.rangeCount&&!selection.isCollapsed){blockFormatRange=selection.getRangeAt(0).cloneRange()}});
  blockEditorFormatBlock.addEventListener("change",()=>execMobileBlockFormat("formatBlock",blockEditorFormatBlock.value));
  blockEditorCompletion.onclick=()=>{
    if(!activeBlockEditor)return;
    activeBlockEditor.completed=!activeBlockEditor.completed;
    syncMobileBlockCompletion();
    scheduleMobileGeneralBlockSave()
  };
  blockEditorDelete.onclick=deleteMobileBlock;
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
  createFormBack.onclick=()=>{
    if(activeEditDocument){closeBottomSheet(createSheet);resetCreateSheet()}
    else resetCreateSheet()
  };
  createDelete.onclick=deleteEditedDocument;
  createProjectKind.onclick=event=>{
    const button=event.target.closest("[data-project-kind]");
    if(!button)return;
    createProjectKindValue=button.dataset.projectKind==="long"?"long":"short";
    createProjectKind.querySelectorAll("[data-project-kind]").forEach(item=>item.classList.toggle("active",item===button))
  };
  createForm.onsubmit=event=>{event.preventDefault();activeEditDocument?saveEditedDocument():createNewDocument()};
  noteReaderContent.addEventListener("input",()=>{
    captureMobileNoteSelection();
    scheduleMobileNoteSave();
    updateMobileNoteFormatState();
    updateMobileNoteCharacterCount()
  });
  noteReaderContent.addEventListener("keyup",()=>{captureMobileNoteSelection();updateMobileNoteFormatState()});
  noteReaderContent.addEventListener("pointerup",()=>{captureMobileNoteSelection();updateMobileNoteFormatState()});
  noteReaderContent.addEventListener("focus",captureMobileNoteSelection);
  // In formatting mode a plain tap on the text means "I want to type": leave the panel and bring the keyboard.
  // A long-press selection (no click, non-collapsed range) stays in formatting mode without the keyboard.
  noteReaderContent.addEventListener("click",()=>{
    if(!noteKeyboardSuppressed||!noteFormatPanelKey)return;
    const selection=window.getSelection();
    if(selection?.rangeCount&&!selection.isCollapsed)return;
    captureMobileNoteSelection();
    closeMobileNoteFormatPanel();
    restoreMobileNoteSelection();
    scheduleNoteViewportSync();
    setTimeout(scheduleNoteViewportSync,120)
  });
  noteMobileToolbar.addEventListener("pointerdown",event=>{
    const keyboardButton=event.target.closest("[data-note-keyboard-toggle]");
    if(keyboardButton){
      event.preventDefault();
      if(document.body.classList.contains("note-keyboard-open"))captureMobileNoteSelection();
      return
    }
    // Keep focus in the note so tapping a toolbar button never drops and re-raises the keyboard.
    if(event.target.closest("button")){event.preventDefault();captureMobileNoteSelection()}
  });
  noteMobileToolbar.addEventListener("click",event=>{
    const keyboardButton=event.target.closest("[data-note-keyboard-toggle]");
    if(keyboardButton){
      const keyboardOpen=document.body.classList.contains("note-keyboard-open");
      if(keyboardOpen){
        captureMobileNoteSelection();
        noteReaderContent.blur()
      }else{
        if(noteFormatPanelKey)closeMobileNoteFormatPanel();
        else if(document.activeElement===noteReaderContent){captureMobileNoteSelection();noteReaderContent.blur()}
        setMobileNoteKeyboardSuppressed(false);
        restoreMobileNoteSelection()
      }
      scheduleNoteViewportSync();
      setTimeout(scheduleNoteViewportSync,80);
      return
    }
    const commandButton=event.target.closest("[data-note-command]");
    if(commandButton){execMobileNoteCommand(commandButton.dataset.noteCommand);return}
    const panelButton=event.target.closest("[data-note-panel]");
    if(panelButton)openMobileNoteFormatPanel(panelButton.dataset.notePanel)
  });
  noteFormatPanel.addEventListener("pointerdown",event=>{
    const button=event.target.closest("button");
    if(button)event.preventDefault();
    if(button&&!button.disabled)captureMobileNoteSelection();
    else if(event.target.closest("select,input"))captureMobileNoteSelection()
  });
  noteFormatPanel.addEventListener("click",event=>{
    const commandButton=event.target.closest("[data-note-command]");
    if(commandButton){execMobileNoteCommand(commandButton.dataset.noteCommand);return}
    const blockButton=event.target.closest("[data-note-block]");
    if(blockButton){execMobileNoteCommand("formatBlock",blockButton.dataset.noteBlock);return}
    const quoteButton=event.target.closest("[data-note-quote]");
    if(quoteButton){if(!quoteButton.disabled)applyMobileNoteQuoteStyle(quoteButton.dataset.noteQuote);return}
    const lineButton=event.target.closest("[data-note-line-height]");
    if(lineButton){applyMobileNoteLineHeight(lineButton.dataset.noteLineHeight);return}
    const insertButton=event.target.closest("[data-note-insert]");
    if(!insertButton||insertButton.disabled)return;
    if(insertButton.dataset.noteInsert==="link")insertMobileNoteLink();
    else if(insertButton.dataset.noteInsert==="fold")insertMobileNoteFold();
    else if(insertButton.dataset.noteInsert==="divider")insertMobileNoteDivider(insertButton.dataset.noteDivider||"solid")
  });
  noteFormatPanel.addEventListener("change",event=>{
    const font=event.target.closest("[data-note-font]");
    if(font){execMobileNoteCommand("fontName",font.value);return}
    const color=event.target.closest("[data-note-color]");
    if(color)execMobileNoteCommand(color.dataset.noteColor,color.value)
  });
  noteHtmlEditor.addEventListener("input",()=>{
    scheduleMobileNoteHtmlSave();
    updateMobileNoteCharacterCount()
  });
  noteHtmlEditor.addEventListener("keydown",event=>{
    if(event.key!=="Tab")return;
    event.preventDefault();
    const start=noteHtmlEditor.selectionStart,end=noteHtmlEditor.selectionEnd;
    noteHtmlEditor.setRangeText("  ",start,end,"end");
    noteHtmlEditor.dispatchEvent(new Event("input",{bubbles:true}))
  });
  noteMoreButton.addEventListener("click",event=>{
    event.stopPropagation();
    const open=noteMoreMenu.hidden;
    noteMoreMenu.hidden=!open;
    noteMoreButton.setAttribute("aria-expanded",String(open));
    if(open)syncMobileNoteMenu()
  });
  noteMoreMenu.addEventListener("click",async event=>{
    const button=event.target.closest("[data-note-menu-action]");
    if(!button)return;
    const action=button.dataset.noteMenuAction;
    closeMobileNoteMenu();
    if(action==="html")await setMobileNoteEditorMode(noteEditorMode==="html"?"rich":"html");
    else if(action==="style")openMobileNoteToolSheet();
    else if(action==="correction")await openMobileNoteCorrection()
  });
  document.addEventListener("pointerdown",event=>{
    if(noteMoreMenu.hidden)return;
    if(!event.target.closest(".note-head-menu-wrap"))closeMobileNoteMenu()
  });

  document.addEventListener("selectionchange",()=>{
    if(!blockEditorScreen.hidden){
      requestAnimationFrame(syncMobileBlockFormatBar);
      return
    }
    if(activeDocumentType!=="note")return;
    const selection=window.getSelection();
    if(selection?.rangeCount&&noteReaderContent.contains(selection.anchorNode)){
      noteSavedRange=selection.getRangeAt(0).cloneRange();
      updateMobileNoteFormatState()
    }
  });
  window.addEventListener("pagehide",()=>{flushMobileNoteSave();flushMobileNoteHtmlSave();if(activeBlockEditor)flushMobileGeneralBlockSave()});
  librarySearch.addEventListener("input",renderLibrary);
  menuCloud.onclick=()=>openCloudSources("menu");
  menuDisplay.onclick=()=>openSettings("display");
  menuAppInfo.onclick=()=>openSettings("info");
  menuTrash.onclick=()=>openTrash();
  emptyTrashButton.onclick=async()=>{
    const items=snapshot().trash||[];if(!items.length)return;
    const confirmed=await openMobileConfirm({title:"휴지통을 비우시겠습니까?",message:"모든 항목을 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다.",confirmLabel:"모두 삭제",cancelLabel:"취소",destructive:true});
    if(!confirmed)return;
    const state=snapshot();state.trash=[];
    try{await repository.replaceState(state);renderMobileTrash()}catch(error){console.error("모바일 휴지통 비우기 실패",error);logDiagnostic("error","REPOSITORY","휴지통 비우기에 실패했습니다.",error)}
  };
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
      // Forget the sync base so a different account can never be merged against it.
      await syncEngine?.unlink().catch(error=>logDiagnostic("warn","SYNC","동기화 연결 해제를 정리하지 못했습니다.",error));
      renderSyncReadonly(null);hideMobileReturnGate();
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
      setStatus(String(error?.message||"").includes("mobile-pending-save-failed")?"편집 중인 내용을 저장하지 못해 파일 불러오기를 멈췄습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.":"파일에서 햄보드 데이터를 불러오지 못했습니다.",{action:"다시 선택",run:()=>fileInput.click()})
    }
  };

  window.HamboardMobileApp=Object.freeze({
    syncStatus:()=>syncEngine?.status()||null,syncNow:reason=>syncEngine?.sync(reason||"manual"),
    start,repository,assetRepository,importCanonicalState,applyCloudCommits,syncFromCloud,commitTopology:requireCloudCommitTopology,readCloudCheckpoint,readCloudCommit,openDocument,closeDocument,openLibrary,openMenu,openTrash,openSettings,openCloudSources,refreshCloudSources,snapshot
  });
  start();
})();
