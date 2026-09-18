import { readFile } from "node:fs/promises";
import process from "node:process";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("web/index.html", root), "utf8");
const sharedModelSource = await readFile(new URL("web/shared/sync-state-model.js", root), "utf8");
const rust = await readFile(new URL("src-tauri/src/google_drive.rs", root), "utf8");
const lib = await readFile(new URL("src-tauri/src/lib.rs", root), "utf8");

const failures = [];
const check = (name, condition) => {
  if (!condition) failures.push(name);
};

const scriptStart = html.indexOf("<script>\n", html.indexOf("lucide.min.js"));
const scriptEnd = html.lastIndexOf("</script>");
check("main inline script boundaries", scriptStart >= 0 && scriptEnd > scriptStart);
if (scriptStart >= 0 && scriptEnd > scriptStart) {
  try {
    new Function(html.slice(scriptStart + "<script>".length, scriptEnd));
  } catch (error) {
    failures.push(`main inline JavaScript syntax: ${error.message}`);
  }
}

const htmlChecks = {
  "state schema remains v1": "const SCHEMA_VERSION = 1;",
  "sync protocol remains v1": "const SYNC_PROTOCOL_VERSION=1",
  "interrupted asset uploads recover": "interrupted-transfers-recovered",
  "remote commit integrity quarantine": "remote-commit-quarantined",
  "self stale commit preserves editor DOM": "cursorPreserved:true",
  "background remote changes preserve object references": "objectReferencesPreserved:true",
  "active editor defers overlapping remote apply": "remote-apply-deferred-for-editor",
  "pointer interactions defer overlapping remote apply": "active-document-pointer",
  "JavaScript generation guards delayed writes": "sync-local-state-changed-before-native-apply",
  "remote apply retry does not poison local write queue": "StateRepository.writeQueue=operation.catch(()=>{})",
  "apply-time races preserve conflicts": "concurrent-local-edit-reconciled",
  "only changed document histories are invalidated": "changed-histories-invalidated",
  "typing during remote apply retries safely": "automatic-sync-retry-local-edit",
  "automatic retry backoff": "syncAutomaticRetryNotBefore",
  "Drive reconnect restarts sync": "drive-reconnected",
  "quota failure has user guidance": "Drive 저장 공간 또는 권한 확인 필요",
  "asset upload stops after first infrastructure failure": "stoppedAfterFailure",
  "conflicts preserve both choices": "data-sync-resolution=\"keep-both\"",
  "unresolved conflicts block upload": "blocked:\"entity-conflict\"",
  "cloud backup keeps manual retention choice": "openCloudBackupChoiceDialog",
  "selected note images support keyboard deletion": "note-inline-image-removed",
  "note image moves rehydrate from AssetRepository": "note-image-move-recovery",
  "note image drag never trusts a persisted blob URL": "refreshNoteImageElement(moving",
  "external image drops use the repository insert path": "source:\"drag-drop\"",
  "connected settings expose latest sync import": "id=\"settingsSyncImportAction\"",
  "sync import is explicitly confirmed": "최신 동기화 데이터를 불러올까요?",
  "sync import preserves local-only entities": "localOnlyPreserved:true",
  "sync import records overlapping changes as conflicts": "await syncPreserveConflict",
  "automatic sync yields to explicit sync import": "skipped:\"manual-import-active\"",
  "reconnect import blocks upload until remote state is checked": "skipped:\"reconnect-import-pending\"",
  "account reconnect imports before scheduling upload": "reconnect-import-complete",
  "account reconnect asks before importing automatic sync": "자동 동기화 데이터를 불러오시겠습니까?",
  "reconnect prompt explains local-only preservation": "이 로컬 환경에만 있는 데이터는 유지됩니다.",
  "large standalone sync row is removed at runtime": "syncImportAction?.closest(\".settings-work-row\")?.remove()",
  "automatic and manual backups share one timeline": "data-backup-kind=\"${summary.automatic?\"automatic\":\"manual\"}\"",
  "automatic timeline entry has no delete action": "deleteButton=summary.automatic?\"\"",
  "sync commits retain their cloud image quality": "quality:imageQuality",
  "automatic sync carries home widget layout": "if(profile.workspace)value.workspace=syncWorkspaceSnapshot(snapshot)",
  "automatic sync carries registered programs and work time": "entities.set(\"work-tracking:main\"",
  "desktop loads the shared sync state model": "<script src=\"./shared/sync-state-model.js\"></script>",
  "desktop cloud commits declare their client profile": "clientProfile=SyncStateModel.clientProfileId(SYNC_CLIENT_PROFILES.desktop)",
  "remote commits apply through their declared client profile": "syncApplyChanges(merged,mergeChanges,commit.clientProfile)",
  "native tracker state is captured before automatic sync": "await syncCaptureWorkTracking();await StateRepository.flush();await SyncRepository.prepareOutbox()",
  "remote work tracking is reapplied through its repository": "await syncApplyWorkTracking(effectiveChangedKeys)",
  "legacy sync commits do not erase widget layout": "remoteWorkspaceAvailable&&remoteEntry.value?.workspace",
  "manual restore explicitly rerenders home widgets": "가져오기 후 홈 위젯 복원",
  "restore dialogs report percentage progress": "불러오는 중 · ${percent}%",
  "first restore warns about initial download time": "처음 불러올 때는 이미지와 데이터를 내려받느라 오래 걸릴 수 있습니다.",
  "backup timeline hides redundant counts": "cloudBackupListStatus.hidden=true",
  "news panel closes from an outside click": "#newsPanel,#newsBtn",
};
for (const [name, token] of Object.entries(htmlChecks)) check(name, html.includes(token));
const sharedModelChecks = {
  "mobile core profile declares primary mobile screens": "MOBILE_CORE_VISIBLE_ENTITY_TYPES=Object.freeze([\"project\",\"note\",\"mindmap\",\"calendar-event\",\"character\",\"quick-memo\"])",
  "mobile core profile keeps supporting folder character fields and trash": "MOBILE_CORE_SUPPORT_ENTITY_TYPES=Object.freeze([\"folder\",\"character-field-template\",\"trash\"])",
  "mobile core profile excludes desktop workspace and work tracking": "mobileCore:Object.freeze({id:\"mobile-core\"",
  "shared model projects cloud changes per client": "function projectChangesForClient",
  "shared model validates commit writers by client profile": "function applyCommitToCanonical",
  "shared model replays cloud commits into client projections": "function applyCommitToClientState",
};
for (const [name, token] of Object.entries(sharedModelChecks)) check(name, sharedModelSource.includes(token));

