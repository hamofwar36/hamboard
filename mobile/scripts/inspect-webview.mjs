const endpoint = process.env.HAMBOARD_CDP_ENDPOINT ?? "http://127.0.0.1:9223/json";
const timeoutAt = Date.now() + 20_000;

let targets;
while (Date.now() < timeoutAt) {
  try {
    const response = await fetch(endpoint);
    targets = await response.json();
    if (targets.some((target) => target.webSocketDebuggerUrl)) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const target = targets?.find((item) => item.type === "page" && item.webSocketDebuggerUrl)
  ?? targets?.find((item) => item.webSocketDebuggerUrl);
if (!target) throw new Error(`WebView CDP target not found at ${endpoint}`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const diagnostics = {
  consoleErrors: [],
  exceptions: [],
  logErrors: [],
  failedRequests: [],
  httpErrors: []
};

socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    diagnostics.consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
  } else if (message.method === "Runtime.exceptionThrown") {
    diagnostics.exceptions.push(message.params.exceptionDetails.text);
  } else if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    diagnostics.logErrors.push(message.params.entry.text);
  } else if (message.method === "Network.loadingFailed") {
    diagnostics.failedRequests.push({ url: message.params.requestId, error: message.params.errorText });
  } else if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
    diagnostics.httpErrors.push({ url: message.params.response.url, status: message.params.response.status });
  }
});

function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await Promise.all([
  send("Runtime.enable"),
  send("Log.enable"),
  send("Network.enable"),
  send("Page.enable")
]);
await send("Page.reload", { ignoreCache: false });
await new Promise((resolve) => setTimeout(resolve, 5_000));

const defaultExpression = `(async () => ({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    appPresent: !!document.querySelector('.app'),
    activeView: document.querySelector('.view.active')?.id ?? null,
    repositories: {
      state: typeof StateRepository,
      version: typeof VersionRepository,
      asset: typeof AssetRepository
    },
    sqliteStateRows: (await (await window.__TAURI__.sql.load('sqlite:hamboard.db')).select(
      'SELECT state_key, updated_at FROM app_state WHERE state_key = $1',
      ['hamboard.state.v1']
    )).length,
    versionRecordCount: (await VersionRepository.listAll()).length,
    assetRecordCount: (await AssetRepository.list()).length
  }))()`;
const evaluation = await send("Runtime.evaluate", {
  expression: process.env.HAMBOARD_CDP_EXPRESSION ?? defaultExpression,
  awaitPromise: true,
  returnByValue: true
});

console.log(JSON.stringify({
  target: { title: target.title, url: target.url },
  page: evaluation.result.value,
  evaluationException: evaluation.exceptionDetails?.text ?? null,
  diagnostics
}, null, 2));
socket.close();
