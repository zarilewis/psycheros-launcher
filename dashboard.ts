/**
 * Psycheros Web Dashboard
 *
 * A browser-based GUI for installing, updating, and running Psycheros.
 * No CLI needed — just run this file with Deno and click buttons.
 */

// --- Constants ---

const PSYCHEROS_REPO = "zarilewis/Psycheros-alpha";
const ENTITY_CORE_REPO = "zarilewis/entity-core-alpha";
const PORT = 3001;
const MAX_LOG_LINES = 500;

// --- State ---

let psycherosProcess: Deno.ChildProcess | null = null;
let isRunning = false;
let hasGit = false;
const logBuffer: string[] = [];
const logListeners = new Set<(entry: string) => void>();

// --- Settings ---

interface Settings {
  installDir: string;
  userName: string;
  entityName: string;
  timezone: string;
}

function resolveHome(p: string): string {
  if (p.startsWith("~")) {
    const home = Deno.build.os === "windows"
      ? (Deno.env.get("USERPROFILE") || `${Deno.env.get("HOMEDRIVE") || ""}${Deno.env.get("HOMEPATH") || ""}`)
      : (Deno.env.get("HOME") || "");
    return p.replace("~", home);
  }
  return p;
}

function defaultSettings(): Settings {
  return {
    installDir: resolveHome("~/psycheros"),
    userName: "You",
    entityName: "Assistant",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function getDashboardStatePath(): string {
  return `${resolveHome("~/.psycheros-launcher-state.json")}`;
}

function pathJoin(...parts: string[]): string {
  const sep = Deno.build.os === "windows" ? "\\" : "/";
  return parts.join(sep);
}

function loadSettings(): Settings {
  try {
    const statePath = getDashboardStatePath();
    const state = JSON.parse(Deno.readTextFileSync(statePath));
    if (state.installDir) {
      const settingsFile = pathJoin(state.installDir, "Psycheros", ".psycheros", "general-settings.json");
      try {
        const saved = JSON.parse(Deno.readTextFileSync(settingsFile));
        return {
          installDir: state.installDir,
          userName: saved.userName || "You",
          entityName: saved.entityName || "Assistant",
          timezone: saved.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      } catch {
        return defaultSettings();
      }
    }
  } catch {
    // No state file yet
  }
  return defaultSettings();
}

function saveDashboardState(installDir: string): void {
  try {
    Deno.writeTextFileSync(getDashboardStatePath(), JSON.stringify({ installDir }, null, 2));
  } catch {
    // Ignore
  }
}

function savePsycherosSettings(settings: Settings): void {
  const dir = pathJoin(settings.installDir, "Psycheros", ".psycheros");
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(
    pathJoin(dir, "general-settings.json"),
    JSON.stringify({
      entityName: settings.entityName,
      userName: settings.userName,
      timezone: settings.timezone,
    }, null, 2) + "\n",
  );
}

// --- Logging ---

function appendLog(text: string): void {
  const lines = text.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const timestamped = `[${new Date().toLocaleTimeString()}] ${line}`;
    logBuffer.push(timestamped);
    if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
    for (const listener of logListeners) {
      try { listener(timestamped); } catch { /* client gone */ }
    }
  }
}

// --- Command execution ---

async function runCommand(cmd: string, args: string[], cwd?: string): Promise<{ code: number; output: string }> {
  appendLog(`> ${cmd} ${args.join(" ")}`);
  const command = new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();

  const stdout = new TextDecoder();
  const stderr = new TextDecoder();
  let output = "";

  const readStream = async (stream: ReadableStream<Uint8Array>, decoder: TextDecoder) => {
    const reader = stream.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      output += text;
      appendLog(text);
    }
    const final = decoder.decode();
    if (final) { output += final; appendLog(final); }
  };

  await Promise.all([
    readStream(child.stdout!, stdout),
    readStream(child.stderr!, stderr),
  ]);

  const status = await child.status;
  return { code: status.code, output };
}

// --- Prerequisites check ---

async function checkPrerequisites(): Promise<{ git: boolean; deno: boolean }> {
  let deno = false;
  try {
    const r = await runCommand("git", ["--version"]);
    hasGit = r.code === 0;
  } catch { hasGit = false; }
  try {
    const r = await runCommand("deno", ["--version"]);
    deno = r.code === 0;
  } catch { /* not found */ }
  return { git: hasGit, deno };
}

// --- Clone / update repos ---

async function cloneOrUpdate(repoUrl: string, name: string, targetDir: string): Promise<boolean> {
  const gitDir = pathJoin(targetDir, ".git");
  let exists = false;
  try {
    exists = (await Deno.stat(gitDir)).isDirectory;
  } catch { /* doesn't exist */ }

  // Check for directory without git (downloaded via tarball)
  if (!exists) {
    try {
      exists = (await Deno.stat(targetDir)).isDirectory;
    } catch { /* doesn't exist */ }
  }

  if (exists && hasGit) {
    appendLog(`${name} already exists, updating...`);
    const r = await runCommand("git", ["-C", targetDir, "pull", "--ff-only"]);
    return r.code === 0;
  } else if (hasGit) {
    appendLog(`Cloning ${name}...`);
    const r = await runCommand("git", ["clone", `https://github.com/${repoUrl}.git`, targetDir]);
    return r.code === 0;
  } else {
    return await downloadRepo(repoUrl, name, targetDir);
  }
}

async function downloadRepo(repoSlug: string, name: string, targetDir: string): Promise<boolean> {
  appendLog(`Downloading ${name}...`);
  try {
    const tarUrl = `https://github.com/${repoSlug}/archive/refs/heads/main.tar.gz`;
    const response = await fetch(tarUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const tarData = new Uint8Array(await response.arrayBuffer());

    // Decompress gzip
    const decompressed = new Uint8Array(await new Response(
      new Response(tarData).body!.pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer());

    // Parse tar and extract
    let offset = 0;
    while (offset < decompressed.length - 512) {
      // Read header
      const nameBytes = decompressed.slice(offset, offset + 100);
      const nameStr = new TextDecoder().decode(nameBytes).replace(/\0.*$/, "");
      const sizeOctal = new TextDecoder().decode(decompressed.slice(offset + 124, offset + 136)).replace(/\0/g, "").trim();
      const typeFlag = decompressed[offset + 156];
      const size = parseInt(sizeOctal || "0", 8);

      if (!nameStr || nameStr.endsWith("/")) {
        offset += 512;
        continue;
      }

      offset += 512;
      if (size > 0) {
        // Extract just the filename (strip the repo-branch prefix)
        const parts = nameStr.split("/");
        const localName = parts.slice(1).join("/");
        const localPath = localName ? pathJoin(targetDir, localName) : targetDir;
        const dir = pathJoin(localPath, "..");

        try { Deno.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
        Deno.writeFileSync(localPath, decompressed.slice(offset, offset + size));
        offset += 512 * Math.ceil(size / 512);
      }
    }
    appendLog(`${name} downloaded.`);
    return true;
  } catch (e) {
    appendLog(`Failed to download ${name}: ${e}`);
    return false;
  }
}

// --- Process management ---

async function streamProcessOutput(process: Deno.ChildProcess): Promise<void> {
  isRunning = true;
  const readStream = async (stream: ReadableStream<Uint8Array>, label: string) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      appendLog(text);
    }
    const final = decoder.decode();
    if (final) appendLog(final);
  };

  await Promise.all([
    readStream(process.stdout!, "stdout"),
    readStream(process.stderr!, "stderr"),
  ]);

  const status = await process.status;
  appendLog(`Psycheros exited with code ${status.code}`);
  psycherosProcess = null;
  isRunning = false;
}

async function startPsycheros(installDir: string): Promise<{ success: boolean; message: string }> {
  if (isRunning) {
    return { success: false, message: "Psycheros is already running." };
  }
  const psycherosDir = pathJoin(installDir, "Psycheros");
  try {
    await Deno.stat(psycherosDir);
  } catch {
    return { success: false, message: "Psycheros not installed. Click Install first." };
  }

  appendLog("Starting Psycheros...");
  const command = new Deno.Command("deno", {
    args: ["task", "start"],
    cwd: psycherosDir,
    stdout: "piped",
    stderr: "piped",
  });
  psycherosProcess = command.spawn();
  streamProcessOutput(psycherosProcess);
  return { success: true, message: "Psycheros is starting..." };
}

async function stopPsycheros(): Promise<{ success: boolean; message: string }> {
  if (!psycherosProcess || !isRunning) {
    return { success: false, message: "Psycheros is not running." };
  }

  appendLog("Stopping Psycheros...");
  try {
    psycherosProcess.kill("SIGINT");
  } catch {
    try {
      psycherosProcess.kill("SIGTERM");
    } catch {
      // On Windows, fall back to taskkill
      if (Deno.build.os === "windows" && psycherosProcess.pid) {
        try {
          await runCommand("taskkill", ["/pid", psycherosProcess.pid.toString(), "/f", "/t"]);
        } catch { /* give up */ }
      }
    }
  }

  // Wait up to 5 seconds for graceful exit
  try {
    await Promise.race([
      psycherosProcess.status,
      new Promise((_, reject) => setTimeout(() => reject("timeout"), 5000)),
    ]);
  } catch {
    if (psycherosProcess) {
      try { psycherosProcess.kill("SIGKILL"); } catch { /* ignore */ }
      if (Deno.build.os === "windows" && psycherosProcess.pid) {
        try {
          await runCommand("taskkill", ["/pid", psycherosProcess.pid.toString(), "/f", "/t"]);
        } catch { /* ignore */ }
      }
    }
  }

  psycherosProcess = null;
  isRunning = false;
  appendLog("Psycheros stopped.");
  return { success: true, message: "Psycheros stopped." };
}

// --- Request handling ---

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
    });
  }

  // --- API routes ---

  if (path === "/api/status") {
    return json({ running: isRunning });
  }

  if (path === "/api/prerequisites") {
    const prereqs = await checkPrerequisites();
    return json(prereqs);
  }

  if (path === "/api/settings" && req.method === "GET") {
    return json(loadSettings());
  }

  if (path === "/api/logs") {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        // Send buffered logs
        for (const line of logBuffer) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: line })}\n\n`));
        }
        // Register for future logs
        const listener = (entry: string) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: entry })}\n\n`));
          } catch {
            logListeners.delete(listener);
          }
        };
        logListeners.add(listener);
      },
      cancel() {
        // Clean up is handled by the try/catch in the listener
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" },
    });
  }

  if (path === "/api/install" && req.method === "POST") {
    const body = await req.json() as Partial<Settings>;

    const settings: Settings = {
      installDir: body.installDir ? resolveHome(body.installDir) : defaultSettings().installDir,
      userName: body.userName || "You",
      entityName: body.entityName || "Assistant",
      timezone: body.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    appendLog(`Installing to ${settings.installDir}...`);
    Deno.mkdirSync(settings.installDir, { recursive: true });

    const psycherosDir = pathJoin(settings.installDir, "Psycheros");
    const entityCoreDir = pathJoin(settings.installDir, "entity-core");

    const ok1 = await cloneOrUpdate(PSYCHEROS_REPO, "Psycheros", psycherosDir);
    if (!ok1) {
      return json({ success: false, message: "Failed to clone Psycheros." }, 500);
    }

    const ok2 = await cloneOrUpdate(ENTITY_CORE_REPO, "entity-core", entityCoreDir);
    if (!ok2) {
      return json({ success: false, message: "Failed to clone entity-core." }, 500);
    }

    savePsycherosSettings(settings);
    saveDashboardState(settings.installDir);
    appendLog("Installation complete!");
    return json({ success: true, message: "Installation complete!" });
  }

  if (path === "/api/update" && req.method === "POST") {
    const settings = loadSettings();
    if (!settings.installDir) {
      return json({ success: false, message: "Not installed yet." });
    }
    const psycherosDir = pathJoin(settings.installDir, "Psycheros");
    const entityCoreDir = pathJoin(settings.installDir, "entity-core");

    if (hasGit) {
      appendLog("Updating Psycheros...");
      const r1 = await runCommand("git", ["-C", psycherosDir, "pull", "--ff-only"]);
      if (r1.code !== 0) {
        return json({ success: false, message: "Failed to update Psycheros." }, 500);
      }

      appendLog("Updating entity-core...");
      const r2 = await runCommand("git", ["-C", entityCoreDir, "pull", "--ff-only"]);
      if (r2.code !== 0) {
        return json({ success: false, message: "Failed to update entity-core." }, 500);
      }
    } else {
      appendLog("Git not available — re-downloading Psycheros...");
      const ok1 = await downloadRepo(PSYCHEROS_REPO, "Psycheros", psycherosDir);
      if (!ok1) {
        return json({ success: false, message: "Failed to update Psycheros." }, 500);
      }

      appendLog("Re-downloading entity-core...");
      const ok2 = await downloadRepo(ENTITY_CORE_REPO, "entity-core", entityCoreDir);
      if (!ok2) {
        return json({ success: false, message: "Failed to update entity-core." }, 500);
      }
    }

    appendLog("Update complete!");
    return json({ success: true, message: "Update complete!" });
  }

  if (path === "/api/start" && req.method === "POST") {
    const settings = loadSettings();
    const result = await startPsycheros(settings.installDir);
    return json(result);
  }

  if (path === "/api/stop" && req.method === "POST") {
    const result = await stopPsycheros();
    return json(result);
  }

  // --- Serve dashboard HTML ---
  if (path === "/" || path === "/index.html") {
    return new Response(getHTML(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return json({ error: "Not found" }, 404);
}

// --- HTML Dashboard ---

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Psycheros Launcher</title>
<style>
  :root {
    --bg: #0f0f1a;
    --surface: #1a1a2e;
    --surface2: #252540;
    --border: #333355;
    --text: #e0e0e0;
    --text-dim: #8888aa;
    --green: #22c55e;
    --red: #ef4444;
    --blue: #3b82f6;
    --yellow: #eab308;
    --radius: 10px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; padding: 20px; }
  .container { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--red); flex-shrink: 0; }
  .status-dot.running { background: var(--green); }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
  .card-title { font-size: 0.85rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 14px; }

  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 16px; border: none; border-radius: 8px; font-size: 0.95rem; font-weight: 500; cursor: pointer; transition: opacity 0.15s, transform 0.1s; }
  .btn:hover:not(:disabled) { opacity: 0.85; }
  .btn:active:not(:disabled) { transform: scale(0.98); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-install { background: var(--blue); color: #fff; }
  .btn-update { background: #6366f1; color: #fff; }
  .btn-start { background: var(--green); color: #fff; }
  .btn-stop { background: var(--red); color: #fff; }

  .spinner { width: 16px; height: 16px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin 0.6s linear infinite; display: none; }
  .btn.loading .spinner { display: block; }
  .btn.loading .btn-label { display: none; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .form { display: flex; flex-direction: column; gap: 12px; }
  .field label { display: block; font-size: 0.85rem; color: var(--text-dim); margin-bottom: 4px; }
  .field input, .field select { width: 100%; padding: 10px 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.9rem; }
  .field input:focus, .field select:focus { outline: none; border-color: var(--blue); }
  .btn-save { align-self: flex-start; padding: 8px 20px; background: var(--surface2); border: 1px solid var(--border); color: var(--text); border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
  .btn-save:hover { background: var(--border); }

  .log-panel { background: #0a0a14; border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-family: "SF Mono", "Cascadia Code", "Consolas", monospace; font-size: 0.8rem; color: var(--text-dim); height: 220px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; line-height: 1.5; }
  .log-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .btn-clear { background: none; border: 1px solid var(--border); color: var(--text-dim); border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 0.75rem; }
  .btn-clear:hover { color: var(--text); border-color: var(--text-dim); }

  .prereq-warn { background: #3b1c1c; border: 1px solid #6b2c2c; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; color: #fca5a5; font-size: 0.85rem; display: none; }

  .toast { position: fixed; bottom: 20px; right: 20px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 20px; color: var(--text); font-size: 0.9rem; opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 100; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<div class="container">
  <h1><span class="status-dot" id="statusDot"></span> Psycheros Launcher</h1>

  <div class="prereq-warn" id="prereqWarn"></div>

  <div class="card">
    <div class="card-title">Actions</div>
    <div class="actions">
      <button class="btn btn-install" id="btnInstall" onclick="doInstall()">
        <div class="spinner"></div><span class="btn-label">Install</span>
      </button>
      <button class="btn btn-update" id="btnUpdate" onclick="doUpdate()">
        <div class="spinner"></div><span class="btn-label">Update</span>
      </button>
      <button class="btn btn-start" id="btnStart" onclick="doStart()">
        <div class="spinner"></div><span class="btn-label">Start</span>
      </button>
      <button class="btn btn-stop" id="btnStop" onclick="doStop()">
        <div class="spinner"></div><span class="btn-label">Stop</span>
      </button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Settings</div>
    <div class="form">
      <div class="field">
        <label>Install directory</label>
        <input type="text" id="installDir" placeholder="~/psycheros">
      </div>
      <div class="field">
        <label>Your name</label>
        <input type="text" id="userName" placeholder="You">
      </div>
      <div class="field">
        <label>Entity's name</label>
        <input type="text" id="entityName" placeholder="Assistant">
      </div>
      <div class="field">
        <label>Timezone</label>
        <input type="text" id="timezone" placeholder="America/New_York" list="tz-list">
        <datalist id="tz-list">
          <option value="America/New_York"><option value="America/Chicago"><option value="America/Denver">
          <option value="America/Los_Angeles"><option value="America/Anchorage"><option value="Pacific/Honolulu">
          <option value="Europe/London"><option value="Europe/Paris"><option value="Europe/Berlin">
          <option value="Asia/Tokyo"><option value="Asia/Shanghai"><option value="Asia/Kolkata">
          <option value="Australia/Sydney"><option value="Pacific/Auckland"><option value="UTC">
        </datalist>
      </div>
      <button class="btn-save" onclick="doSaveSettings()">Save Settings</button>
    </div>
  </div>

  <div class="card">
    <div class="log-header">
      <div class="card-title" style="margin:0">Log</div>
      <button class="btn-clear" onclick="clearLog()">Clear</button>
    </div>
    <div class="log-panel" id="logPanel"></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
  let busy = false;

  function setBusy(btn, state) {
    if (state) {
      btn.classList.add("loading");
      btn.disabled = true;
      busy = true;
      setAllButtons(true);
    } else {
      btn.classList.remove("loading");
      busy = false;
      setAllButtons(false);
    }
  }

  function setAllButtons(disabled) {
    if (!busy && !disabled) disabled = false;
    document.getElementById("btnInstall").disabled = disabled;
    document.getElementById("btnUpdate").disabled = disabled;
    document.getElementById("btnStart").disabled = disabled || document.getElementById("statusDot").classList.contains("running");
    document.getElementById("btnStop").disabled = disabled || !document.getElementById("statusDot").classList.contains("running");
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3000);
  }

  function clearLog() {
    document.getElementById("logPanel").textContent = "";
  }

  async function doInstall() {
    if (busy) return;
    const btn = document.getElementById("btnInstall");
    setBusy(btn, true);
    try {
      const res = await fetch("/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installDir: document.getElementById("installDir").value,
          userName: document.getElementById("userName").value,
          entityName: document.getElementById("entityName").value,
          timezone: document.getElementById("timezone").value,
        }),
      });
      const data = await res.json();
      toast(data.success ? data.message : "Error: " + data.message);
    } catch (e) { toast("Request failed."); }
    setBusy(btn, false);
  }

  async function doUpdate() {
    if (busy) return;
    const btn = document.getElementById("btnUpdate");
    setBusy(btn, true);
    try {
      const res = await fetch("/api/update", { method: "POST" });
      const data = await res.json();
      toast(data.success ? data.message : "Error: " + data.message);
    } catch (e) { toast("Request failed."); }
    setBusy(btn, false);
  }

  async function doStart() {
    if (busy) return;
    const btn = document.getElementById("btnStart");
    setBusy(btn, true);
    try {
      const res = await fetch("/api/start", { method: "POST" });
      const data = await res.json();
      toast(data.success ? data.message : "Error: " + data.message);
    } catch (e) { toast("Request failed."); }
    setBusy(btn, false);
  }

  async function doStop() {
    if (busy) return;
    const btn = document.getElementById("btnStop");
    setBusy(btn, true);
    try {
      const res = await fetch("/api/stop", { method: "POST" });
      const data = await res.json();
      toast(data.success ? data.message : "Error: " + data.message);
    } catch (e) { toast("Request failed."); }
    setBusy(btn, false);
  }

  async function doSaveSettings() {
    try {
      const res = await fetch("/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installDir: document.getElementById("installDir").value,
          userName: document.getElementById("userName").value,
          entityName: document.getElementById("entityName").value,
          timezone: document.getElementById("timezone").value,
        }),
      });
      const data = await res.json();
      toast(data.success ? "Settings saved." : "Error: " + data.message);
    } catch (e) { toast("Failed to save settings."); }
  }

  // Load settings on startup
  fetch("/api/settings").then(r => r.json()).then(s => {
    document.getElementById("installDir").value = s.installDir || "";
    document.getElementById("userName").value = s.userName || "You";
    document.getElementById("entityName").value = s.entityName || "Assistant";
    document.getElementById("timezone").value = s.timezone || "";
  });

  // Check prerequisites
  fetch("/api/prerequisites").then(r => r.json()).then(p => {
    if (!p.deno) {
      const warn = document.getElementById("prereqWarn");
      warn.textContent = "Deno is not installed. This should not happen — run.ps1 / run.sh should have installed it. Try restarting.";
      warn.style.display = "block";
      document.getElementById("btnInstall").disabled = true;
    } else if (!p.git) {
      const warn = document.getElementById("prereqWarn");
      warn.textContent = "Git is not installed. Updates will download repos directly instead of using git pull.";
      warn.style.display = "block";
      warn.style.background = "#1c2b3b";
      warn.style.borderColor = "#2c4b6b";
      warn.style.color = "#93c5fd";
    }
  });

  // Poll status every 3 seconds
  function pollStatus() {
    fetch("/api/status").then(r => r.json()).then(s => {
      const dot = document.getElementById("statusDot");
      if (s.running) { dot.classList.add("running"); } else { dot.classList.remove("running"); }
      setAllButtons(false);
    });
  }
  pollStatus();
  setInterval(pollStatus, 3000);

  // Connect to log stream
  const logPanel = document.getElementById("logPanel");
  const es = new EventSource("/api/logs");
  es.onmessage = (e) => {
    const { text } = JSON.parse(e.data);
    logPanel.textContent += text + "\\n";
    logPanel.scrollTop = logPanel.scrollHeight;
  };
</script>
</body>
</html>`;
}

// --- Auto-open browser ---

function openBrowser(): void {
  const url = `http://localhost:${PORT}`;
  setTimeout(() => {
    try {
      if (Deno.build.os === "darwin") {
        new Deno.Command("open", { args: [url] }).spawn();
      } else if (Deno.build.os === "windows") {
        new Deno.Command("cmd", { args: ["/c", "start", url] }).spawn();
      } else {
        new Deno.Command("xdg-open", { args: [url] }).spawn();
      }
    } catch { /* ignore */ }
  }, 1000);
}

// --- Start ---

Deno.serve({ port: PORT }, handleRequest);
appendLog(`Dashboard running at http://localhost:${PORT}`);
openBrowser();