check(
  "revoked refresh token is removed",
  rust.includes('error.contains("invalid_grant")')
    && rust.includes("credential_store::delete_refresh_token")
    && rust.includes("google-drive-reconnect-required"),
);
check(
  "Google Drive sync metadata retains the client profile",
  rust.includes('"clientProfile"') && rust.includes('"hamboardClientProfile"'),
);
check(
  "sync asset migration exists",
  lib.includes("CREATE TABLE IF NOT EXISTS sync_asset_transfers")
    && lib.includes("PRIMARY KEY (asset_id, quality)"),
);
check(
  "remote apply rebuilds divergent outbox",
  lib.includes("prepared_state_sequence")
    && lib.includes("requires_rebaseline"),
);

const syncApplyStart = html.indexOf("async function runAutomaticSync");
const syncApplyEnd = html.indexOf("function scheduleAutomaticSync", syncApplyStart);
const syncApplySource = html.slice(syncApplyStart, syncApplyEnd);
check(
  "remote apply no longer replaces the global state object",
  syncApplyStart >= 0 && syncApplyEnd > syncApplyStart && !syncApplySource.includes("state=readState(cloneData(merged))"),
);
check(
  "remote apply no longer clears every undo history",
  !syncApplySource.includes("documentEditHistories.clear()") && !syncApplySource.includes("historyPendingAssetRemovals.clear()"),
);

