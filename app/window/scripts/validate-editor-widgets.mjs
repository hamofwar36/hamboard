import { readFile } from "node:fs/promises";
import process from "node:process";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("web/index.html", root), "utf8");
const failures = [];
const check = (name, condition) => { if (!condition) failures.push(name); };
const sourceBetween = (start, end) => {
  const from = html.indexOf(start), to = html.indexOf(end, from + start.length);
  return from >= 0 && to > from ? html.slice(from, to) : "";
};

const scriptStart = html.indexOf("<script>\n", html.indexOf("lucide.min.js"));
const scriptEnd = html.lastIndexOf("</script>");
try { new Function(html.slice(scriptStart + "<script>".length, scriptEnd)); }
catch (error) { failures.push(`main inline JavaScript syntax: ${error.message}`); }

const dom = new JSDOM("<!doctype html><div id='editor'><p id='block'>##기존 <strong>글자</strong></p></div>");
const { document, Node } = dom.window;
const helperSource = sourceBetween("function replaceRichTextBlockPrefix", "function handleRichTextAutoList");
try {
  let richTextSelection = null;
  const replace = new Function("document", "Node", "setSelection", `${helperSource};return (editor,block,selection,range,replacement,contentHost)=>{const value=replaceRichTextBlockPrefix(editor,block,selection,range,replacement,contentHost);setSelection(richTextSelection);return value}`)(document, Node, value => { richTextSelection = value; });
  const editor = document.querySelector("#editor"), block = document.querySelector("#block"), selection = dom.window.getSelection(), range = document.createRange();
  range.setStart(block.firstChild, 2); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
  const heading = document.createElement("h2"); replace(editor, block, selection, range, heading);
  check("heading shortcut preserves suffix text", heading.textContent === "기존 글자");
  check("heading shortcut preserves inline markup", heading.querySelector("strong")?.textContent === "글자");
  check("heading shortcut caret stays before preserved text", selection.anchorNode === heading && selection.anchorOffset === 0);
} catch (error) { failures.push(`heading shortcut behavior: ${error.message}`); }

const imageRangeSource = sourceBetween("function noteImageRangeFromPoint", "async function refreshNoteImageElement");
try {
  const imageDom = new JSDOM("<!doctype html><div id='noteEditor'><p>첫 문장</p><img data-note-image='a'></div>");
  const imageDocument = imageDom.window.document, imageEditor = imageDocument.querySelector("#noteEditor"), first = imageEditor.firstChild;
  first.getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 0, right: 300, width: 300, height: 20 });
  imageDocument.elementFromPoint = () => imageEditor;
  const rangeAt = new Function("document", "Node", `${imageRangeSource};return noteImageRangeFromPoint`)(imageDocument, imageDom.window.Node);
  const range = rangeAt(imageEditor, 20, 80, null);
  check("image can drop before first note block", range?.startContainer === imageEditor && range.startOffset === 0);
  check("first-line image drop has visible marker", imageEditor.classList.contains("note-image-drop-at-start"));
} catch (error) { failures.push(`first-line image drop behavior: ${error.message}`); }

