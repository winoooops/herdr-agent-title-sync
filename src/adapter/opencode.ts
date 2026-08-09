/** OpenCode title reader. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { sanitizeTitle } from "./utils.ts";

// The database location is stable for a CLI process; caching avoids launching
// `opencode db path` on every watcher pass.
let cachedDatabasePath: string | undefined;

/** Returns the title for an exact OpenCode session using a read-only DB handle. */
export function opencodeTitle(sessionId: string, databasePath?: string): string | undefined {
  const path = databasePath || findDatabase();
  if (!path || !existsSync(path)) return undefined;

  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database.prepare("SELECT title FROM session WHERE id = ?").get(sessionId) as
      | { title?: unknown }
      | undefined;
    return sanitizeTitle(row?.title);
  } finally {
    database.close();
  }
}

function findDatabase(): string | undefined {
  if (process.env.OPENCODE_DB_PATH) return process.env.OPENCODE_DB_PATH;
  if (cachedDatabasePath) return cachedDatabasePath;
  const result = spawnSync("opencode", ["db", "path"], {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true,
  });
  const reported = result.status === 0 ? result.stdout.trim() : "";
  if (reported) return (cachedDatabasePath = reported);

  const dataRoot = process.env.XDG_DATA_HOME ||
    (platform() === "win32" ? process.env.APPDATA : join(homedir(), ".local", "share"));
  return dataRoot
    ? (cachedDatabasePath = join(dataRoot, "opencode", "opencode.db"))
    : undefined;
}
