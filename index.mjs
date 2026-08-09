import { spawnSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const SUPPORTED_AGENTS = new Set(["claude", "codex", "kimi", "opencode"]);
const HERDR = process.env.HERDR_BIN_PATH || "herdr";

export function sanitizeTitle(raw, maxBytes = 200) {
  const value = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return undefined;

  const bytes = Buffer.from(value);
  if (bytes.length <= maxBytes) return value;

  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8").trimEnd() || undefined;
}

async function readJsonLines(path, visit) {
  if (!path || !existsSync(path)) return;
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      // Agents may leave one partial JSONL line while writing.
      continue;
    }
    visit(row);
  }
}

export async function claudeTitle(sessionId, configRoot = claudeRoot()) {
  const transcript = findClaudeTranscript(sessionId, configRoot);
  if (!transcript) return undefined;

  let title;
  let custom = false;
  await readJsonLines(transcript, (row) => {
    if (row.sessionId && row.sessionId !== sessionId) return;
    if (row.type === "custom-title") {
      custom = true;
      title = sanitizeTitle(row.customTitle);
    } else if (row.type === "ai-title" && !custom) {
      title = sanitizeTitle(row.aiTitle);
    }
  });
  return title;
}

function findClaudeTranscript(sessionId, configRoot) {
  if (!sessionId || !configRoot) return undefined;
  const projects = join(configRoot, "projects");
  if (!existsSync(projects)) return undefined;

  for (const entry of readdirSync(projects, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(projects, entry.name, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export async function codexTitle(sessionId, codexRoot = defaultCodexRoot()) {
  let title;
  await readJsonLines(join(codexRoot, "session_index.jsonl"), (row) => {
    if (row.id === sessionId) title = sanitizeTitle(row.thread_name);
  });
  return title;
}

export async function kimiTitle(sessionId, kimiRoot = defaultKimiRoot()) {
  let sessionDir;
  await readJsonLines(join(kimiRoot, "session_index.jsonl"), (row) => {
    if (row.sessionId === sessionId && typeof row.sessionDir === "string") {
      sessionDir = row.sessionDir;
    }
  });
  if (!sessionDir) return undefined;

  const trustedDir = trustedChild(kimiRoot, sessionDir);
  if (!trustedDir) return undefined;
  const statePath = join(trustedDir, "state.json");
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const stored = sanitizeTitle(state.title);
    if (stored) return stored;
  } catch {
    // Newer Kimi versions omit titles from state.json.
  }

  let firstPrompt;
  await readJsonLines(join(trustedDir, "agents", "main", "wire.jsonl"), (row) => {
    if (firstPrompt || row.type !== "turn.prompt" || row.origin?.kind !== "user") return;
    const text = Array.isArray(row.input)
      ? row.input.find((part) => typeof part?.text === "string")?.text
      : undefined;
    firstPrompt = sanitizeTitle(text, 80);
  });
  return firstPrompt;
}

function trustedChild(root, candidate) {
  try {
    const trustedRoot = realpathSync(root);
    const child = realpathSync(resolve(root, candidate));
    const pathFromRoot = relative(trustedRoot, child);
    return pathFromRoot && !pathFromRoot.startsWith("..") ? child : undefined;
  } catch {
    return undefined;
  }
}

export function opencodeTitle(sessionId, databasePath) {
  const path = databasePath || findOpenCodeDatabase();
  if (!sessionId || !path || !existsSync(path)) return undefined;

  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database.prepare("SELECT title FROM session WHERE id = ?").get(sessionId);
    return sanitizeTitle(row?.title);
  } finally {
    database.close();
  }
}

function findOpenCodeDatabase() {
  if (process.env.OPENCODE_DB_PATH) return process.env.OPENCODE_DB_PATH;
  const result = spawnSync("opencode", ["db", "path"], {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true,
  });
  const reported = result.status === 0 ? result.stdout.trim() : "";
  if (reported) return reported;

  const dataRoot = process.env.XDG_DATA_HOME ||
    (platform() === "win32" ? process.env.APPDATA : join(homedir(), ".local", "share"));
  return dataRoot ? join(dataRoot, "opencode", "opencode.db") : undefined;
}

function claudeRoot() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

function defaultCodexRoot() {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

function defaultKimiRoot() {
  return process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
}

export async function titleForPane(pane, paths = {}) {
  const agent = String(pane?.agent || pane?.agent_session?.agent || "").toLowerCase();
  if (!SUPPORTED_AGENTS.has(agent)) return undefined;
  const sessionId = pane.agent_session?.kind === "id" ? pane.agent_session.value : undefined;

  let title;
  try {
    if (sessionId && agent === "claude") {
      title = await claudeTitle(sessionId, paths.claudeRoot);
    } else if (sessionId && agent === "codex") {
      title = await codexTitle(sessionId, paths.codexRoot);
    } else if (sessionId && agent === "kimi") {
      title = await kimiTitle(sessionId, paths.kimiRoot);
    } else if (sessionId && agent === "opencode") {
      title = opencodeTitle(sessionId, paths.opencodeDb);
    }
  } catch (error) {
    console.error(`${agent} title lookup failed: ${error.message}`);
  }

  return title || terminalTitle(pane, agent);
}

function terminalTitle(pane, agent) {
  if (!new Set(["claude", "kimi", "opencode"]).has(agent)) return undefined;
  let title = String(pane.terminal_title_stripped || pane.terminal_title || "");
  title = title.replace(/^[✳✢·…]\s*/u, "").replace(/^OC\s*\|\s*/i, "");
  title = sanitizeTitle(title);
  if (!title) return undefined;

  const generic = new Set(["claude", "claude code", "kimi", "kimi code", "opencode"]);
  const cwdName = pane.foreground_cwd || pane.cwd ? basename(pane.foreground_cwd || pane.cwd) : "";
  if (generic.has(title.toLowerCase()) || title === cwdName) return undefined;
  return title;
}

function runHerdr(args) {
  const result = spawnSync(HERDR, args, {
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${HERDR} ${args.join(" ")} exited ${result.status}`);
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function paneStatePath(paneId) {
  const root = process.env.HERDR_PLUGIN_STATE_DIR ||
    join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "herdr-agent-pane-titles");
  return join(root, `${encodeURIComponent(paneId)}.json`);
}

function readPaneState(paneId) {
  try {
    return JSON.parse(readFileSync(paneStatePath(paneId), "utf8"));
  } catch {
    return undefined;
  }
}

function writePaneState(paneId, state) {
  const path = paneStatePath(paneId);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, "utf8");
  renameSync(temporary, path);
}

function clearPaneState(paneId) {
  rmSync(paneStatePath(paneId), { force: true });
}

function sessionKey(pane) {
  const session = pane.agent_session;
  return session?.value ? `${pane.agent || session.agent}:${session.kind}:${session.value}` : undefined;
}

export function renameDecision(pane, desiredTitle, previous) {
  const current = sanitizeTitle(pane.label);
  if (current && previous?.title !== current) return "manual";
  if (!desiredTitle && current && previous?.title === current && previous.session !== sessionKey(pane)) {
    return "clear";
  }
  if (!desiredTitle || desiredTitle === current) return "noop";
  return "rename";
}

async function syncPane(paneId) {
  const response = runHerdr(["pane", "get", paneId]);
  const pane = response.result?.pane;
  if (!pane || !SUPPORTED_AGENTS.has(String(pane.agent || "").toLowerCase())) return;

  const previous = readPaneState(paneId);
  const desired = await titleForPane(pane);
  const decision = renameDecision(pane, desired, previous);

  if (decision === "manual") {
    clearPaneState(paneId);
  } else if (decision === "clear") {
    runHerdr(["pane", "rename", paneId, "--clear"]);
    clearPaneState(paneId);
  } else if (decision === "rename") {
    runHerdr(["pane", "rename", paneId, desired]);
    writePaneState(paneId, { title: desired, session: sessionKey(pane) });
  } else if (desired && previous?.title === pane.label) {
    writePaneState(paneId, { title: desired, session: sessionKey(pane) });
  }
}

async function syncAll() {
  const response = runHerdr(["pane", "list"]);
  for (const pane of response.result?.panes || []) await syncPane(pane.pane_id);
}

function eventPaneId() {
  for (const name of ["HERDR_PLUGIN_EVENT_JSON", "HERDR_PLUGIN_CONTEXT_JSON"]) {
    try {
      const value = JSON.parse(process.env[name] || "{}");
      const paneId = value.data?.pane_id || value.data?.pane?.pane_id ||
        value.pane_id || value.focused_pane_id;
      if (paneId) return paneId;
    } catch {
      // Ignore malformed invocation context.
    }
  }
  return process.env.HERDR_PANE_ID;
}

function installIntegrations() {
  for (const agent of SUPPORTED_AGENTS) {
    const result = spawnSync(HERDR, ["integration", "install", agent], {
      stdio: "inherit",
      timeout: 30000,
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`failed to install Herdr's ${agent} integration`);
  }
  process.stdout.write("Restart running agents once so Herdr can report their session IDs.\n");
}

async function main() {
  const command = process.argv[2] || "sync-all";
  if (command === "sync-all") await syncAll();
  else if (command === "sync-event") {
    const paneId = eventPaneId();
    if (paneId) await syncPane(paneId);
  } else if (command === "install-integrations") installIntegrations();
  else throw new Error(`unknown command: ${command}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) await main();
