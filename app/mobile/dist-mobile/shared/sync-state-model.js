(function(root){
  "use strict";

  const CLOUD_USER_DATA_VERSION=1;
  const STATE_COLLECTIONS=Object.freeze([
    Object.freeze(["folder","folders"]),
    Object.freeze(["project","projects"]),
    Object.freeze(["mindmap","mindmaps"]),
    Object.freeze(["note","notes"]),
    Object.freeze(["character","characterRepository"]),
    Object.freeze(["character-field-template","characterFieldTemplates"]),
    Object.freeze(["trash","trash"]),
    Object.freeze(["story-template","storyTemplates"]),
    Object.freeze(["calendar-event","calendarEvents"]),
    Object.freeze(["quick-memo","quickMemos"])
  ]);
  const MOBILE_CORE_VISIBLE_ENTITY_TYPES=Object.freeze(["project","note","mindmap","calendar-event","character","quick-memo"]);
  const MOBILE_CORE_SUPPORT_ENTITY_TYPES=Object.freeze(["folder","character-field-template","trash"]);
  const mobileTypes=new Set([...MOBILE_CORE_VISIBLE_ENTITY_TYPES,...MOBILE_CORE_SUPPORT_ENTITY_TYPES]);
  const MOBILE_SHARED_SETTING_FIELDS=Object.freeze(["theme","themeCustomA","themeCustomB","themeSwapped","mode"]);
  const DESKTOP_SHARED_SETTING_FIELDS=null;
  const DEVICE_LOCAL_SETTING_FIELDS=Object.freeze(["calendarDesktopWidget"]);
  const deviceLocalSettingFields=new Set(DEVICE_LOCAL_SETTING_FIELDS);
  const workspaceFields=Object.freeze(["homeWidgets","homeWidgetPositions","homeScheduleWidget","homeDdayWidget","collapsedFolderIds","newsReadIds"]);
  const CLIENT_PROFILES=Object.freeze({
    desktop:Object.freeze({id:"desktop",collections:STATE_COLLECTIONS,userLibrary:true,workspace:true,settingsFields:DESKTOP_SHARED_SETTING_FIELDS,utilityLibrary:true,workTracking:true}),
    mobileCore:Object.freeze({id:"mobile-core",collections:Object.freeze(STATE_COLLECTIONS.filter(([type])=>mobileTypes.has(type))),userLibrary:true,workspace:false,settingsFields:MOBILE_SHARED_SETTING_FIELDS,utilityLibrary:false,workTracking:false})
  });
  const CLOUD_USER_DATA_DEFINITION=Object.freeze({
    version:CLOUD_USER_DATA_VERSION,
    collections:STATE_COLLECTIONS,
    userLibrary:Object.freeze(["tagLibrary","favorites"]),
    workspaceFields,
    desktopSettingFields:DESKTOP_SHARED_SETTING_FIELDS,
    utilities:Object.freeze(["notificationSounds","soundPreferences","pomodoroPreset","countdownDefinitions","reminderDefinitions","mascotLibrary"]),
    workTracking:true,
    deviceLocal:Object.freeze(["selectedFolder","lastSessionView","settings.calendarDesktopWidget","quickMemo.desktopWidget","utilityRuntime","sound.lastSource","sound.packId","sound.trackName","sound.localTracks","mascot.enabled","mascot.position","mascot.monitorId"])
  });
  // Every state category must be explicitly shared or local. Unknown categories fail closed.
  const DEVICE_STATE_FIELDS=Object.freeze(["selectedFolder","lastSessionView"]);
  function assertCloudClassification(state={}){
    const allowed=new Set(["schemaVersion","cloudUserDataVersion",...STATE_COLLECTIONS.map(row=>row[1]),...CLOUD_USER_DATA_DEFINITION.userLibrary,...workspaceFields,"settings","utilities","workTrackingSync",...DEVICE_STATE_FIELDS]);
    for(const key of Object.keys(state))if(!allowed.has(key))throw new Error(`unclassified-user-data:${key}`);
    const check=(value,keys,path)=>{for(const key of Object.keys(record(value)))if(!keys.includes(key))throw new Error(`unclassified-user-data:${path}.${key}`)};
    const u=record(state.utilities);
    check(u,["countdownSound","reminderSound","pomodoroSound","notificationVolume","pomodoroVolume","customNotificationSounds","sound","pomodoro","countdowns","reminders","mascotCommon","mascots"],"utilities");
    check(u.sound,["volume","ambientVolume","lastSource","noiseType","packId","trackName","shuffle","repeat","favorites","albums","albumTracks","packTrackTitles","localTracks"],"utilities.sound");
    check(u.pomodoro,["focusMinutes","breakMinutes","longBreakMinutes","longBreakInterval","completedPomodoros","mode","remainingSeconds","running","endAt"],"utilities.pomodoro");
    for(const item of list(u.customNotificationSounds))check(item,["id","assetId","label","originalName","mimeType"],"utilities.customNotificationSounds");
    check(u.mascotCommon,["motion","displayMode","size","speechInterval","speechEnabled","monitorId"],"utilities.mascotCommon");
    for(const item of list(u.countdowns))check(item,["id","title","durationSeconds","remainingSeconds","running","endAt"],"utilities.countdowns");
    for(const item of list(u.reminders))check(item,["id","title","intervalSeconds","intervalMinutes","nextAt","enabled"],"utilities.reminders");
    for(const item of list(u.mascots))check(item,["id","name","assetId","enabled","motion","displayMode","size","speechEnabled","speechInterval","dialogues","x","y","desktopX","desktopY"],"utilities.mascots");
    return true;
  }
  const knownFields=new Map(STATE_COLLECTIONS);

  function clone(value){
    if(value===undefined)return undefined;
    if(typeof structuredClone==="function")return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function record(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{}}
  function list(value){return Array.isArray(value)?value:[]}
  function profileOf(profile=CLIENT_PROFILES.desktop){return profile===CLIENT_PROFILES.mobileCore||profile==="mobile-core"?CLIENT_PROFILES.mobileCore:CLIENT_PROFILES.desktop}
  function clientProfileId(profile=CLIENT_PROFILES.desktop){return profileOf(profile).id}
  function clientProfileFromId(value,{legacyDesktop=true}={}){const id=String(value||"");if(!id&&legacyDesktop)return CLIENT_PROFILES.desktop;if(id===CLIENT_PROFILES.desktop.id)return CLIENT_PROFILES.desktop;if(id===CLIENT_PROFILES.mobileCore.id)return CLIENT_PROFILES.mobileCore;throw new Error("sync-client-profile-unsupported")}
  function same(left,right){return JSON.stringify(left)===JSON.stringify(right)}
  function entityMap(items=[]){const out=new Map();for(const item of list(items)){const id=String(item?.id||"");if(id)out.set(id,item)}return out}
  function validChange(change){const type=String(change?.entityType||""),id=String(change?.entityId||""),operation=String(change?.operation||"");if(!type||!id||!["upsert","delete"].includes(operation))throw new Error("sync-change-invalid");return {type,id,operation}}
  function requireObjectPayload(change,id){if(!change.payload||typeof change.payload!=="object"||Array.isArray(change.payload)||String(change.payload.id||"")!==id)throw new Error("sync-change-payload-invalid")}
  function selectedSettings(settings,fields){
    if(!settings||typeof settings!=="object"||Array.isArray(settings))return {};
    const picked={};
    const keys=fields===null?Object.keys(settings):Array.isArray(fields)?fields:[];
    for(const key of keys)if(!deviceLocalSettingFields.has(key)&&Object.prototype.hasOwnProperty.call(settings,key))picked[key]=clone(settings[key]);
    return picked
  }
  function projectCollectionItem(entityType,item){
    const value=clone(item);
    if(entityType==="quick-memo"&&value&&typeof value==="object")delete value.desktopWidget;
    return value
  }
  function mergeCollectionItem(entityType,incoming,local){
    const value=clone(incoming);
    if(entityType==="quick-memo"&&value&&typeof value==="object"){
      if(local&&typeof local==="object"&&local.desktopWidget&&typeof local.desktopWidget==="object")value.desktopWidget=clone(local.desktopWidget);
      else delete value.desktopWidget
    }
    return value
  }
  function projectMascotLibrary(canonicalState={}){
    const utilities=record(canonicalState?.utilities),common=record(utilities.mascotCommon),legacySpeechEnabled=common.speechEnabled===true,legacySize=Math.min(320,Math.max(48,Number(common.size)||120));
    return {common:{motion:common.motion==="bounce"?"bounce":"static",displayMode:common.displayMode==="desktop"?"desktop":"app",speechInterval:Math.min(600,Math.max(5,Number(common.speechInterval)||30))},items:list(utilities.mascots).map((item,index)=>({id:String(item?.id||""),name:String(item?.name||`펫 ${index+1}`).trim()||`펫 ${index+1}`,assetId:String(item?.assetId||""),motion:["static","bounce"].includes(item?.motion)?item.motion:null,displayMode:["app","desktop"].includes(item?.displayMode)?item.displayMode:null,size:Math.min(320,Math.max(48,Number(item?.size)||legacySize)),speechEnabled:typeof item?.speechEnabled==="boolean"?item.speechEnabled:legacySpeechEnabled,speechInterval:item?.speechInterval===null||item?.speechInterval===undefined||item?.speechInterval===""?null:Math.min(600,Math.max(5,Number(item.speechInterval)||30)),dialogues:list(item?.dialogues).map(line=>String(line||"").trim()).filter(Boolean)})).filter((item,index,rows)=>item.id&&rows.findIndex(entry=>entry.id===item.id)===index).slice(0,4)}
  }
  function applyMascotLibrary(target,library){
    if(!library||typeof library!=="object"||Array.isArray(library))return target;
    target.utilities=record(target.utilities);
    const existingCommon=record(target.utilities.mascotCommon),common=record(library.common),legacySpeechEnabled=typeof common.speechEnabled==="boolean"?common.speechEnabled:null;
    const legacySize=Object.prototype.hasOwnProperty.call(common,"size")?Math.min(320,Math.max(48,Number(common.size)||120)):Math.min(320,Math.max(48,Number(existingCommon.size)||120));
    target.utilities.mascotCommon={...existingCommon,motion:common.motion==="bounce"?"bounce":common.motion==="static"?"static":existingCommon.motion==="bounce"?"bounce":"static",displayMode:common.displayMode==="desktop"?"desktop":common.displayMode==="app"?"app":existingCommon.displayMode==="desktop"?"desktop":"app",speechInterval:Object.prototype.hasOwnProperty.call(common,"speechInterval")?Math.min(600,Math.max(5,Number(common.speechInterval)||30)):Math.min(600,Math.max(5,Number(existingCommon.speechInterval)||30))};
    delete target.utilities.mascotCommon.speechEnabled;delete target.utilities.mascotCommon.size;
    const existing=new Map(list(target.utilities.mascots).map(item=>[String(item?.id||""),item]).filter(([id])=>id));
    target.utilities.mascots=list(library.items).map((item,index)=>{const id=String(item?.id||""),local=existing.get(id)||{},motion=["static","bounce"].includes(item?.motion)?item.motion:null,displayMode=["app","desktop"].includes(item?.displayMode)?item.displayMode:null,size=Math.min(320,Math.max(48,Number(item?.size)||Number(local.size)||legacySize||120)),speechInterval=item?.speechInterval===null||item?.speechInterval===undefined||item?.speechInterval===""?null:Math.min(600,Math.max(5,Number(item.speechInterval)||30)),speechEnabled=typeof item?.speechEnabled==="boolean"?item.speechEnabled:legacySpeechEnabled!==null?legacySpeechEnabled:local.speechEnabled===true;return {id,name:String(item?.name||`펫 ${index+1}`).trim()||`펫 ${index+1}`,assetId:String(item?.assetId||""),enabled:local.enabled===true,motion,displayMode,size,speechEnabled,speechInterval,dialogues:list(item?.dialogues).map(line=>String(line||"").trim()).filter(Boolean),x:Number.isFinite(Number(local.x))?Number(local.x):null,y:Number.isFinite(Number(local.y))?Number(local.y):null,desktopX:Number.isFinite(Number(local.desktopX))?Number(local.desktopX):null,desktopY:Number.isFinite(Number(local.desktopY))?Number(local.desktopY):null}}).filter((item,index,rows)=>item.id&&rows.findIndex(entry=>entry.id===item.id)===index).slice(0,4);
    return target
  }
  function projectUtilityLibrary(canonicalState={}){
    const utilities=record(canonicalState?.utilities),sound=record(utilities.sound),pomodoro=record(utilities.pomodoro);
    return {
      notificationSounds:{countdownSound:String(utilities.countdownSound||"new-stage"),reminderSound:String(utilities.reminderSound||utilities.countdownSound||"new-stage"),pomodoroSound:String(utilities.pomodoroSound||"new-stage"),notificationVolume:Number.isFinite(Number(utilities.notificationVolume))?Math.min(100,Math.max(0,Math.round(Number(utilities.notificationVolume)))):100,pomodoroVolume:Number.isFinite(Number(utilities.pomodoroVolume))?Math.min(100,Math.max(0,Math.round(Number(utilities.pomodoroVolume)))):100,customSounds:list(utilities.customNotificationSounds).map(item=>({id:String(item?.id||""),assetId:String(item?.assetId||item?.id||""),label:String(item?.label||item?.originalName||"사용자 알림음").trim().slice(0,80)||"사용자 알림음",originalName:String(item?.originalName||item?.label||"").trim().slice(0,240),mimeType:String(item?.mimeType||"").trim().toLowerCase()})).filter(item=>/^[a-z0-9_-]{1,120}$/i.test(item.id)&&item.assetId===item.id).filter((item,index,rows)=>rows.findIndex(entry=>entry.id===item.id)===index)},
      soundPreferences:{volume:Number.isFinite(Number(sound.volume))?Math.min(100,Math.max(0,Number(sound.volume))):60,ambientVolume:Number.isFinite(Number(sound.ambientVolume))?Math.min(100,Math.max(0,Number(sound.ambientVolume))):35,noiseType:["white","brown","pink"].includes(sound.noiseType)?sound.noiseType:"brown",shuffle:sound.shuffle===true,repeat:["off","one","all"].includes(sound.repeat)?sound.repeat:"all",favorites:clone(list(sound.favorites).filter(item=>String(item?.packId||"")!=="user")),albums:clone(list(sound.albums)),albumTracks:clone(list(sound.albumTracks).filter(item=>String(item?.packId||"")!=="user")),packTrackTitles:clone(record(sound.packTrackTitles))},
      pomodoroPreset:{focusMinutes:Math.min(180,Math.max(1,Number(pomodoro.focusMinutes)||25)),breakMinutes:Math.min(60,Math.max(1,Number(pomodoro.breakMinutes)||5)),longBreakMinutes:Math.min(120,Math.max(1,Number(pomodoro.longBreakMinutes)||30)),longBreakInterval:Math.min(12,Math.max(1,Math.floor(Number(pomodoro.longBreakInterval)||4)))},
      countdownDefinitions:list(utilities.countdowns).map(item=>({id:String(item?.id||""),title:String(item?.title||"알림"),durationSeconds:Math.min(604800,Math.max(1,Number(item?.durationSeconds)||300))})).filter((item,index,rows)=>item.id&&rows.findIndex(entry=>entry.id===item.id)===index),
      reminderDefinitions:list(utilities.reminders).map(item=>({id:String(item?.id||""),title:String(item?.title||"반복 알림"),intervalSeconds:Math.min(604800,Math.max(1,Number(item?.intervalSeconds)||Math.max(0,Number(item?.intervalMinutes)||0)*60||3600))})).filter((item,index,rows)=>item.id&&rows.findIndex(entry=>entry.id===item.id)===index),
      mascotLibrary:projectMascotLibrary(canonicalState)
    }
  }
  function applyUtilityLibrary(target,library){
    if(!library||typeof library!=="object"||Array.isArray(library))return target;
    target.utilities=record(target.utilities);const utilities=target.utilities;
    const sounds=record(library.notificationSounds);for(const key of ["countdownSound","reminderSound","pomodoroSound"])if(Object.prototype.hasOwnProperty.call(sounds,key))utilities[key]=String(sounds[key]||"new-stage");
    if(Object.prototype.hasOwnProperty.call(sounds,"notificationVolume"))utilities.notificationVolume=Math.min(100,Math.max(0,Math.round(Number(sounds.notificationVolume)||0)));
    if(Object.prototype.hasOwnProperty.call(sounds,"pomodoroVolume"))utilities.pomodoroVolume=Math.min(100,Math.max(0,Math.round(Number(sounds.pomodoroVolume)||0)));
    if(Array.isArray(sounds.customSounds))utilities.customNotificationSounds=list(sounds.customSounds).map(item=>({id:String(item?.id||""),assetId:String(item?.assetId||item?.id||""),label:String(item?.label||item?.originalName||"사용자 알림음").trim().slice(0,80)||"사용자 알림음",originalName:String(item?.originalName||item?.label||"").trim().slice(0,240),mimeType:String(item?.mimeType||"").trim().toLowerCase()})).filter(item=>/^[a-z0-9_-]{1,120}$/i.test(item.id)&&item.assetId===item.id).filter((item,index,rows)=>rows.findIndex(entry=>entry.id===item.id)===index);if(Array.isArray(sounds.customSounds)){const customSoundIds=new Set(list(utilities.customNotificationSounds).map(item=>String(item?.id||"")));for(const key of ["countdownSound","reminderSound","pomodoroSound"]){const value=String(utilities[key]||"new-stage");if(value.startsWith("custom:")&&!customSoundIds.has(value.slice(7)))utilities[key]="new-stage"}}
    const prefs=record(library.soundPreferences),existingSound=record(utilities.sound);utilities.sound={...existingSound};
    for(const key of ["volume","ambientVolume","noiseType","shuffle","repeat","favorites","albums","albumTracks","packTrackTitles"])if(Object.prototype.hasOwnProperty.call(prefs,key))utilities.sound[key]=clone(prefs[key]);
    const preset=record(library.pomodoroPreset),existingPomodoro=record(utilities.pomodoro);utilities.pomodoro={...existingPomodoro};for(const key of ["focusMinutes","breakMinutes","longBreakMinutes","longBreakInterval"])if(Object.prototype.hasOwnProperty.call(preset,key))utilities.pomodoro[key]=Number(preset[key]);
    const existingCountdowns=new Map(list(utilities.countdowns).map(item=>[String(item?.id||""),item]).filter(([id])=>id));utilities.countdowns=list(library.countdownDefinitions).map(item=>{const id=String(item?.id||""),durationSeconds=Math.min(604800,Math.max(1,Number(item?.durationSeconds)||300)),local=existingCountdowns.get(id)||{};return {id,title:String(item?.title||"알림"),durationSeconds,remainingSeconds:Object.prototype.hasOwnProperty.call(local,"remainingSeconds")?Math.min(durationSeconds,Math.max(0,Number(local.remainingSeconds)||0)):durationSeconds,running:local.running===true,endAt:local.running?Math.max(0,Number(local.endAt)||0):0}}).filter(item=>item.id);
    const existingReminders=new Map(list(utilities.reminders).map(item=>[String(item?.id||""),item]).filter(([id])=>id));utilities.reminders=list(library.reminderDefinitions).map(item=>{const id=String(item?.id||""),intervalSeconds=Math.min(604800,Math.max(1,Number(item?.intervalSeconds)||3600)),local=existingReminders.get(id)||{},enabled=local.enabled===true;return {id,title:String(item?.title||"반복 알림"),intervalSeconds,nextAt:enabled?Math.max(0,Number(local.nextAt)||0):0,enabled}}).filter(item=>item.id);
    if(library.mascotLibrary)applyMascotLibrary(target,library.mascotLibrary);
    return target
  }
  function projectWorkspace(canonicalState={},profile=CLIENT_PROFILES.desktop){
    profile=profileOf(profile);const workspace={};
    if(profile.workspace)for(const field of workspaceFields)if(Object.prototype.hasOwnProperty.call(canonicalState,field))workspace[field]=clone(canonicalState[field]);
    const settings=selectedSettings(canonicalState?.settings,profile.settingsFields);
    if(Object.keys(settings).length)workspace.settings=settings;
    return workspace
  }
  function applyWorkspace(target,workspace,profile=CLIENT_PROFILES.desktop){
    profile=profileOf(profile);if(!workspace||typeof workspace!=="object"||Array.isArray(workspace))return target;
    if(profile.workspace)for(const field of workspaceFields)if(Object.prototype.hasOwnProperty.call(workspace,field))target[field]=clone(workspace[field]);
    const settings=selectedSettings(workspace.settings,profile.settingsFields);if(Object.keys(settings).length)target.settings={...record(target.settings),...settings};return target
  }
  function projectCloudUserData(canonicalState={},profile=CLIENT_PROFILES.desktop){
    profile=profileOf(profile);const projected={schemaVersion:Number(canonicalState?.schemaVersion)||1,cloudUserDataVersion:CLOUD_USER_DATA_VERSION};
    for(const [entityType,field] of profile.collections)projected[field]=list(canonicalState?.[field]).map(item=>projectCollectionItem(entityType,item));
    if(profile.userLibrary){projected.tagLibrary=clone(list(canonicalState?.tagLibrary));projected.favorites=clone(list(canonicalState?.favorites))}
    if(profile.utilityLibrary)projected.utilities=projectUtilityLibrary(canonicalState);
    if(profile.workTracking)projected.workTrackingSync=clone(record(canonicalState?.workTrackingSync));
    const workspace=projectWorkspace(canonicalState,profile);for(const [key,value] of Object.entries(workspace))projected[key]=clone(value);
    return projected
  }
  function projectCanonicalState(canonicalState={},profile=CLIENT_PROFILES.mobileCore){return projectCloudUserData(canonicalState,profile)}
  function applyCloudUserData(targetState={},cloudUserData={},profile=CLIENT_PROFILES.desktop){
    profile=profileOf(profile);const next=clone(targetState)||{};
    for(const [entityType,field] of profile.collections)if(Array.isArray(cloudUserData?.[field])){const existing=entityMap(next[field]);next[field]=cloudUserData[field].map(item=>mergeCollectionItem(entityType,item,existing.get(String(item?.id||""))))}
    if(profile.userLibrary){if(Array.isArray(cloudUserData?.tagLibrary))next.tagLibrary=clone(cloudUserData.tagLibrary);if(Array.isArray(cloudUserData?.favorites))next.favorites=clone(cloudUserData.favorites)}
    if(profile.utilityLibrary&&cloudUserData?.utilities)applyUtilityLibrary(next,cloudUserData.utilities);
    if(profile.workTracking&&cloudUserData?.workTrackingSync&&typeof cloudUserData.workTrackingSync==="object")next.workTrackingSync=clone(cloudUserData.workTrackingSync);
    applyWorkspace(next,cloudUserData,profile);next.schemaVersion=Number(cloudUserData?.schemaVersion)||Number(next.schemaVersion)||1;return next
  }
  function applyChangesToCanonical(canonicalState={},changes=[],{profile=CLIENT_PROFILES.desktop,strictProfile=false}={}){
    profile=profileOf(profile);const next=clone(canonicalState),allowedFields=new Map(profile.collections);
    for(const change of list(changes)){
      const {type,id,operation}=validChange(change);
      if(type==="user-library"){
        if(id!=="main"||operation!=="upsert"||!change.payload||typeof change.payload!=="object"||Array.isArray(change.payload))throw new Error("sync-user-library-invalid");
        if(!profile.userLibrary){if(strictProfile)throw new Error("sync-change-not-writable-by-client");continue}
        next.tagLibrary=clone(list(change.payload.tagLibrary));next.favorites=clone(list(change.payload.favorites));
        if(profile.utilityLibrary&&change.payload.utilityLibrary)applyUtilityLibrary(next,change.payload.utilityLibrary);else if(profile.workspace&&change.payload.mascotLibrary)applyMascotLibrary(next,change.payload.mascotLibrary);
        if(profile.workspace||profile.settingsFields?.length)applyWorkspace(next,change.payload.workspace,profile);continue
      }
      if(type==="work-tracking"){
        if(id!=="main"||operation!=="upsert"||!change.payload||typeof change.payload!=="object"||Array.isArray(change.payload))throw new Error("sync-work-tracking-invalid");
        if(!profile.workTracking){if(strictProfile)throw new Error("sync-change-not-writable-by-client");continue}
        next.workTrackingSync=clone(change.payload);continue
      }
      const knownField=knownFields.get(type);if(!knownField)throw new Error("sync-entity-type-unsupported");const field=allowedFields.get(type);if(!field){if(strictProfile)throw new Error("sync-change-not-writable-by-client");continue}
      const items=Array.isArray(next[field])?next[field]:[],index=items.findIndex(item=>String(item?.id||"")===id);
      if(operation==="delete"){if(index>=0)items.splice(index,1)}else{requireObjectPayload(change,id);const local=index>=0?items[index]:null,value=mergeCollectionItem(type,change.payload,local);if(index>=0)items[index]=value;else items.push(value)}next[field]=items
    }
    return next
  }
  function applyRemoteChangesToCanonical(canonicalState,changes){return applyChangesToCanonical(canonicalState,changes,{profile:CLIENT_PROFILES.desktop,strictProfile:true})}
  function applyClientChangesToCanonical(canonicalState,changes,profile=CLIENT_PROFILES.mobileCore){return applyChangesToCanonical(canonicalState,changes,{profile,strictProfile:true})}
  function validateClientChanges(changes,profile=CLIENT_PROFILES.mobileCore){applyClientChangesToCanonical({},changes,profile);return true}
  function projectChangesForClient(changes,profile=CLIENT_PROFILES.mobileCore){
    profile=profileOf(profile);const allowedTypes=new Set(profile.collections.map(([type])=>type)),projected=[];
    for(const change of list(changes)){
      applyRemoteChangesToCanonical({},[change]);const type=String(change.entityType||"");
      if(type==="user-library"){
        if(!profile.userLibrary)continue;
        const payload={tagLibrary:clone(list(change.payload?.tagLibrary)),favorites:clone(list(change.payload?.favorites))};
        const workspace=projectWorkspace({...(record(change.payload?.workspace)),settings:record(change.payload?.workspace?.settings)},profile);if(Object.keys(workspace).length)payload.workspace=workspace;
        if(profile.utilityLibrary&&change.payload?.utilityLibrary)payload.utilityLibrary=clone(change.payload.utilityLibrary);
        if(profile.workspace&&change.payload?.mascotLibrary)payload.mascotLibrary=clone(change.payload.mascotLibrary);
        projected.push({...clone(change),payload});continue
      }
      if(type==="work-tracking"){if(profile.workTracking)projected.push(clone(change));continue}
      if(allowedTypes.has(type)){const projectedChange=clone(change);if(projectedChange.operation==="upsert")projectedChange.payload=projectCollectionItem(type,projectedChange.payload);projected.push(projectedChange)}
    }
    return projected
  }
  function clientProfileForCommit(commit={}){return clientProfileFromId(commit?.clientProfile,{legacyDesktop:true})}
  function applyCommitToCanonical(canonicalState,commit={}){if(!Array.isArray(commit?.changes))throw new Error("sync-commit-changes-invalid");const profile=clientProfileForCommit(commit);return applyClientChangesToCanonical(canonicalState,commit.changes,profile)}
  function applyCommitToClientState(clientState,commit={},profile=CLIENT_PROFILES.mobileCore){if(!Array.isArray(commit?.changes))throw new Error("sync-commit-changes-invalid");const sourceProfile=clientProfileForCommit(commit);validateClientChanges(commit.changes,sourceProfile);profile=profileOf(profile);const changes=projectChangesForClient(commit.changes,profile),state=applyClientChangesToCanonical(clientState,changes,profile);return {state,changes,sourceProfile:sourceProfile.id}}
  function diffClientProjection(baseProjection={},editedProjection={},profile=CLIENT_PROFILES.mobileCore){
    profile=profileOf(profile);const beforeProjection=projectCloudUserData(baseProjection,profile),afterProjection=projectCloudUserData(editedProjection,profile),changes=[];
    for(const [entityType,field] of profile.collections){const before=entityMap(beforeProjection?.[field]),after=entityMap(afterProjection?.[field]),ids=[...new Set([...before.keys(),...after.keys()])].sort();for(const id of ids){const left=before.get(id),right=after.get(id);if(same(left,right))continue;if(right)changes.push({entityType,entityId:id,operation:"upsert",payload:clone(right)});else changes.push({entityType,entityId:id,operation:"delete",payload:null})}}
    if(profile.userLibrary){const before={tagLibrary:list(beforeProjection?.tagLibrary),favorites:list(beforeProjection?.favorites)},after={tagLibrary:list(afterProjection?.tagLibrary),favorites:list(afterProjection?.favorites)},beforeWorkspace=projectWorkspace(beforeProjection,profile),afterWorkspace=projectWorkspace(afterProjection,profile),beforeUtilities=profile.utilityLibrary?clone(beforeProjection?.utilities||{}):null,afterUtilities=profile.utilityLibrary?clone(afterProjection?.utilities||{}):null;if(!same(before,after)||!same(beforeWorkspace,afterWorkspace)||(profile.utilityLibrary&&!same(beforeUtilities,afterUtilities))){const payload=clone(after);if(Object.keys(afterWorkspace).length)payload.workspace=clone(afterWorkspace);if(profile.utilityLibrary){payload.utilityLibrary=clone(afterUtilities);payload.mascotLibrary=clone(afterUtilities.mascotLibrary)}changes.push({entityType:"user-library",entityId:"main",operation:"upsert",payload})}}
    if(profile.workTracking&&!same(beforeProjection?.workTrackingSync,afterProjection?.workTrackingSync))changes.push({entityType:"work-tracking",entityId:"main",operation:"upsert",payload:clone(afterProjection?.workTrackingSync||{programs:[],daily:[]})});
    return changes
  }
  function mergeClientProjection(canonicalState,baseProjection,editedProjection,profile=CLIENT_PROFILES.mobileCore){const changes=diffClientProjection(baseProjection,editedProjection,profile),nextCanonical=applyClientChangesToCanonical(canonicalState,changes,profile);return {canonicalState:nextCanonical,projection:projectCloudUserData(nextCanonical,profile),changes}}

  root.HamboardSyncStateModel=Object.freeze({CLOUD_USER_DATA_VERSION,CLOUD_USER_DATA_DEFINITION,assertCloudClassification,DEVICE_STATE_FIELDS,STATE_COLLECTIONS,MOBILE_CORE_VISIBLE_ENTITY_TYPES,MOBILE_CORE_SUPPORT_ENTITY_TYPES,MOBILE_SHARED_SETTING_FIELDS,DESKTOP_SHARED_SETTING_FIELDS,DEVICE_LOCAL_SETTING_FIELDS,CLIENT_PROFILES,profileOf,clientProfileId,clientProfileFromId,clientProfileForCommit,projectCollectionItem,projectMascotLibrary,applyMascotLibrary,projectUtilityLibrary,applyUtilityLibrary,projectWorkspace,applyWorkspace,projectCloudUserData,applyCloudUserData,projectCanonicalState,projectChangesForClient,applyChangesToCanonical,applyRemoteChangesToCanonical,applyClientChangesToCanonical,applyCommitToCanonical,applyCommitToClientState,validateClientChanges,diffClientProjection,mergeClientProjection});
})(typeof globalThis!=="undefined"?globalThis:this);
