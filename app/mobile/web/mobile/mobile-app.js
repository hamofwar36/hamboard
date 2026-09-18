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
  const backButton=$("#mobileBack");
  const title=$("#mobileTitle");
  const indicator=$("#syncIndicator");
  const librarySearch=$("#librarySearch");
  const fileInput=$("#mobileDataFile");
  const libraryNav=$("#libraryNav");
  const createNav=$("#createNav");
  const menuNav=$("#menuNav");
  const createSheet=$("#createSheet");
  const mainMenuSheet=$("#mainMenuSheet");
  const searchSheet=$("#searchSheet");
  const menuSearch=$("#menuSearch");
  const menuCloud=$("#menuCloud");
  const cloudSheet=$("#cloudSheet");
  const cloudMessage=$("#cloudSheetMessage");
  const cloudConnect=$("#cloudConnect");
  const cloudDisconnect=$("#cloudDisconnect");

  let activeDocumentType="";
  let activeDocumentId="";
  let activeEpisodeId="";

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

  function cloudErrorMessage(error){
    const text=String(error?.message||error||"");
    if(text.includes("web-client-id-not-configured"))return "Google 로그인 설정을 불러오지 못했습니다. 배포 설정을 확인해 주세요.";
    if(text.includes("secure-origin-required"))return "Google 로그인은 HTTPS 주소에서 사용할 수 있습니다.";
    if(text.includes("popup_closed")||text.includes("popup-failed"))return "Google 로그인 창이 닫혔습니다. 다시 시도해 주세요.";
    if(text.includes("access_denied"))return "Google Drive 접근 권한이 허용되지 않았습니다.";
    if(text.includes("branched-history"))return "클라우드 동기화 기록이 갈라져 있어 PC에서 먼저 동기화 충돌을 해결해야 합니다.";
    if(text.includes("download-integrity")||text.includes("commit-"))return "클라우드 데이터 검증에 실패했습니다. PC에서 다시 동기화한 뒤 시도해 주세요.";
    if(text.includes("http-401")||text.includes("reconnect-required"))return "Google 연결이 만료되었습니다. 다시 로그인해 주세요.";
    return "Google Drive에서 데이터를 불러오지 못했습니다. 네트워크와 로그인 상태를 확인해 주세요."
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
  function setDocumentHash(type,id){history.replaceState({type,id},"",`#${type}/${encodeURIComponent(id)}`)}
  function documentCount(state=snapshot()){return (state.projects||[]).length+(state.notes||[]).length+(state.mindmaps||[]).length}

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
      meta:stripHtml(item.content||"").slice(0,80)
    }
  }

  function renderLibrary(){
    const state=snapshot(),documents=libraryDocuments(state),host=$("#libraryList");
    host.replaceChildren();
    if(!documents.length){
      setStatus("동기화된 작품, 노트 또는 마인드맵이 아직 없습니다.",{action:"데이터 파일 불러오기",run:()=>fileInput.click()});
      refreshLucideIcons();
      return
    }
    hideStatus();
    for(const entry of documents){
      const {type,item}=entry,descriptor=documentDescriptor(type,item,state),button=element("button",`project-card ${type==="project"?"story-card":type==="note"?"note-card":"mindmap-card"}`);
      button.type="button";
      button.dataset.documentType=type;
      button.dataset.documentId=String(item.id||"");
      button.style.setProperty("--card-color",descriptor.color);
      button.style.setProperty("--card-fg",cardForeground(descriptor.color));

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

  function renderSearchResults(){
    const query=librarySearch.value.trim().toLocaleLowerCase("ko"),host=$("#searchResults"),state=snapshot();
    host.replaceChildren();
    if(!query){host.append(element("div","search-empty","검색어를 입력하세요."));return}
    const results=libraryDocuments(state).filter(({type,item})=>{
      const descriptor=documentDescriptor(type,item,state);
      const extra=type==="note"?stripHtml(item.content||""):type==="mindmap"?(item.nodes||[]).map(node=>`${node.title||""} ${node.text||""}`).join(" "):"";
      return `${item.title||""} ${descriptor.subtitle} ${descriptor.folder} ${extra}`.toLocaleLowerCase("ko").includes(query)
    });
    if(!results.length){host.append(element("div","search-empty","검색 결과가 없습니다."));return}
    for(const {type,item} of results){
      const descriptor=documentDescriptor(type,item,state),button=element("button","search-result");
      button.type="button";
      button.innerHTML=`<i data-lucide="${descriptor.icon}" aria-hidden="true"></i><span><strong></strong><small></small></span><i data-lucide="chevron-right" aria-hidden="true"></i>`;
      button.querySelector("strong").textContent=item.title||"제목 없음";
      button.querySelector("small").textContent=[descriptor.kind,descriptor.folder].filter(Boolean).join(" · ");
      button.onclick=()=>{closeBottomSheet(searchSheet);openDocument(type,item.id)};
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

  function openDocument(type,id){
    const state=snapshot(),key=String(id||"");
    const item=type==="project"?(state.projects||[]).find(entry=>String(entry?.id||"")===key):type==="note"?(state.notes||[]).find(entry=>String(entry?.id||"")===key):(state.mindmaps||[]).find(entry=>String(entry?.id||"")===key);
    if(!item)return;
    activeDocumentType=type;
    activeDocumentId=key;
    activeEpisodeId="";
    libraryScreen.hidden=true;
    hideDocumentScreens();
    const screen=documentScreen(type);
    if(screen)screen.hidden=false;
    backButton.hidden=false;
    libraryNav.classList.remove("active");
    title.textContent=item.title||(type==="project"?"작품":type==="note"?"노트":"마인드맵");
    if(type==="project")renderProject(item);
    else if(type==="note")renderNote(item);
    else renderMindmap(item);
    setDocumentHash(type,key);
    window.scrollTo(0,0);
    refreshLucideIcons()
  }

  function closeDocument(){
    activeDocumentType="";
    activeDocumentId="";
    activeEpisodeId="";
    hideDocumentScreens();
    libraryScreen.hidden=false;
    backButton.hidden=true;
    libraryNav.classList.add("active");
    title.textContent="보관함";
    history.replaceState({},"",location.pathname+location.search);
    renderLibrary();
    window.scrollTo(0,0)
  }

  async function importCanonicalState(source){
    const canonical=source?.format==="hamboard-cloud-backup"&&source.state?source.state:source?.state&&typeof source.state==="object"?source.state:source;
    if(!canonical||typeof canonical!=="object"||Array.isArray(canonical))throw new Error("mobile-state-invalid");
    const projection=syncModel.projectCanonicalState(canonical,syncModel.CLIENT_PROFILES.mobileCore);
    await repository.replaceState(projection,{markBaseline:true});
    setIndicator("synced","불러옴");
    closeDocument();
    return snapshot()
  }

  async function applyCloudCommits(commits=[]){
    for(const commit of commits)await repository.applyCommit(commit);
    repository.markSynced();
    setIndicator("synced","동기화");
    closeDocument();
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

  async function syncFromCloud(){
    if(!googleDrive)throw new Error("google-drive-web-transport-unavailable");
    setIndicator("busy","불러오는 중");
    cloudMessage.textContent="PC의 최신 동기화 데이터를 확인하고 있습니다…";
    const listing=await googleDrive.listSyncObjects();
    if(listing.truncated)throw new Error("sync-object-list-truncated");
    const topology=commitTopology(listing.objects||[]);
    if(!topology.head){
      setIndicator("synced","연결됨");
      cloudMessage.textContent="Google Drive에 동기화된 데이터가 아직 없습니다.";
      return {empty:true,state:snapshot()}
    }
    let projected=syncModel.projectCanonicalState({},syncModel.CLIENT_PROFILES.mobileCore);
    for(let index=0;index<topology.path.length;index++){
      cloudMessage.textContent=`동기화 데이터를 불러오는 중입니다. (${index+1}/${topology.path.length})`;
      const commit=await readCloudCommit(topology.path[index]),result=syncModel.applyCommitToClientState(projected,commit,syncModel.CLIENT_PROFILES.mobileCore);
      projected=result.state
    }
    await repository.replaceState(projected,{markBaseline:true});
    setIndicator("synced","동기화");
    cloudMessage.textContent=`최신 데이터 동기화 완료 · 문서 ${documentCount()}개`;
    if(activeDocumentId)closeDocument();else renderLibrary();
    return {empty:false,revision:String(topology.head.revision),state:snapshot()}
  }

  function renderCloudSheet(){
    const status=googleDrive?.status?.()||{configured:false,connected:false};
    cloudDisconnect.hidden=!status.connected;
    cloudConnect.textContent=status.connected?"지금 다시 불러오기":"Google로 로그인";
    if(status.connected)cloudMessage.textContent="Google Drive에 연결되어 있습니다. PC의 최신 데이터를 다시 확인할 수 있습니다."
  }
  function openCloudSheet(){renderCloudSheet();cloudSheet.hidden=false;refreshLucideIcons()}
  function closeCloudSheet(){cloudSheet.hidden=true}
  async function connectAndSync(){
    cloudConnect.disabled=true;cloudDisconnect.disabled=true;
    try{
      const status=googleDrive.status();
      if(!status.connected)await googleDrive.connect();
      renderCloudSheet();
      await syncFromCloud()
    }catch(error){
      console.error("모바일 Google Drive 동기화 실패",error);
      setIndicator("error","오류");
      cloudMessage.textContent=cloudErrorMessage(error)
    }finally{
      cloudConnect.disabled=false;cloudDisconnect.disabled=false
    }
  }

  function openBottomSheet(sheet){if(sheet){sheet.hidden=false;refreshLucideIcons()}}
  function closeBottomSheet(sheet){if(sheet)sheet.hidden=true}
  function openLibrary(){if(activeDocumentId)closeDocument();libraryNav.classList.add("active");window.scrollTo({top:0,behavior:"smooth"})}
  function openSearch(){closeBottomSheet(mainMenuSheet);librarySearch.value="";renderSearchResults();openBottomSheet(searchSheet);requestAnimationFrame(()=>librarySearch.focus())}

  async function start(){
    try{
      await repository.load();
      setIndicator("local",googleDrive?.status().configured?"로그인":"로컬");
      renderLibrary();
      const match=location.hash.match(/^#(project|note|mindmap)\/(.+)$/);
      if(match)openDocument(match[1],decodeURIComponent(match[2]));
      refreshLucideIcons()
    }catch(error){
      console.error("모바일 저장소를 열지 못했습니다.",error);
      setStatus("모바일 저장소를 열지 못했습니다. 브라우저의 사이트 데이터 설정을 확인해 주세요.")
    }
  }

  backButton.onclick=closeDocument;
  libraryNav.onclick=openLibrary;
  createNav.onclick=()=>openBottomSheet(createSheet);
  menuNav.onclick=()=>openBottomSheet(mainMenuSheet);
  $("#createSheetClose").onclick=()=>closeBottomSheet(createSheet);
  $("#mainMenuClose").onclick=()=>closeBottomSheet(mainMenuSheet);
  $("#searchSheetClose").onclick=()=>closeBottomSheet(searchSheet);
  createSheet.onclick=event=>{if(event.target===createSheet)closeBottomSheet(createSheet)};
  mainMenuSheet.onclick=event=>{if(event.target===mainMenuSheet)closeBottomSheet(mainMenuSheet)};
  searchSheet.onclick=event=>{if(event.target===searchSheet)closeBottomSheet(searchSheet)};
  menuSearch.onclick=openSearch;
  librarySearch.addEventListener("input",renderSearchResults);
  menuCloud.onclick=()=>{closeBottomSheet(mainMenuSheet);openCloudSheet()};
  indicator.onclick=openCloudSheet;
  $("#cloudSheetClose").onclick=closeCloudSheet;
  cloudSheet.onclick=event=>{if(event.target===cloudSheet)closeCloudSheet()};
  cloudConnect.onclick=connectAndSync;
  cloudDisconnect.onclick=()=>{
    googleDrive.disconnect();
    setIndicator("local","로그인");
    cloudMessage.textContent="Google Drive 연결을 해제했습니다. 모바일에 내려받은 데이터는 유지됩니다.";
    renderCloudSheet()
  };
  window.addEventListener("popstate",()=>{if(activeDocumentId)closeDocument()});
  fileInput.onchange=async()=>{
    const file=fileInput.files?.[0];fileInput.value="";
    if(!file)return;
    try{await importCanonicalState(JSON.parse(await file.text()))}
    catch(error){
      console.error("모바일 데이터 불러오기 실패",error);
      setStatus("파일에서 햄보드 데이터를 불러오지 못했습니다.",{action:"다시 선택",run:()=>fileInput.click()})
    }
  };

  window.HamboardMobileApp=Object.freeze({
    start,repository,importCanonicalState,applyCloudCommits,syncFromCloud,commitTopology,readCloudCommit,openDocument,closeDocument,snapshot
  });
  start();
})();
