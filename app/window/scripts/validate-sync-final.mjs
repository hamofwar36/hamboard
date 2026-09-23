import { readFile } from "node:fs/promises";
import process from "node:process";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("web/index.html", root), "utf8");
const sharedModelSource = await readFile(new URL("web/shared/sync-state-model.js", root), "utf8");
const rust = await readFile(new URL("src-tauri/src/google_drive.rs", root), "utf8");
const lib = await readFile(new URL("src-tauri/src/lib.rs", root), "utf8");
const cargo = await readFile(new URL("src-tauri/Cargo.toml", root), "utf8");

const failures = [];
let checkCount = 0;
const check = (name, condition) => {
  checkCount++;
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
  "sync import preserves local-only entities": "localOnlyPreserved:merge.localOnlyPreserved",
  "sync import records overlapping changes as conflicts": "await syncPreserveConflict",
  "automatic sync rebases when compacted history drops the local base": 'topology.error==="base-revision-missing"',
  "automatic rebaseline shares checkpoint reconstruction": "automatic-rebaseline-complete",
  "remote cleanup prioritizes old commits": "commit-cleanup-deferred",
  "remote cleanup removes stale asset descriptors and blobs": "remote-storage-cleanup",
  "backup snapshots retain sync context": "syncContext=syncRuntime&&syncRuntime.baseState",
  "backup deletion sweeps orphan backup image objects": "cleanupCloudBackupAssets",
  "backup orphan sweep waits for a complete valid manifest inventory": "orphan-assets-cleanup-skipped",
  "automatic sync yields to explicit sync import": "skipped:\"manual-import-active\"",
  "reconnect import blocks upload until remote state is checked": "skipped:\"reconnect-import-pending\"",
  "account reconnect imports before scheduling upload": "reconnect-import-complete",
  "account reconnect asks before importing automatic sync": "자동 동기화 데이터를 불러오시겠습니까?",
  "reconnect prompt explains three-way preservation": "이 로컬 환경에서만 새로 만든 데이터는 유지되며, 양쪽에서 각각 수정한 항목만 충돌로 보존합니다.",
  "large standalone sync row is removed at runtime": "syncImportAction?.closest(\".settings-work-row\")?.remove()",
  "automatic and manual backups share one timeline": "data-backup-kind=\"${summary.automatic?\"automatic\":\"manual\"}\"",
  "automatic timeline entry has no delete action": "deleteButton=summary.automatic?\"\"",
  "sync commits retain their cloud image quality": "quality:imageQuality",
  "automatic sync uses the shared workspace projection": "const workspace=SyncStateModel.projectWorkspace(snapshot,profile)",
  "desktop sync carries the shared utility library": "value.utilityLibrary=SyncStateModel.projectUtilityLibrary(snapshot)",
  "desktop workspace apply uses the shared device-local filter": "SyncStateModel.applyWorkspace(target,workspace,SYNC_CLIENT_PROFILES.desktop)",
  "mascot assets join normal sync asset discovery": "payload?.utilityLibrary?.mascotLibrary",
  "backup and sync use shared content addressed objects": "objects/content-v1/",
  "shared content GC waits for unfinished sync transfers": "unfinished-sync-transfer",
  "shared content GC protects incomplete backup objects": "activeSharedObjectKeys",
  "automatic sync carries registered programs and work time": "entities.set(\"work-tracking:main\"",
  "desktop loads the shared sync state model": "<script src=\"./shared/sync-state-model.js\"></script>",
  "desktop cloud commits declare their client profile": "clientProfile=SyncStateModel.clientProfileId(SYNC_CLIENT_PROFILES.desktop)",
  "remote commits apply through their declared client profile": "syncApplyChanges(merged,mergeChanges,commit.clientProfile)",
  "native tracker state is captured before automatic sync": "await syncCaptureWorkTracking();await StateRepository.flush();await SyncRepository.prepareOutbox()",
  "remote work tracking is reapplied through its repository": "await syncApplyWorkTracking(effectiveChangedKeys)",
  "legacy sync commits do not erase widget layout": "syncLegacyLibraryMergeEntries",
  "manual restore explicitly rerenders home widgets": "가져오기 후 홈 위젯 복원",
  "restore dialogs report percentage progress": "불러오는 중 · ${percent}%",
  "first restore warns about initial download time": "처음 불러올 때는 이미지와 데이터를 내려받느라 오래 걸릴 수 있습니다.",
  "backup timeline hides redundant counts": "cloudBackupListStatus.hidden=true",
  "news panel closes from an outside click": "#newsPanel,#newsBtn",
  "timer notification picker exposes custom sound management": "data-notification-sound-add",
  "timer and pomodoro keep separate notification volume controls": "notificationVolume:utilities.notificationVolume,pomodoroVolume:utilities.pomodoroVolume",
  "custom notification assets are tracked by state integrity audit": "state.utilities?.customNotificationSounds",
  "custom notification assets join normal cloud asset discovery": "notificationSounds?.customSounds",
  "remote utility sync refreshes native timer sound settings": "동기화 알림 설정 반영",
  "user-library conflict resolution refreshes native timer sound settings": "await syncUtilityTimerService();safeRunAsync(\"충돌 해결 후 펫 반영\"",
  "user-library conflict resolution downloads selected remote assets before apply": "sync-conflict-assets-not-local",
};
for (const [name, token] of Object.entries(htmlChecks)) check(name, html.includes(token));
const sharedModelChecks = {
  "mobile core profile declares primary mobile screens": "MOBILE_CORE_VISIBLE_ENTITY_TYPES=Object.freeze([\"project\",\"note\",\"mindmap\",\"calendar-event\",\"character\",\"quick-memo\"])",
  "mobile core profile keeps supporting folder character fields and trash": "MOBILE_CORE_SUPPORT_ENTITY_TYPES=Object.freeze([\"folder\",\"character-field-template\",\"trash\"])",
  "mobile core profile excludes desktop workspace and work tracking": "mobileCore:Object.freeze({id:\"mobile-core\"",
  "shared model projects cloud changes per client": "function projectChangesForClient",
  "shared model validates commit writers by client profile": "function applyCommitToCanonical",
  "shared model replays cloud commits into client projections": "function applyCommitToClientState",
  "backup and sync share one cloud user data definition": "CLOUD_USER_DATA_DEFINITION=Object.freeze",
  "shared cloud projection removes quick memo desktop geometry": 'entityType==="quick-memo"&&value&&typeof value==="object")delete value.desktopWidget',
  "shared utility projection separates persistent definitions from runtime": "countdownDefinitions",
  "shared utility projection keeps local music files device-local": '"sound.localTracks"',
  "calendar desktop widget remains device-local in the shared model": 'DEVICE_LOCAL_SETTING_FIELDS=Object.freeze(["calendarDesktopWidget"])',
  "shared utility projection carries custom notification sounds": "customSounds:list(utilities.customNotificationSounds)",
  "shared utility projection carries separate alert volumes": "notificationVolume:Number.isFinite(Number(utilities.notificationVolume))",
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
  "Google Drive sync listing is filtered server-side",
  rust.includes("appProperties has { key=\'hamboardKind\' and value=\'sync\' }"),
);
check(
  "Google Drive separates topology and asset descriptor listings",
  rust.includes('"topology" | "assets"')
    && rust.includes("hamboardSyncType' and value='commit'")
    && rust.includes("hamboardSyncType' and value='asset'"),
);
check(
  "Google Drive backup listing is filtered server-side",
  rust.includes("hamboardKind' and value='manifest'") && rust.includes("name contains 'hamboard-backup-'"),
);
check(
  "Google Drive reusable object index scans only binary assets",
  rust.includes("hamboardKind' and value='asset'") && rust.includes("async fn load_object_index"),
);
check(
  "shared content cleanup is native and bounded",
  rust.includes("pub async fn cleanup_shared_content")
    && rust.includes('remote.object_key.starts_with("objects/content-v1/")')
    && rust.includes("max_delete.clamp(1, 1000)")
    && lib.includes("google_drive::google_drive_cleanup_shared_content"),
);
check(
  "shared content cleanup removes duplicate content-addressed objects",
  rust.includes("async fn list_asset_objects")
    && rust.includes("candidates.into_iter().skip(1).collect::<Vec<_>>()"),
);
check(
  "shared content cleanup gives cross-device uploads a grace window",
  rust.includes("SHARED_CONTENT_GC_GRACE_MS")
    && rust.includes("hamboardCreatedAtMs")
    && rust.includes("remote.created_at_ms == 0 || remote.created_at_ms <= cutoff"),
);
check(
  "non-asset cloud object keys still reject metadata collisions",
  rust.includes("async fn list_remote_objects_by_key")
    && rust.includes("if !candidates.is_empty()")
    && rust.includes("같은 원격 키에 다른 내용이 있어 덮어쓰지 않았습니다"),
);
check(
  "Google Drive cleanup can remove compacted commits and orphan sync assets",
  rust.includes('object_key.starts_with("sync/commits/")')
    && rust.includes('object_key.starts_with("sync/assets/")')
    && rust.includes('object_key.starts_with("sync/blobs/")')
    && rust.includes('object_key.starts_with("sync/thumbs/")'),
);
check(
  "backup orphan asset cleanup is native and content-key based",
  rust.includes("pub async fn cleanup_backup_assets")
    && rust.includes('remote.object_key.starts_with("assets/original/")')
    && lib.includes("google_drive::google_drive_cleanup_backup_assets"),
);
check(
  "sync cleanup resolves duplicate object keys by exact remote metadata",
  rust.includes("async fn find_remote_object_exact")
    && rust.includes("google-drive-exact-list-network-failed")
    && rust.includes("remote.content_sha256 == expected_sha"),
);
check(
  "backup restore preserves optional sync baseline context",
  lib.includes("sync_base_revision: Option<String>")
    && lib.includes("sync_base_state_json: Option<String>")
    && lib.includes("restore_sync_base_state_json"),
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

check(
  "native notification audio service supports per-alert volume and custom decoding",
  lib.includes("struct NotificationAudioService")
    && lib.includes("notificationVolume")
    && lib.includes("pomodoroVolume")
    && lib.includes("validate_notification_sound")
    && lib.includes("notification-sound-fallback-failed"),
);
check(
  "Windows audio decoder dependency is declared",
  cargo.includes('rodio = "0.20.1"'),
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
check(
  "edit lease helpers remain defined after cleanup refactors",
  ["syncActiveLeases","syncSetReadonly","syncCreateLease","syncStartLeaseHeartbeat","syncReleaseOwnLease","syncEnsureLease"].every(name=>html.includes(`function ${name}`)||html.includes(`async function ${name}`)),
);

const betweenCommitReaderIncludesAssetDownload = source => {
  const start = source.indexOf("async function syncReadCommit");
  const end = source.indexOf("async function syncReadCheckpoint", start);
  const chunk = source.slice(start, end);
  return chunk.includes("syncDownloadAssets") || chunk.includes("assetMetadataRows");
};

const syncImportStart = html.indexOf("async function syncImportLatestRemoteState");
const syncImportEnd = html.indexOf("function syncCommitTopology", syncImportStart);
const syncImportSource = html.slice(syncImportStart, syncImportEnd);
check(
  "sync import starts from the newest valid checkpoint",
  syncImportStart >= 0
    && syncImportEnd > syncImportStart
    && syncImportSource.includes('syncCommitTopology(objects,\"\")')
    && syncImportSource.includes("syncReconstructRemoteHead(topology,objects,current,onProgress)"),
);
check(
  "sync import uses base local remote three-way merge",
  syncImportSource.includes("syncMergeRemoteHead(current,remote,runtime")
    && syncImportSource.includes("SyncRepository.applyRemoteState")
    && html.includes('operation:remoteEntry?"upsert":"delete"'),
);
check(
  "sync import downloads assets only after final merge",
  syncImportSource.includes("syncEnsureStateAssets(merge.merged,assetObjects,onProgress)")
    && !betweenCommitReaderIncludesAssetDownload(html),
);

const checkpointPublishStart = html.indexOf("async function syncPublishCheckpoint");
const checkpointPublishEnd = html.indexOf("function syncActiveLeases", checkpointPublishStart);
const checkpointPublishSource = html.slice(checkpointPublishStart, checkpointPublishEnd);
check(
  "sync checkpoints use the common cloud user data projection",
  checkpointPublishSource.includes("SyncStateModel.projectCloudUserData(canonicalState,SYNC_CLIENT_PROFILES.desktop)")
    && checkpointPublishSource.includes("cloudUserDataVersion:SyncStateModel.CLOUD_USER_DATA_VERSION"),
);
check(
  "cloud backup uses common projection plus device delta and collects current assets",
  html.includes("stateReferencedIds=collectCloudStateAssetIds(repositoryState)")
    && html.includes("...CloudPayload.packUserState(repositoryState,SyncStateModel)"),
);
check(
  "local full backup uses paged archive and still reads legacy common data",
  html.includes("backupFormatVersion:3,schemaVersion:SCHEMA_VERSION")
    && html.includes("CloudPayload.unpackUserState(backup,SyncStateModel)"),
);
check(
  "local full backup preserves sync context like cloud backup",
  html.includes('syncContext:CloudPayload.packSyncContext(repositoryState,runtime?.baseState?')
    && html.includes("workTracking,syncContext}"),
);
check(
  "cloud backup restore reapplies the common cloud user data",
  html.includes("CloudPayload.unpackUserState(validated.manifest,SyncStateModel)"),
);

const topologyStart = html.indexOf("function syncCommitTopology");
const topologyEnd = html.indexOf("async function syncPublishCheckpoint", topologyStart);
const topologySource = html.slice(topologyStart, topologyEnd);
check(
  "sync topology keeps two checkpoint anchors before compacting history",
  topologySource.includes("checkpointHits>=2") && topologySource.includes("orphanHeads"),
);
const cleanupStart = html.indexOf("async function syncCleanupRemoteStorage");
const cleanupEnd = html.indexOf("function syncActiveLeases", cleanupStart);
const cleanupSource = html.slice(cleanupStart, cleanupEnd);
check(
  "sync cleanup actually deletes linear commits at or before the second newest checkpoint",
  cleanupSource.includes("index<=cutoffIndex")
    && cleanupSource.includes("cutoffRevision")
    && cleanupSource.indexOf("staleCommits") < cleanupSource.indexOf('assetListing=await GoogleDriveService.listSyncObjects("assets")'),
);
check(
  "sync cleanup retains only two recovery checkpoints",
  cleanupSource.includes("retainedCheckpoints=new Set(checkpoints.slice(0,2)")
    && cleanupSource.includes("staleCheckpoints=syncCheckpointCandidates"),
);
check(
  "sync cleanup retains one descriptor for the active image quality",
  cleanupSource.includes('candidates.find(row=>String(row.descriptor?.quality||row.object.quality||"")===quality)||candidates[0]'),
);
check(
  "shared blobs are deleted only through cross-backup-sync mark and sweep",
  cleanupSource.includes('!key.startsWith("objects/content-v1/")')
    && cleanupSource.includes("cleanupCloudSharedContent"),
);
const syncAssetUploadStart = html.indexOf("async function syncUploadReferencedAssets");
const syncAssetUploadEnd = html.indexOf("let cloudBackupUploadPromise", syncAssetUploadStart);
const syncAssetUploadSource = html.slice(syncAssetUploadStart, syncAssetUploadEnd);
check(
  "sync asset upload excludes unsynced version-history assets",
  syncAssetUploadSource.includes("allIds=syncStateAssetIds(snapshot)")
    && !syncAssetUploadSource.includes("VersionRepository")
    && !syncAssetUploadSource.includes("collectCloudVersionAssetIds"),
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
  const modelHost={};new Function("globalThis",sharedModelSource)(modelHost);const sharedModel=modelHost.HamboardSyncStateModel;
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
  const legacyLibrarySource = html.slice(
    html.indexOf("function syncLegacyLibraryMergeEntries"),
    html.indexOf("async function syncMergeRemoteHead"),
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
  const harness = new Function("initialState", "collections", "sharedModel", `
    const SyncStateModel=sharedModel;
    const SYNC_STATE_COLLECTIONS=collections;
    const SYNC_CLIENT_PROFILES={desktop:{collections:SYNC_STATE_COLLECTIONS,userLibrary:true,workspace:true,workTracking:true}};
    const syncClientProfile=()=>SYNC_CLIENT_PROFILES.desktop;
    const cloneData=value=>structuredClone(value);
    const normalizeSyncWorkTracking=value=>structuredClone(value||{programs:[],daily:[]});
    const sameId=(left,right)=>String(left??"")===String(right??"");
    let state=initialState;
    ${entityMapSource}\n${entityKeySource}\n${changedKeysSource}\n${adoptSource}
    return { changed:syncChangedEntityKeys, adopt:syncAdoptMergedState, state:()=>state };
  `)(initial, collections, sharedModel);
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
  const raceHarness = new Function("initialState", "collections", "sharedModel", `
    const SyncStateModel=sharedModel;
    const SYNC_STATE_COLLECTIONS=collections;
    const SYNC_CLIENT_PROFILES={desktop:{collections:SYNC_STATE_COLLECTIONS,userLibrary:true,workspace:true,workTracking:true}};
    const syncClientProfile=()=>SYNC_CLIENT_PROFILES.desktop;
    const cloneData=value=>structuredClone(value);
    const normalizeSyncWorkTracking=value=>structuredClone(value||{programs:[],daily:[]});
    const sameId=(left,right)=>String(left??"")===String(right??"");
    let state=initialState;
    ${entityMapSource}\n${entityKeySource}\n${changedKeysSource}\n${adoptSource}
    return { changed:syncChangedEntityKeys, adopt:syncAdoptMergedState, state:()=>state };
  `)(raceInitial, collections, sharedModel);
  const localAdded = { id: "note-local-added", value: "local-only" };
  raceInitial.notes.push(localAdded);
  raceInitial.projects = raceInitial.projects.filter(item => item.id !== "project-stable");
  const raceChanged = raceHarness.changed(makeState("race"), raceMerged);
  const preserved = new Set(["note:note-local-added", "project:project-stable"]);
  raceHarness.adopt(raceMerged, raceChanged, preserved);
  check("apply-time local additions survive remote adoption", raceHarness.state().notes.includes(localAdded));
  check("apply-time local deletions survive remote adoption", !raceHarness.state().projects.some(item => item.id === "project-stable"));

  const profileHarness={
    profiles:sharedModel.CLIENT_PROFILES,
    entityMap:(snapshot,profile)=>{const projected=sharedModel.projectCanonicalState(snapshot,profile),map=new Map();for(const [entityType,field] of profile.collections)for(const item of projected[field]||[])map.set(`${entityType}:${item.id}`,{value:item});if(profile.userLibrary)map.set("user-library:main",{value:{tagLibrary:projected.tagLibrary||[],favorites:projected.favorites||[]}});if(profile.workTracking)map.set("work-tracking:main",{value:projected.workTrackingSync});return map},
    empty:(snapshot,profile)=>{const projected=sharedModel.projectCanonicalState(snapshot,profile),changes=[];for(const [entityType,field] of profile.collections)for(const item of projected[field]||[])changes.push({entityType,entityId:String(item.id),operation:"delete",payload:null});if(profile.userLibrary)changes.push({entityType:"user-library",entityId:"main",operation:"upsert",payload:{tagLibrary:[],favorites:[]}});return sharedModel.applyClientChangesToCanonical(snapshot,changes,profile)},
    apply:(snapshot,changes,profile)=>sharedModel.applyChangesToCanonical(snapshot,changes,{profile,strictProfile:false}),
  };
  const mobileState={
    projects:[{id:"project-1"}],notes:[{id:"note-1"}],mindmaps:[{id:"mindmap-1"}],calendarEvents:[{id:"event-1"}],characterRepository:[{id:"character-1"}],quickMemos:[{id:"memo-1",text:"shared memo",desktopWidget:{enabled:true,x:90,y:80,width:320,height:260,alwaysOnTop:true}}],
    folders:[{id:"folder-1"}],characterFieldTemplates:[{id:"field-1"}],trash:[{id:"trash-1"}],storyTemplates:[{id:"template-1",name:"PC template"}],
    tagLibrary:["shared"],favorites:[{type:"project",id:"project-1"}],workTrackingSync:{programs:[{id:"program-1"}],daily:[]},
    homeWidgets:["pc-widget"],homeWidgetPositions:{"pc-widget":{x:1}},homeScheduleWidget:{enabled:true},homeDdayWidget:{eventId:"event-1"},collapsedFolderIds:["folder-1"],newsReadIds:["news-1"],
    settings:{calendarDesktopWidget:{enabled:true,x:111,y:222},workToolModules:["timer"],theme:"cotton-candy"},utilities:{countdownSound:"new-stage",reminderSound:"new-stage",pomodoroSound:"new-stage",sound:{volume:55,ambientVolume:25,noiseType:"brown",shuffle:true,repeat:"all",favorites:[],albums:[],albumTracks:[],packTrackTitles:{},localTracks:[{id:"local-1",fileName:"mine.mp3",label:"Mine"}]},pomodoro:{focusMinutes:30,breakMinutes:7,longBreakMinutes:25,longBreakInterval:4,completedPomodoros:3,mode:"break",remainingSeconds:20,running:true,endAt:9999},countdowns:[{id:"timer-1",title:"Tea",durationSeconds:300,remainingSeconds:17,running:true,endAt:9999}],reminders:[{id:"reminder-1",title:"Stretch",intervalSeconds:3600,enabled:true,nextAt:8888}],mascotCommon:{speechEnabled:false,speechInterval:30,displayMode:"desktop"},mascots:[{id:"pet-1",name:"Local pet",assetId:"asset-1",enabled:true,motion:"static",size:120,dialogues:["local"],x:10,y:20,desktopX:30,desktopY:40}]},
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
  check("mobile applies shared tags and shared theme without desktop workspace", mobileApplied.tagLibrary[0]==="remote"&&mobileApplied.homeWidgets[0]==="pc-widget"&&mobileApplied.settings.theme==="dark");
  check("mobile ignores known deferred desktop changes", mobileApplied.workTrackingSync.programs.length===1&&mobileApplied.storyTemplates.length===1);
  const desktopProjection=sharedModel.projectCanonicalState(mobileState,sharedModel.CLIENT_PROFILES.desktop);
  check("desktop projection excludes calendar desktop widget geometry", !Object.prototype.hasOwnProperty.call(desktopProjection.settings||{},"calendarDesktopWidget"));
  check("desktop mascot projection contains only portable mascot fields", desktopProjection.utilities?.mascotLibrary?.items?.[0]?.name==="Local pet"&&!Object.prototype.hasOwnProperty.call(desktopProjection.utilities.mascotLibrary.items[0],"enabled")&&!Object.prototype.hasOwnProperty.call(desktopProjection.utilities.mascotLibrary.items[0],"desktopX"));
  const mascotOverrideSource={utilities:{mascotCommon:{motion:"bounce",displayMode:"desktop",size:150,speechInterval:45},mascots:[{id:"pet-override",name:"Override pet",assetId:"asset-override",enabled:true,motion:null,displayMode:"app",size:null,speechEnabled:true,speechInterval:20,dialogues:["hello"],x:1,y:2,desktopX:3,desktopY:4}]}};
  const mascotOverrideProjected=sharedModel.projectMascotLibrary(mascotOverrideSource);
  check("mascot projection keeps shared fallback fields while size stays per-pet", mascotOverrideProjected.common.motion==="bounce"&&mascotOverrideProjected.common.displayMode==="desktop"&&!Object.prototype.hasOwnProperty.call(mascotOverrideProjected.common,"size")&&mascotOverrideProjected.common.speechInterval===45&&mascotOverrideProjected.items[0].motion===null&&mascotOverrideProjected.items[0].displayMode==="app"&&mascotOverrideProjected.items[0].size===150&&mascotOverrideProjected.items[0].speechInterval===20&&mascotOverrideProjected.items[0].speechEnabled===true);
  const mascotOverrideLocal={utilities:{mascotCommon:{motion:"static",displayMode:"app",size:120,speechInterval:30},mascots:[{id:"pet-override",name:"Local",assetId:"old",enabled:true,motion:"static",displayMode:"desktop",size:99,speechEnabled:false,speechInterval:10,dialogues:[],x:11,y:22,desktopX:33,desktopY:44}]}};
  sharedModel.applyMascotLibrary(mascotOverrideLocal,mascotOverrideProjected);
  check("mascot apply syncs overrides and direct size while preserving device-local runtime state", mascotOverrideLocal.utilities.mascotCommon.motion==="bounce"&&mascotOverrideLocal.utilities.mascotCommon.displayMode==="desktop"&&!Object.prototype.hasOwnProperty.call(mascotOverrideLocal.utilities.mascotCommon,"size")&&mascotOverrideLocal.utilities.mascots[0].motion===null&&mascotOverrideLocal.utilities.mascots[0].displayMode==="app"&&mascotOverrideLocal.utilities.mascots[0].size===150&&mascotOverrideLocal.utilities.mascots[0].speechEnabled===true&&mascotOverrideLocal.utilities.mascots[0].speechInterval===20&&mascotOverrideLocal.utilities.mascots[0].enabled===true&&mascotOverrideLocal.utilities.mascots[0].x===11&&mascotOverrideLocal.utilities.mascots[0].desktopX===33);
  check("desktop quick memo projection removes desktop widget runtime", !Object.prototype.hasOwnProperty.call(desktopProjection.quickMemos[0],"desktopWidget"));
  check("desktop utility projection excludes active timer runtime and local audio files", !Object.prototype.hasOwnProperty.call(desktopProjection.utilities.countdownDefinitions[0]||{},"running")&&!Object.prototype.hasOwnProperty.call(desktopProjection.utilities.soundPreferences||{},"localTracks"));
  check("mobile projection excludes Windows utility library", !Object.prototype.hasOwnProperty.call(sharedModel.projectCanonicalState(mobileState,sharedModel.CLIENT_PROFILES.mobileCore),"utilities"));
  const mascotApplied=sharedModel.applyClientChangesToCanonical(mobileState,[{entityType:"user-library",entityId:"main",operation:"upsert",payload:{tagLibrary:["shared"],favorites:[],mascotLibrary:{common:{speechEnabled:true,speechInterval:45},items:[{id:"pet-1",name:"Remote pet",assetId:"asset-2",motion:"bounce",size:140,dialogues:["remote"]}]}}}],sharedModel.CLIENT_PROFILES.desktop);
  check("mascot sync updates content while preserving device local runtime state", mascotApplied.utilities.mascots[0].name==="Remote pet"&&mascotApplied.utilities.mascots[0].assetId==="asset-2"&&mascotApplied.utilities.mascots[0].enabled===true&&mascotApplied.utilities.mascots[0].desktopX===30&&mascotApplied.utilities.mascotCommon.displayMode==="desktop");
  const utilityApplied=sharedModel.applyClientChangesToCanonical(mobileState,[{entityType:"user-library",entityId:"main",operation:"upsert",payload:{tagLibrary:["shared"],favorites:[],utilityLibrary:{notificationSounds:{countdownSound:"done",reminderSound:"done",pomodoroSound:"done"},soundPreferences:{volume:75},pomodoroPreset:{focusMinutes:45,breakMinutes:10,longBreakMinutes:30,longBreakInterval:3},countdownDefinitions:[{id:"timer-1",title:"Remote Tea",durationSeconds:600}],reminderDefinitions:[{id:"reminder-1",title:"Remote Stretch",intervalSeconds:1800}],mascotLibrary:sharedModel.projectMascotLibrary(mobileState)}}}],sharedModel.CLIENT_PROFILES.desktop);
  check("utility sync updates persistent definitions while preserving device runtime", utilityApplied.utilities.countdowns[0].title==="Remote Tea"&&utilityApplied.utilities.countdowns[0].durationSeconds===600&&utilityApplied.utilities.countdowns[0].running===true&&utilityApplied.utilities.countdowns[0].remainingSeconds===17&&utilityApplied.utilities.reminders[0].enabled===true&&utilityApplied.utilities.reminders[0].nextAt===8888&&utilityApplied.utilities.pomodoro.running===true&&utilityApplied.utilities.pomodoro.focusMinutes===45&&utilityApplied.utilities.sound.localTracks[0].id==="local-1");
  const memoApplied=sharedModel.applyClientChangesToCanonical(mobileState,[{entityType:"quick-memo",entityId:"memo-1",operation:"upsert",payload:{id:"memo-1",text:"remote memo"}}],sharedModel.CLIENT_PROFILES.desktop);
  check("quick memo sync preserves device-local desktop widget state", memoApplied.quickMemos[0].text==="remote memo"&&memoApplied.quickMemos[0].desktopWidget.x===90&&memoApplied.quickMemos[0].desktopWidget.alwaysOnTop===true);
  const legacyLibraryHarness=new Function("sharedModel","legacySource",`const SyncStateModel=sharedModel,cloneData=value=>structuredClone(value),INITIAL_STATE={utilities:{sound:{},pomodoro:{},countdowns:[],reminders:[],mascotCommon:{speechEnabled:false,speechInterval:30},mascots:[]}},syncEntryWithValue=(entry,value)=>entry?({...entry,value}):entry;eval(legacySource);return syncLegacyLibraryMergeEntries;`)(sharedModel,legacyLibrarySource);
  const legacyBaseMascot={common:{speechEnabled:false,speechInterval:30},items:[{id:"pet-1",name:"Base pet"}]},legacyLocalMascot={common:{speechEnabled:false,speechInterval:30},items:[{id:"pet-1",name:"Local pet changed"}]},legacyRemoteMascot={common:{speechEnabled:true,speechInterval:40},items:[{id:"pet-1",name:"Remote pet changed"}]};
  const legacyResult=legacyLibraryHarness({entityType:"user-library",value:{utilityLibrary:{...sharedModel.projectUtilityLibrary(mobileState),mascotLibrary:legacyLocalMascot},mascotLibrary:legacyLocalMascot}},{entityType:"user-library",value:{utilityLibrary:{...sharedModel.projectUtilityLibrary(mobileState),mascotLibrary:legacyBaseMascot},mascotLibrary:legacyBaseMascot}},{entityType:"user-library",value:{mascotLibrary:legacyRemoteMascot}},true,false,true);
  check("legacy mascot commits keep the real base mascot for three-way conflict detection", legacyResult.baseEntry.value.utilityLibrary.mascotLibrary.items[0].name==="Base pet"&&legacyResult.remoteEntry.value.utilityLibrary.mascotLibrary.items[0].name==="Remote pet changed");
  const mobileCommitProjection=sharedModel.projectChangesForClient([{entityType:"user-library",entityId:"main",operation:"upsert",payload:{tagLibrary:[],favorites:[],workspace:{settings:{theme:"dark",calendarDesktopWidget:{enabled:false}}},utilityLibrary:sharedModel.projectUtilityLibrary(mobileState),mascotLibrary:{common:{speechEnabled:true,speechInterval:30},items:[{id:"pet-x"}]}}}],sharedModel.CLIENT_PROFILES.mobileCore);
  check("mobile commit projection strips desktop utility mascot and widget state", !mobileCommitProjection[0].payload.utilityLibrary&&!mobileCommitProjection[0].payload.mascotLibrary&&!Object.prototype.hasOwnProperty.call(mobileCommitProjection[0].payload.workspace.settings,"calendarDesktopWidget")&&mobileCommitProjection[0].payload.workspace.settings.theme==="dark");

  const topologyHarness=new Function(`${topologySource}; return syncCommitTopology;`)();
  const commit=(n,base)=>({syncType:"commit",revision:`r${n}`,baseRevision:base===null?"":`r${base}`,objectKey:`sync/commits/r${n}.json`,createdAtMs:n});
  const checkpoint=n=>({syncType:"checkpoint",revision:`r${n}`,objectKey:`sync/checkpoints/r${n}.json`,createdAtMs:n});
  let compactObjects=[];for(let n=1;n<=18;n++)compactObjects.push(commit(n,n===1?null:n-1));compactObjects.push(checkpoint(8),checkpoint(16));
  const compactTopology=topologyHarness(compactObjects,"");
  check("compacted topology retains two checkpoint recovery anchors", !compactTopology.error&&compactTopology.path[0]?.revision==="r8"&&compactTopology.path.at(-1)?.revision==="r18");
  check("old device baseline requests rebaseline after compaction", topologyHarness(compactObjects,"r5").error==="base-revision-missing");
  compactObjects=compactObjects.filter(item=>!(item.syncType==="commit"&&["r1","r2","r3","r4","r5"].includes(item.revision)));
  const partialCleanupTopology=topologyHarness(compactObjects,"");
  check("partial cleanup does not turn detached old history into a false branch", !partialCleanupTopology.error&&partialCleanupTopology.head?.revision==="r18");
  compactObjects.push({syncType:"commit",revision:"branch",baseRevision:"r16",objectKey:"sync/commits/branch.json",createdAtMs:19});
  check("real branches after a retained checkpoint are still blocked", topologyHarness(compactObjects,"").error==="branched-history");
} catch (error) {
  failures.push(`sync state adoption behavior: ${error.message}`);
}

if (failures.length) {
  console.error("Hamboard sync final QA failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(`Hamboard sync final QA passed (${checkCount} checks).`);
}
