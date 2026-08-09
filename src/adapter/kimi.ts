/** Kimi Code title reader. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readJsonLines, sanitizeTitle, trustedChild, type JsonRow } from "./utils.ts";

/**
 * Returns Kimi's stored title, or its first user prompt on versions that do not
 * persist generated titles.
 */
export async function kimiTitle(
  sessionId: string,
  kimiRoot = process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code"),
): Promise<string | undefined> {
  let sessionDir: string | undefined;
  await readJsonLines(join(kimiRoot, "session_index.jsonl"), (row) => {
    if (row.sessionId === sessionId && typeof row.sessionDir === "string") {
      sessionDir = row.sessionDir;
    }
  });
  if (!sessionDir) return undefined;

  const trustedDir = trustedChild(kimiRoot, sessionDir);
  if (!trustedDir) return undefined;
  try {
    const state = JSON.parse(readFileSync(join(trustedDir, "state.json"), "utf8")) as JsonRow;
    const stored = sanitizeTitle(state.title);
    if (stored) return stored;
  } catch {
    // Missing or malformed state is expected when Kimi derives the title elsewhere.
  }

  let firstPrompt: string | undefined;
  await readJsonLines(join(trustedDir, "agents", "main", "wire.jsonl"), (row) => {
    if (firstPrompt || row.type !== "turn.prompt" || row.origin?.kind !== "user") return;
    const text = Array.isArray(row.input)
      ? row.input.find((part) => typeof part.text === "string")?.text
      : undefined;
    firstPrompt = sanitizeTitle(text, 80);
  });
  return firstPrompt;
}
