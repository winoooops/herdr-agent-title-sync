/** Codex title reader. */
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import { readJsonLines, sanitizeTitle } from "./utils.ts";

type ProcessInfoResponse = {
  result?: {
    process_info?: {
      foreground_processes?: Array<{ argv?: unknown; name?: unknown }>;
    };
  };
};

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the session selected by `codex resume`. The command line is an exact
 * identity signal; cwd is deliberately ignored because Codex lets a resumed
 * thread run from a directory other than the one stored with that thread.
 */
function resumeSessionId(response: ProcessInfoResponse): string | undefined {
  for (const process of response.result?.process_info?.foreground_processes || []) {
    if (process.name !== "codex" || !Array.isArray(process.argv)) continue;
    const argv = process.argv.filter((argument): argument is string => typeof argument === "string");
    const resume = argv.indexOf("resume");
    const candidate = resume >= 0 ? argv[resume + 1] : undefined;
    if (candidate && SESSION_ID.test(candidate)) return candidate;
  }
  return undefined;
}

function paneSessionId(paneId: string | undefined): string | undefined {
  if (!paneId) return undefined;
  const result = spawnSync(
    process.env.HERDR_BIN_PATH || "herdr",
    ["pane", "process-info", "--pane", paneId],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  if (result.error || result.status !== 0 || !result.stdout.trim()) return undefined;
  try {
    return resumeSessionId(JSON.parse(result.stdout) as ProcessInfoResponse);
  } catch {
    return undefined;
  }
}

/**
 * Returns the latest name for a Codex session. Herdr's reported session wins;
 * process inspection is only a fallback for resumed sessions whose start hook
 * has not reported yet.
 */
export async function codexTitle(
  sessionId: string | undefined,
  codexRoot = process.env.CODEX_HOME || join(homedir(), ".codex"),
  paneId?: string,
): Promise<string | undefined> {
  const resolvedSessionId = sessionId || paneSessionId(paneId);
  if (!resolvedSessionId) return undefined;

  let title: string | undefined;
  await readJsonLines(join(codexRoot, "session_index.jsonl"), (row) => {
    if (row.id === resolvedSessionId) title = sanitizeTitle(row.thread_name);
  });
  return title;
}
