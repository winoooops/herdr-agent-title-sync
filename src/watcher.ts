/**
 * Reconciles agent titles with Herdr pane labels.
 *
 * Herdr's plugin events do not cover every title-only update, so a detached
 * watcher periodically recomputes desired labels. A per-pane state file is the
 * proof of ownership: labels not recorded there are user-owned and must never
 * be overwritten. A token file elects one watcher without relying on a
 * potentially stale or reused PID.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { sanitizeTitle, titleForPane, type Pane } from "./adapter/index.ts";

const HERDR = process.env.HERDR_BIN_PATH || "herdr";
const PLUGIN_ID = "herdr-agent-title-sync";
// Milliseconds between reconciliation passes. One second keeps interactive
// renames responsive while avoiding a continuous scan of agent state.
const configuredInterval = Number(process.env.HERDR_AGENT_TITLE_SYNC_INTERVAL_MS);
const WATCH_INTERVAL_MS = Number.isFinite(configuredInterval) && configuredInterval > 0
  ? configuredInterval
  : 1000;

// A state record exists only while the current label is owned by this plugin.
type PaneState = { session?: string; title: string };
type HerdrResponse = {
  result?: {
    panes?: Pane[];
    plugins?: Array<{ enabled?: boolean; plugin_id?: string }>;
  };
};

function runHerdr(args: string[]): HerdrResponse {
  const result = spawnSync(HERDR, args, {
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${HERDR} ${args.join(" ")} exited ${result.status}`);
  }
  return result.stdout.trim() ? (JSON.parse(result.stdout) as HerdrResponse) : {};
}

function pluginStateRoot(): string {
  return process.env.HERDR_PLUGIN_STATE_DIR ||
    join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), PLUGIN_ID);
}

function paneStatePath(paneId: string): string {
  return join(pluginStateRoot(), `${encodeURIComponent(paneId)}.json`);
}

function readPaneState(paneId: string): PaneState | undefined {
  try {
    const state = JSON.parse(readFileSync(paneStatePath(paneId), "utf8")) as Partial<PaneState>;
    return typeof state.title === "string" ? { session: state.session, title: state.title } : undefined;
  } catch {
    return undefined;
  }
}

function writePaneState(paneId: string, state: PaneState): void {
  const path = paneStatePath(paneId);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  // Rename makes the ownership update atomic for concurrent manual syncs.
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, "utf8");
  renameSync(temporary, path);
}

function clearPaneState(paneId: string): void {
  rmSync(paneStatePath(paneId), { force: true });
}

function sessionKey(pane: Pane): string | undefined {
  const session = pane.agent_session;
  return session?.value ? `${pane.agent || session.agent}:${session.kind}:${session.value}` : undefined;
}

/**
 * Applies the label-ownership policy without side effects. A nonempty label
 * that differs from the last plugin-owned title is always considered manual.
 */
export function renameDecision(
  pane: Pane,
  desiredTitle: string | undefined,
  previous: PaneState | undefined,
): "clear" | "manual" | "noop" | "rename" {
  const current = sanitizeTitle(pane.label);
  if (current && previous?.title !== current) return "manual";
  if (!desiredTitle && current && previous?.title === current && previous.session !== sessionKey(pane)) {
    return "clear";
  }
  if (!desiredTitle || desiredTitle === current) return "noop";
  return "rename";
}

async function syncPane(pane: Pane): Promise<void> {
  const paneId = pane.pane_id;
  if (!paneId) return;
  const previous = readPaneState(paneId);
  if (!pane.agent) {
    // Agent exit invalidates our old title, but a label edited by the user stays.
    if (previous?.title === sanitizeTitle(pane.label)) {
      runHerdr(["pane", "rename", paneId, "--clear"]);
    }
    clearPaneState(paneId);
    return;
  }

  const desired = await titleForPane(pane);
  const decision = renameDecision(pane, desired, previous);
  if (decision === "manual") {
    clearPaneState(paneId);
  } else if (decision === "clear") {
    runHerdr(["pane", "rename", paneId, "--clear"]);
    clearPaneState(paneId);
  } else if (decision === "rename" && desired) {
    runHerdr(["pane", "rename", paneId, desired]);
    writePaneState(paneId, { title: desired, session: sessionKey(pane) });
  } else if (desired && previous?.title === pane.label) {
    writePaneState(paneId, { title: desired, session: sessionKey(pane) });
  }
}

/** Performs one reconciliation pass over the panes currently known to Herdr. */
export async function syncAll(): Promise<void> {
  const response = runHerdr(["pane", "list"]);
  for (const pane of response.result?.panes || []) await syncPane(pane);
}

function watcherLockPath(): string {
  return join(pluginStateRoot(), "watcher.json");
}

function ownsWatcherLock(token: string): boolean {
  try {
    const lock = JSON.parse(readFileSync(watcherLockPath(), "utf8")) as { token?: unknown };
    return lock.token === token;
  } catch {
    return false;
  }
}

/**
 * Starts a detached watcher for the CLI entrypoint at `script`. The spawned
 * watcher claims a new token, superseding the old owner on its next pass.
 */
export function startWatcher(script: string): void {
  const token = randomUUID();
  const child = spawn(process.execPath, ["--no-warnings", script, "watch"], {
    cwd: dirname(script),
    detached: true,
    env: { ...process.env, HERDR_AGENT_TITLE_SYNC_WATCHER_TOKEN: token },
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  process.stdout.write(`Started title watcher (pid ${child.pid}).\n`);
}

/** Requests a clean stop by revoking ownership instead of signaling a PID. */
export function stopWatcher(): void {
  rmSync(watcherLockPath(), { force: true });
  process.stdout.write("Stopped title watcher.\n");
}

function pluginEnabled(): boolean {
  const response = runHerdr(["plugin", "list"]);
  return response.result?.plugins?.some(
    (plugin) => plugin.plugin_id === PLUGIN_ID && plugin.enabled,
  ) === true;
}

/** Runs reconciliation until superseded, stopped, disabled, or Herdr disappears. */
export async function watch(): Promise<void> {
  const token = process.env.HERDR_AGENT_TITLE_SYNC_WATCHER_TOKEN || randomUUID();
  const lockPath = watcherLockPath();
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, token })}\n`, "utf8");

  let failures = 0;
  let iteration = 0;
  try {
    while (ownsWatcherLock(token)) {
      try {
        // A detached process receives no plugin-disable event, so recheck the
        // registry every 15 passes instead of adding a second polling loop.
        if (iteration % 15 === 0 && !pluginEnabled()) break;
        await syncAll();
        failures = 0;
      } catch (error) {
        failures += 1;
        // Short Herdr restarts are transient; repeated failure means this
        // detached watcher should exit rather than become an orphan.
        if (failures >= 5) throw error;
      }
      iteration += 1;
      await new Promise((resolveWait) => setTimeout(resolveWait, WATCH_INTERVAL_MS));
    }
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    // Detached stdio is intentionally discarded; retain the final failure in
    // plugin state where users can diagnose an exited watcher.
    writeFileSync(
      join(pluginStateRoot(), "watcher-error.log"),
      `${new Date().toISOString()} ${message}\n`,
      "utf8",
    );
  } finally {
    if (ownsWatcherLock(token)) rmSync(lockPath, { force: true });
  }
}
