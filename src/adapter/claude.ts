/** Claude Code title reader. */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readJsonLines, sanitizeTitle } from "./utils.ts";

/** Returns Claude's custom title when present, otherwise its latest AI title. */
export async function claudeTitle(
  sessionId: string,
  configRoot = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
): Promise<string | undefined> {
  const transcript = findTranscript(sessionId, configRoot);
  if (!transcript) return undefined;

  let title: string | undefined;
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

function findTranscript(sessionId: string, configRoot: string): string | undefined {
  const projects = join(configRoot, "projects");
  if (!existsSync(projects)) return undefined;

  for (const entry of readdirSync(projects, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(projects, entry.name, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
