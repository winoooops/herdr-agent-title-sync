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
    for (const table of sessionTables(database)) {
      const row = database.prepare(`SELECT title FROM ${table} WHERE id = ?`).get(sessionId) as
        | { title?: unknown }
        | undefined;
      const title = sanitizeTitle(row?.title);
      if (title) return title;
    }
    return undefined;
  } finally {
    database.close();
  }
}

// OpenCode 2 stores sessions in `session_v2` and keeps the 1.x `session`
// table next to it, so sessions from either version can be in the same file.
function sessionTables(database: DatabaseSync): string[] {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('session_v2', 'session')")
    .all() as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  return ["session_v2", "session"].filter((name) => names.has(name));
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