const syncImportStart = html.indexOf("async function syncImportLatestRemoteState");
const syncImportEnd = html.indexOf("function syncCommitTopology", syncImportStart);
const syncImportSource = html.slice(syncImportStart, syncImportEnd);
check(
  "sync import reconstructs the remote head from the full commit chain",
  syncImportStart >= 0
    && syncImportEnd > syncImportStart
    && syncImportSource.includes('syncCommitTopology(objects,\"\")')
    && syncImportSource.includes("remote=syncApplyChanges(remote,commit.changes,commit.clientProfile)"),
);
check(
  "sync import only adds missing remote entities before guarded apply",
  syncImportSource.includes("if(!localEntry){additions.push")
    && syncImportSource.includes("syncApplyChanges(current,additions)")
    && syncImportSource.includes("SyncRepository.applyRemoteState"),
);

const noteImageEditorStart = html.indexOf("function clearNoteImageDropState");
const noteImageEditorEnd = html.indexOf("async function hydrateNoteImages", noteImageEditorStart);
const noteImageEditorSource = html.slice(noteImageEditorStart, noteImageEditorEnd);
check(
  "note image move relocates the same DOM and Asset identity",
  noteImageEditorStart >= 0
    && noteImageEditorEnd > noteImageEditorStart
    && noteImageEditorSource.includes("marker.parentNode.insertBefore(moving,marker)")
    && !noteImageEditorSource.includes("cloneNode"),
);
check(
  "note image deletion saves immediately through history-aware cleanup",
  noteImageEditorSource.includes("removeSelectedNoteImage")
    && noteImageEditorSource.includes("saveCurrentNoteFromEditor(true)")
    && !noteImageEditorSource.includes("AssetRepository.remove"),
);
check(
  "note image mutations respect remote read-only leases",
  noteImageEditorSource.includes("if(syncRemoteLease)")
    && noteImageEditorSource.includes("현재는 읽기 전용입니다"),
);

