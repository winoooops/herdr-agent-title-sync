/** Shared parsing and trust-boundary helpers for agent adapters. */
import { createReadStream, existsSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createInterface } from "node:readline";

export type JsonRow = {
  [key: string]: unknown;
  input?: Array<{ text?: unknown }>;
  origin?: { kind?: unknown };
};

/**
 * Normalizes an external title for use as a pane label. `maxBytes` is a UTF-8
 * byte limit, and an empty result is represented by `undefined`.
 */
export function sanitizeTitle(raw: unknown, maxBytes = 200): string | undefined {
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

export async function readJsonLines(
  path: string | undefined,
  visit: (row: JsonRow) => void,
): Promise<void> {
  if (!path || !existsSync(path)) return;
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    try {
      visit(JSON.parse(line) as JsonRow);
    } catch {
      // Agents may leave one partial JSONL line while writing.
    }
  }
}

/**
 * Resolves a path stored by another process only if its real target remains
 * below `root`; a corrupt index must not expand this plugin's read boundary.
 */
export function trustedChild(root: string, candidate: string): string | undefined {
  try {
    const trustedRoot = realpathSync(root);
    const child = realpathSync(resolve(root, candidate));
    const pathFromRoot = relative(trustedRoot, child);
    return pathFromRoot && !pathFromRoot.startsWith("..") ? child : undefined;
  } catch {
    return undefined;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