const tokens = {
  "rich and HTML note tabs exist": 'data-note-editor-mode="html"',
  "HTML source exposes its current automatic-save status": 'id="noteSourceStatus"',
  "HTML forced saves use sanitizer": 'commitNoteHtmlSource({switchToRich:false,reason:"forced-save"})',
  "HTML mode reuses Asset cleanup": 'removeUnusedNoteInlineImages(note,html,usedNoteImageIds)',
  "mindmap text has internal scroll": 'overflow-y:auto;overscroll-behavior:contain',
  "mindmap text can grow to a bounded height": 'Math.min(520,current+overflow+10)',
  "standalone block has enlarged editor": 'function openMindmapBlockEditor',
  "standalone block first pointer enters edit": 'editor.onpointerdown=e=>{if(!nodeEl.classList.contains("mindmap-node-text-editing"))enterEdit(e)',
  "paused countdowns remain in widget": '[...utilities.countdowns].sort',
  "paused reminders remain in widget": '[...utilities.reminders].sort',
  "home timer has direct controls": 'data-home-countdown-toggle',
  "work widget can select a registered program": 'data-home-work-target',
  "work widget selection persists compatibly in settings": 'homeWorkTrackingProgramId',
  "document navigation resets main scroll": 'function mainNavigationKey',
  "HTML source has a multiline code shell": 'id="noteSourceLines"',
  "HTML source is formatted by top-level blocks": 'function formatNoteHtmlSource',
  "HTML source supports tab indentation": 'source.setRangeText("  ",start,end,"end")',
  "standalone mindmap blocks preserve existing and pending tags": 'n.tags=tagsEnabled?[...new Set([...draftTags,...pending])]:parseTags(n.tags)',
  "standalone mindmap blocks persist memos": 'n.memos=String',
  "timer widget directly opens pomodoro": 'data-home-timer-section="pomodoro"',
  "timer widget directly opens stopwatch": 'data-home-timer-section="stopwatch"',
  "note images do not receive an automatic border": '#noteEditor img[data-note-image]{display:block;max-width:100%;height:auto;margin:12px auto;border:0;border-radius:0',
  "connected Drive status uses the semantic success surface": '.cloud-provider-status[data-state="connected"]{background:var(--status-success-bg)',
  "connected Drive status pairs its success background and foreground": 'border-color:var(--status-success);color:var(--on-success)',
  "connected Drive status keeps its semantic high contrast exception": 'body[data-theme="high-contrast"] .cloud-provider-status[data-state="connected"]{background:var(--status-success-bg);border-color:var(--status-success);color:var(--on-success)}',
  "local backup is visually ordered last": '.settings-work-row:has(#settingsExport){order:99',
  "restore heading aligns with its timeline": '.settings-work-row:has(#settingsCloudBackupList){align-items:start}',
  "secondary settings navigation is compact": '.settings-section[data-settings-section="diagnostics"] .settings-section-toggle',
  "display settings use the renamed label": 'section("theme","palette","디스플레이",themeBody)',
  "trash permanent delete matches the restore button border": '.trash-permanent{border:1px solid var(--border);background:var(--surface)',
  "data settings use the Google account label": '<strong>Google 계정</strong>',
  "manual backup create label is present": '수동 백업 만들기',
  "manual backup entries have a delete action": 'data-cloud-delete=',
  "manual backup delete requires confirmation": 'function openCloudBackupDeleteConfirmation',
  "manual backup delete reuses manifest cleanup": 'await deleteChosenCloudBackups([entry])',
  "signed-out cloud settings use a dedicated CTA": 'id="settingsGoogleDriveCta" class="cloud-connect-cta"',
  "signed-out CTA explains app-only Drive storage": '저장된 데이터는 햄보드 앱 전용이므로, Google Drive에서 직접 열어볼 수 없습니다.',
  "signed-in cloud settings start hidden": 'id="settingsCloudSettings" class="cloud-settings-group" hidden',
  "Drive status switches signed-out and signed-in regions": 'googleDriveCta.hidden=connected;if(cloudSettings)cloudSettings.hidden=!connected',
  "manual backup create uses cloud upload icon": 'lucideIcon("cloud-upload")',
  "manual backup restore uses cloud download icon": 'lucideIcon("cloud-download")',
  "connected account copy omits automatic-sync onboarding text": '<strong>Google 계정</strong><span id="settingsGoogleDriveHelp" class="cloud-account-note">',
};
for (const [name, token] of Object.entries(tokens)) check(name, html.includes(token));
check("old heading replacement no longer deletes the whole block", !html.includes('target.appendChild(document.createElement("br"));blockNode.replaceWith(target)'));
check("old list replacement no longer deletes the whole block", !html.includes('item.appendChild(document.createElement("br"));list.appendChild(item);block.replaceWith(list)'));
check("hidden title keyboard action was removed", !html.includes('.home-widget-title[role=\'button\']'));

if (failures.length) {
  console.error("Hamboard editor/widget QA failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(`Hamboard editor/widget QA passed (${Object.keys(tokens).length + 7} checks).`);
}