try {
  const entityMapSource = html.slice(
    html.indexOf("function syncStateEntityMap"),
    html.indexOf("async function syncJsonSha256"),
  );
  const entityKeySource = html.slice(
    html.indexOf("function syncEntityKey"),
    html.indexOf("function syncStateComparable"),
  );
  const changedKeysSource = html.slice(
    html.indexOf("function syncChangedEntityKeys"),
    html.indexOf("function syncTransientEditReason"),
  );
  const adoptSource = html.slice(
    html.indexOf("function syncAdoptMergedState"),
    html.indexOf("function syncInvalidateChangedHistories"),
  );
  const collections = [
    ["folder", "folders"], ["project", "projects"], ["mindmap", "mindmaps"], ["note", "notes"],
    ["character", "characterRepository"], ["character-field-template", "characterFieldTemplates"],
    ["trash", "trash"], ["story-template", "storyTemplates"], ["calendar-event", "calendarEvents"],
    ["quick-memo", "quickMemos"],
  ];
  const makeState = suffix => Object.fromEntries([
    ...collections.map(([type, field]) => [field, [
      { id: `${type}-stable`, value: `stable-${suffix}` },
      { id: `${type}-changed`, value: `before-${suffix}` },
    ]]),
    ["tagLibrary", ["stable"]], ["favorites", []], ["selectedFolder", "all"],
    ["homeDdayWidget", { eventId: "" }], ["settings", { defaultStoryTemplateId: "" }],
    ["lastSessionView", { view: "note", noteId: "note-stable" }],
  ]);
  const initial = makeState("local");
  const stableReferences = new Map(collections.map(([type, field]) => [type, initial[field][0]]));
  const merged = structuredClone(initial);
  for (const [type, field] of collections) merged[field][1].value = `remote-${type}`;
  const harness = new Function("initialState", "collections", `
    const SYNC_STATE_COLLECTIONS=collections;
    const SYNC_CLIENT_PROFILES={desktop:{collections:SYNC_STATE_COLLECTIONS,userLibrary:true,workspace:true,workTracking:true}};
    const syncClientProfile=()=>SYNC_CLIENT_PROFILES.desktop;
    const cloneData=value=>structuredClone(value);
    const normalizeSyncWorkTracking=value=>structuredClone(value||{programs:[],daily:[]});
    const sameId=(left,right)=>String(left??"")===String(right??"");
    let state=initialState;
    ${entityMapSource}\n${entityKeySource}\n${changedKeysSource}\n${adoptSource}
    return { changed:syncChangedEntityKeys, adopt:syncAdoptMergedState, state:()=>state };
  `)(initial, collections);
  const changed = harness.changed(initial, merged);
  harness.adopt(merged, changed);
  const adopted = harness.state();
  check("all synced entity types detect remote changes", collections.every(([type]) => changed.has(`${type}:${type}-changed`)));
  check("unchanged entities retain live object identity", collections.every(([type, field]) => adopted[field][0] === stableReferences.get(type)));
  check("changed entities adopt remote values", collections.every(([type, field]) => adopted[field][1].value === `remote-${type}`));
  check("session navigation remains local", adopted.lastSessionView.view === "note" && adopted.lastSessionView.noteId === "note-stable");

  const raceInitial = makeState("race");
  const raceMerged = structuredClone(raceInitial);
  raceMerged.notes[1].value = "remote-note";
  raceMerged.projects[1].value = "remote-project";
  const raceHarness = new Function("initialState", "collections", `
    const SYNC_STATE_COLLECTIONS=collections;
    const SYNC_CLIENT_PROFILES={desktop:{collections:SYNC_STATE_COLLECTIONS,userLibrary:true,workspace:true,workTracking:true}};
    const syncClientProfile=()=>SYNC_CLIENT_PROFILES.desktop;
    const cloneData=value=>structuredClone(value);
    const normalizeSyncWorkTracking=value=>structuredClone(value||{programs:[],daily:[]});
    const sameId=(left,right)=>String(left??"")===String(right??"");
    let state=initialState;
    ${entityMapSource}\n${entityKeySource}\n${changedKeysSource}\n${adoptSource}
    return { changed:syncChangedEntityKeys, adopt:syncAdoptMergedState, state:()=>state };
  `)(raceInitial, collections);
  const localAdded = { id: "note-local-added", value: "local-only" };
  raceInitial.notes.push(localAdded);
  raceInitial.projects = raceInitial.projects.filter(item => item.id !== "project-stable");
  const raceChanged = raceHarness.changed(makeState("race"), raceMerged);
  const preserved = new Set(["note:note-local-added", "project:project-stable"]);
  raceHarness.adopt(raceMerged, raceChanged, preserved);
  check("apply-time local additions survive remote adoption", raceHarness.state().notes.includes(localAdded));
  check("apply-time local deletions survive remote adoption", !raceHarness.state().projects.some(item => item.id === "project-stable"));

  const modelHost={};new Function("globalThis",sharedModelSource)(modelHost);const sharedModel=modelHost.HamboardSyncStateModel;
  const profileHarness={
    profiles:sharedModel.CLIENT_PROFILES,
    entityMap:(snapshot,profile)=>{const projected=sharedModel.projectCanonicalState(snapshot,profile),map=new Map();for(const [entityType,field] of profile.collections)for(const item of projected[field]||[])map.set(`${entityType}:${item.id}`,{value:item});if(profile.userLibrary)map.set("user-library:main",{value:{tagLibrary:projected.tagLibrary||[],favorites:projected.favorites||[]}});if(profile.workTracking)map.set("work-tracking:main",{value:projected.workTrackingSync});return map},
    empty:(snapshot,profile)=>{const projected=sharedModel.projectCanonicalState(snapshot,profile),changes=[];for(const [entityType,field] of profile.collections)for(const item of projected[field]||[])changes.push({entityType,entityId:String(item.id),operation:"delete",payload:null});if(profile.userLibrary)changes.push({entityType:"user-library",entityId:"main",operation:"upsert",payload:{tagLibrary:[],favorites:[]}});return sharedModel.applyClientChangesToCanonical(snapshot,changes,profile)},
    apply:(snapshot,changes,profile)=>sharedModel.applyChangesToCanonical(snapshot,changes,{profile,strictProfile:false}),
  };
  const mobileState={
    projects:[{id:"project-1"}],notes:[{id:"note-1"}],mindmaps:[{id:"mindmap-1"}],calendarEvents:[{id:"event-1"}],characterRepository:[{id:"character-1"}],quickMemos:[{id:"memo-1"}],
    folders:[{id:"folder-1"}],characterFieldTemplates:[{id:"field-1"}],trash:[{id:"trash-1"}],storyTemplates:[{id:"template-1",name:"PC template"}],
    tagLibrary:["shared"],favorites:[{type:"project",id:"project-1"}],workTrackingSync:{programs:[{id:"program-1"}],daily:[]},
    homeWidgets:["pc-widget"],homeWidgetPositions:{"pc-widget":{x:1}},homeScheduleWidget:{enabled:true},homeDdayWidget:{eventId:"event-1"},collapsedFolderIds:["folder-1"],newsReadIds:["news-1"],
    settings:{calendarDesktopWidget:{enabled:true},workToolModules:["timer"],theme:"cotton-candy"},utilities:{countdowns:[{id:"timer-1"}]},
  };
  const mobileMap=profileHarness.entityMap(mobileState,profileHarness.profiles.mobileCore);
  check("mobile profile syncs requested primary entities", ["project:project-1","note:note-1","mindmap:mindmap-1","calendar-event:event-1","character:character-1","quick-memo:memo-1"].every(key=>mobileMap.has(key)));
  check("mobile profile retains supporting shared entities", ["folder:folder-1","character-field-template:field-1","trash:trash-1"].every(key=>mobileMap.has(key)));
  check("mobile profile defers templates and work tracking", !mobileMap.has("story-template:template-1")&&!mobileMap.has("work-tracking:main"));
  check("mobile user library omits desktop workspace", !Object.prototype.hasOwnProperty.call(mobileMap.get("user-library:main").value,"workspace"));
  const mobileEmpty=profileHarness.empty(mobileState,profileHarness.profiles.mobileCore);
  check("mobile baseline preserves deferred desktop state", mobileEmpty.storyTemplates.length===1&&mobileEmpty.workTrackingSync.programs.length===1&&mobileEmpty.homeWidgets[0]==="pc-widget"&&mobileEmpty.utilities.countdowns[0].id==="timer-1");
  const legacyChanges=[
    {entityType:"user-library",entityId:"main",operation:"upsert",payload:{tagLibrary:["remote"],favorites:[],workspace:{homeWidgets:["remote-widget"],settings:{calendarDesktopWidget:{enabled:false},theme:"dark"}}}},
    {entityType:"work-tracking",entityId:"main",operation:"upsert",payload:{programs:[],daily:[]}},
    {entityType:"story-template",entityId:"template-1",operation:"delete",payload:null},
  ];
  const mobileApplied=profileHarness.apply(mobileState,legacyChanges,profileHarness.profiles.mobileCore);
  check("mobile applies shared tags without desktop workspace", mobileApplied.tagLibrary[0]==="remote"&&mobileApplied.homeWidgets[0]==="pc-widget"&&mobileApplied.settings.theme==="cotton-candy");
  check("mobile ignores known deferred desktop changes", mobileApplied.workTrackingSync.programs.length===1&&mobileApplied.storyTemplates.length===1);
} catch (error) {
  failures.push(`sync state adoption behavior: ${error.message}`);
}

if (failures.length) {
  console.error("Hamboard sync final QA failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(`Hamboard sync final QA passed (${Object.keys(htmlChecks).length + Object.keys(sharedModelChecks).length + 25} checks).`);
}
