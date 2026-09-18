(function(root){
  "use strict";

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
  const CLIENT_PROFILES=Object.freeze({
    desktop:Object.freeze({id:"desktop",collections:STATE_COLLECTIONS,userLibrary:true,workspace:true,settingsFields:null,workTracking:true}),
    mobileCore:Object.freeze({id:"mobile-core",collections:Object.freeze(STATE_COLLECTIONS.filter(([type])=>mobileTypes.has(type))),userLibrary:true,workspace:false,settingsFields:MOBILE_SHARED_SETTING_FIELDS,workTracking:false})
  });
  const knownFields=new Map(STATE_COLLECTIONS);
  const workspaceFields=Object.freeze(["homeWidgets","homeWidgetPositions","homeScheduleWidget","homeDdayWidget","collapsedFolderIds","newsReadIds"]);

  function clone(value){
    if(value===undefined)return undefined;
    if(typeof structuredClone==="function")return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function profileOf(profile=CLIENT_PROFILES.desktop){return profile===CLIENT_PROFILES.mobileCore||profile==="mobile-core"?CLIENT_PROFILES.mobileCore:CLIENT_PROFILES.desktop}
  function clientProfileId(profile=CLIENT_PROFILES.desktop){return profileOf(profile).id}
  function clientProfileFromId(value,{legacyDesktop=true}={}){const id=String(value||"");if(!id&&legacyDesktop)return CLIENT_PROFILES.desktop;if(id===CLIENT_PROFILES.desktop.id)return CLIENT_PROFILES.desktop;if(id===CLIENT_PROFILES.mobileCore.id)return CLIENT_PROFILES.mobileCore;throw new Error("sync-client-profile-unsupported")}
  function same(left,right){return JSON.stringify(left)===JSON.stringify(right)}
  function entityMap(items=[]){const out=new Map();for(const item of Array.isArray(items)?items:[]){const id=String(item?.id||"");if(id)out.set(id,item)}return out}
  function validChange(change){const type=String(change?.entityType||""),id=String(change?.entityId||""),operation=String(change?.operation||"");if(!type||!id||!["upsert","delete"].includes(operation))throw new Error("sync-change-invalid");return {type,id,operation}}
  function requireObjectPayload(change,id){if(!change.payload||typeof change.payload!=="object"||Array.isArray(change.payload)||String(change.payload.id||"")!==id)throw new Error("sync-change-payload-invalid")}
  function selectedSettings(settings,fields){
    if(!settings||typeof settings!=="object"||Array.isArray(settings))return {};
    if(fields===null)return clone(settings);
    const picked={};
    for(const key of Array.isArray(fields)?fields:[])if(Object.prototype.hasOwnProperty.call(settings,key))picked[key]=clone(settings[key]);
    return picked
  }
  function applyWorkspace(target,workspace,{includeWorkspace=true,settingsFields=null}={}){
    if(!workspace||typeof workspace!=="object"||Array.isArray(workspace))return target;
    if(includeWorkspace)for(const field of workspaceFields)if(Object.prototype.hasOwnProperty.call(workspace,field))target[field]=clone(workspace[field]);
    const settings=selectedSettings(workspace.settings,includeWorkspace?null:settingsFields);
    if(Object.keys(settings).length)target.settings={...(target.settings&&typeof target.settings==="object"?target.settings:{}),...settings};
    return target
  }
  function projectCanonicalState(canonicalState={},profile=CLIENT_PROFILES.mobileCore){
    profile=profileOf(profile);const projected={schemaVersion:Number(canonicalState?.schemaVersion)||1};
    for(const [,field] of profile.collections)projected[field]=clone(Array.isArray(canonicalState?.[field])?canonicalState[field]:[]);
    if(profile.userLibrary){projected.tagLibrary=clone(Array.isArray(canonicalState?.tagLibrary)?canonicalState.tagLibrary:[]);projected.favorites=clone(Array.isArray(canonicalState?.favorites)?canonicalState.favorites:[])}
    if(profile.workTracking)projected.workTrackingSync=clone(canonicalState?.workTrackingSync&&typeof canonicalState.workTrackingSync==="object"?canonicalState.workTrackingSync:{programs:[],daily:[]});
    if(profile.workspace)for(const field of workspaceFields)if(Object.prototype.hasOwnProperty.call(canonicalState,field))projected[field]=clone(canonicalState[field]);
    const projectedSettings=selectedSettings(canonicalState?.settings,profile.workspace?null:profile.settingsFields);
    if(Object.keys(projectedSettings).length)projected.settings=projectedSettings;
    return projected
  }
  function applyChangesToCanonical(canonicalState={},changes=[],{profile=CLIENT_PROFILES.desktop,strictProfile=false}={}){
    profile=profileOf(profile);const next=clone(canonicalState),allowedFields=new Map(profile.collections);
    for(const change of Array.isArray(changes)?changes:[]){
      const {type,id,operation}=validChange(change);
      if(type==="user-library"){
        if(id!=="main"||operation!=="upsert"||!change.payload||typeof change.payload!=="object"||Array.isArray(change.payload))throw new Error("sync-user-library-invalid");
        if(!profile.userLibrary){if(strictProfile)throw new Error("sync-change-not-writable-by-client");continue}
        next.tagLibrary=clone(Array.isArray(change.payload.tagLibrary)?change.payload.tagLibrary:[]);next.favorites=clone(Array.isArray(change.payload.favorites)?change.payload.favorites:[]);if(profile.workspace||profile.settingsFields?.length)applyWorkspace(next,change.payload.workspace,{includeWorkspace:profile.workspace,settingsFields:profile.settingsFields});continue
      }
      if(type==="work-tracking"){
        if(id!=="main"||operation!=="upsert"||!change.payload||typeof change.payload!=="object"||Array.isArray(change.payload))throw new Error("sync-work-tracking-invalid");
        if(!profile.workTracking){if(strictProfile)throw new Error("sync-change-not-writable-by-client");continue}
        next.workTrackingSync=clone(change.payload);continue
      }
      const knownField=knownFields.get(type);if(!knownField)throw new Error("sync-entity-type-unsupported");const field=allowedFields.get(type);if(!field){if(strictProfile)throw new Error("sync-change-not-writable-by-client");continue}
      const list=Array.isArray(next[field])?next[field]:[],index=list.findIndex(item=>String(item?.id||"")===id);
      if(operation==="delete"){if(index>=0)list.splice(index,1)}else{requireObjectPayload(change,id);const value=clone(change.payload);if(index>=0)list[index]=value;else list.push(value)}next[field]=list
    }
    return next
  }
  function applyRemoteChangesToCanonical(canonicalState,changes){return applyChangesToCanonical(canonicalState,changes,{profile:CLIENT_PROFILES.desktop,strictProfile:true})}
  function applyClientChangesToCanonical(canonicalState,changes,profile=CLIENT_PROFILES.mobileCore){return applyChangesToCanonical(canonicalState,changes,{profile,strictProfile:true})}
  function validateClientChanges(changes,profile=CLIENT_PROFILES.mobileCore){applyClientChangesToCanonical({},changes,profile);return true}
  function projectChangesForClient(changes,profile=CLIENT_PROFILES.mobileCore){
    profile=profileOf(profile);const allowedTypes=new Set(profile.collections.map(([type])=>type)),projected=[];
    for(const change of Array.isArray(changes)?changes:[]){
      applyRemoteChangesToCanonical({},[change]);const type=String(change.entityType||"");
      if(type==="user-library"){
        if(!profile.userLibrary)continue;
        const payload={tagLibrary:clone(Array.isArray(change.payload?.tagLibrary)?change.payload.tagLibrary:[]),favorites:clone(Array.isArray(change.payload?.favorites)?change.payload.favorites:[])};
        if(change.payload?.workspace&&typeof change.payload.workspace==="object"&&!Array.isArray(change.payload.workspace)){
          if(profile.workspace)payload.workspace=clone(change.payload.workspace);
          else{
            const settings=selectedSettings(change.payload.workspace.settings,profile.settingsFields);
            if(Object.keys(settings).length)payload.workspace={settings}
          }
        }
        projected.push({...clone(change),payload});continue
      }
      if(type==="work-tracking"){if(profile.workTracking)projected.push(clone(change));continue}
      if(allowedTypes.has(type))projected.push(clone(change))
    }
    return projected
  }
  function clientProfileForCommit(commit={}){return clientProfileFromId(commit?.clientProfile,{legacyDesktop:true})}
  function applyCommitToCanonical(canonicalState,commit={}){if(!Array.isArray(commit?.changes))throw new Error("sync-commit-changes-invalid");const profile=clientProfileForCommit(commit);return applyClientChangesToCanonical(canonicalState,commit.changes,profile)}
  function applyCommitToClientState(clientState,commit={},profile=CLIENT_PROFILES.mobileCore){if(!Array.isArray(commit?.changes))throw new Error("sync-commit-changes-invalid");const sourceProfile=clientProfileForCommit(commit);validateClientChanges(commit.changes,sourceProfile);profile=profileOf(profile);const changes=projectChangesForClient(commit.changes,profile),state=applyClientChangesToCanonical(clientState,changes,profile);return {state,changes,sourceProfile:sourceProfile.id}}
  function diffClientProjection(baseProjection={},editedProjection={},profile=CLIENT_PROFILES.mobileCore){
    profile=profileOf(profile);const changes=[];
    for(const [entityType,field] of profile.collections){const before=entityMap(baseProjection?.[field]),after=entityMap(editedProjection?.[field]),ids=[...new Set([...before.keys(),...after.keys()])].sort();for(const id of ids){const left=before.get(id),right=after.get(id);if(same(left,right))continue;if(right)changes.push({entityType,entityId:id,operation:"upsert",payload:clone(right)});else changes.push({entityType,entityId:id,operation:"delete",payload:null})}}
    if(profile.userLibrary){
      const before={tagLibrary:Array.isArray(baseProjection?.tagLibrary)?baseProjection.tagLibrary:[],favorites:Array.isArray(baseProjection?.favorites)?baseProjection.favorites:[]};
      const after={tagLibrary:Array.isArray(editedProjection?.tagLibrary)?editedProjection.tagLibrary:[],favorites:Array.isArray(editedProjection?.favorites)?editedProjection.favorites:[]};
      const beforeSettings=selectedSettings(baseProjection?.settings,profile.workspace?null:profile.settingsFields),afterSettings=selectedSettings(editedProjection?.settings,profile.workspace?null:profile.settingsFields);
      if(!same(before,after)||!same(beforeSettings,afterSettings)){
        const payload=clone(after);
        if(Object.keys(afterSettings).length)payload.workspace={settings:afterSettings};
        changes.push({entityType:"user-library",entityId:"main",operation:"upsert",payload})
      }
    }
    if(profile.workTracking&&!same(baseProjection?.workTrackingSync,editedProjection?.workTrackingSync))changes.push({entityType:"work-tracking",entityId:"main",operation:"upsert",payload:clone(editedProjection?.workTrackingSync||{programs:[],daily:[]})});
    return changes
  }
  function mergeClientProjection(canonicalState,baseProjection,editedProjection,profile=CLIENT_PROFILES.mobileCore){const changes=diffClientProjection(baseProjection,editedProjection,profile),nextCanonical=applyClientChangesToCanonical(canonicalState,changes,profile);return {canonicalState:nextCanonical,projection:projectCanonicalState(nextCanonical,profile),changes}}

  root.HamboardSyncStateModel=Object.freeze({STATE_COLLECTIONS,MOBILE_CORE_VISIBLE_ENTITY_TYPES,MOBILE_CORE_SUPPORT_ENTITY_TYPES,MOBILE_SHARED_SETTING_FIELDS,CLIENT_PROFILES,profileOf,clientProfileId,clientProfileFromId,clientProfileForCommit,projectCanonicalState,projectChangesForClient,applyChangesToCanonical,applyRemoteChangesToCanonical,applyClientChangesToCanonical,applyCommitToCanonical,applyCommitToClientState,validateClientChanges,diffClientProjection,mergeClientProjection});
})(typeof globalThis!=="undefined"?globalThis:this);
