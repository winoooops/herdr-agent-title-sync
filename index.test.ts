import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  claudeTitle,
  codexTitle,
  kimiTitle,
  opencodeTitle,
  sanitizeTitle,
  titleForPane,
} from "./src/adapter/index.ts";
import { renameDecision } from "./src/watcher.ts";

function fixtureDir(name: string): string {
  const path = join(tmpdir(), `herdr-agent-title-sync-${process.pid}-${name}`);
  mkdirSync(path, { recursive: true });
  return path;
}

async function waitFor(check: () => boolean, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("timed out waiting for watcher");
}

test("sanitizes controls, whitespace, and UTF-8 byte length", () => {
  assert.equal(sanitizeTitle("  Fix\n  CI  "), "Fix CI");
  const truncated = sanitizeTitle("𝕏".repeat(60));
  assert.ok(truncated && Buffer.byteLength(truncated) <= 200);
});

test("uses terminal titles for future agents without a dedicated reader", async () => {
  assert.equal(
    await titleForPane({ agent: "future-agent", terminal_title: "Current task" }),
    "Current task",
  );
});

test("reads Claude custom titles without later AI overwrite", async () => {
  const root = fixtureDir("claude");
  const project = join(root, "projects", "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, "session-1.jsonl"),
    [
      '{"type":"ai-title","sessionId":"session-1","aiTitle":"Generated"}',
      '{"type":"custom-title","sessionId":"session-1","customTitle":"Mine"}',
      '{"type":"ai-title","sessionId":"session-1","aiTitle":"Later"}',
    ].join("\n"),
  );
  assert.equal(await claudeTitle("session-1", root), "Mine");
});

test("reads the latest matching Codex thread name", async () => {
  const root = fixtureDir("codex");
  writeFileSync(
    join(root, "session_index.jsonl"),
    [
      '{"id":"session-1","thread_name":"First"}',
      '{"id":"other","thread_name":"Wrong"}',
      '{"id":"session-1","thread_name":"Latest"}',
    ].join("\n"),
  );
  assert.equal(await codexTitle("session-1", root), "Latest");
});

test("resolves a resumed Codex session without relying on pane cwd", async () => {
  const root = fixtureDir("codex-resume");
  const fakeHerdr = join(root, "herdr-fake.ts");
  const sessionId = "019fc2f1-7e03-7ec3-b35f-6546036e7616";
  writeFileSync(
    join(root, "session_index.jsonl"),
    JSON.stringify({ id: sessionId, thread_name: "Worktree task" }),
  );
  writeFileSync(
    fakeHerdr,
    `#!${process.execPath}\n` +
      `console.log(JSON.stringify({ result: { process_info: { foreground_processes: [` +
      `{ name: "codex", argv: ["codex", "resume", "${sessionId}"] }` +
      `] } } }));\n`,
  );
  chmodSync(fakeHerdr, 0o755);

  const previousHerdr = process.env.HERDR_BIN_PATH;
  process.env.HERDR_BIN_PATH = fakeHerdr;
  try {
    assert.equal(
      await titleForPane(
        { agent: "codex", pane_id: "w1:p1", cwd: "/different/cwd" },
        { codexRoot: root },
      ),
      "Worktree task",
    );
  } finally {
    if (previousHerdr === undefined) delete process.env.HERDR_BIN_PATH;
    else process.env.HERDR_BIN_PATH = previousHerdr;
  }
});

test("uses Kimi stored title and current-version prompt fallback", async () => {
  const root = fixtureDir("kimi");
  const stored = join(root, "sessions", "stored");
  const fallback = join(root, "sessions", "fallback");
  mkdirSync(join(stored, "agents", "main"), { recursive: true });
  mkdirSync(join(fallback, "agents", "main"), { recursive: true });
  writeFileSync(join(stored, "state.json"), '{"title":"Stored title"}');
  writeFileSync(join(fallback, "state.json"), '{}');
  writeFileSync(
    join(fallback, "agents", "main", "wire.jsonl"),
    '{"type":"turn.prompt","origin":{"kind":"user"},"input":[{"type":"text","text":"Fallback title from the first prompt"}]}\n',
  );
  writeFileSync(
    join(root, "session_index.jsonl"),
    [
      JSON.stringify({ sessionId: "stored", sessionDir: stored }),
      JSON.stringify({ sessionId: "fallback", sessionDir: fallback }),
    ].join("\n"),
  );
  assert.equal(await kimiTitle("stored", root), "Stored title");
  assert.equal(await kimiTitle("fallback", root), "Fallback title from the first prompt");
});

test("reads OpenCode title by exact session id", () => {
  const root = fixtureDir("opencode");
  const path = join(root, "opencode.db");
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
  database.prepare("INSERT INTO session (id, title) VALUES (?, ?)").run("session-1", "Open title");
  database.close();
  assert.equal(opencodeTitle("session-1", path), "Open title");
});

test("preserves manual labels but updates plugin-owned labels", () => {
  const pane = {
    agent: "codex",
    label: "manual",
    agent_session: { kind: "id", value: "session-1" },
  };
  assert.equal(renameDecision(pane, "Generated", undefined), "manual");
  assert.equal(
    renameDecision({ ...pane, label: "Old" }, "Generated", {
      title: "Old",
      session: "codex:id:session-1",
    }),
    "rename",
  );
  assert.equal(
    renameDecision({ ...pane, label: "Old", agent_session: { kind: "id", value: "session-2" } }, undefined, {
      title: "Old",
      session: "codex:id:session-1",
    }),
    "clear",
  );
});

test("sync-all renames a pane through the Herdr CLI", () => {
  const root = fixtureDir("sync");
  const configRoot = join(root, "claude");
  const project = join(configRoot, "projects", "project");
  const stateRoot = join(root, "state");
  const log = join(root, "herdr.log");
  const fakeHerdr = join(root, "herdr-fake.ts");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, "session-1.jsonl"),
    '{"type":"ai-title","sessionId":"session-1","aiTitle":"Agent task"}\n',
  );
  writeFileSync(
    fakeHerdr,
    `#!${process.execPath}\n` +
      `import { appendFileSync } from "node:fs";\n` +
      `const args = process.argv.slice(2);\n` +
      `const pane = { pane_id: "w1:p1", agent_session: { agent: "claude", kind: "id", value: "session-1" } };\n` +
      `if (args[0] === "pane" && args[1] === "list") console.log(JSON.stringify({ result: { panes: [pane] } }));\n` +
      `else if (args[0] === "pane" && args[1] === "get") console.log(JSON.stringify({ result: { pane } }));\n` +
      `else if (args[0] === "pane" && args[1] === "rename") appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(args) + "\\n");\n` +
      `else process.exit(1);\n`,
  );
  chmodSync(fakeHerdr, 0o755);

  const result = spawnSync(
    process.execPath,
    ["--no-warnings", fileURLToPath(new URL("src/index.ts", import.meta.url)), "sync-all"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configRoot,
        FAKE_HERDR_LOG: log,
        HERDR_BIN_PATH: fakeHerdr,
        HERDR_PLUGIN_STATE_DIR: stateRoot,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(log, "utf8").trim()), [
    "pane",
    "rename",
    "w1:p1",
    "Agent task",
  ]);
  assert.equal(
    JSON.parse(readFileSync(join(stateRoot, "w1%3Ap1.json"), "utf8")).title,
    "Agent task",
  );
});

test("watcher applies a title changed during a running session", async () => {
  const root = fixtureDir("watcher");
  const stateRoot = join(root, "state");
  const log = join(root, "herdr.log");
  const fakeHerdr = join(root, "herdr-fake.ts");
  const pane = join(root, "pane.json");
  writeFileSync(
    pane,
    JSON.stringify({
      agent: "opencode",
      pane_id: "w1:p1",
      revision: 1,
      terminal_title_stripped: "OC | First title",
    }),
  );
  writeFileSync(
    fakeHerdr,
    `#!${process.execPath}\n` +
      `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";\n` +
      `const args = process.argv.slice(2);\n` +
      `const pane = JSON.parse(readFileSync(process.env.FAKE_PANE, "utf8"));\n` +
      `if (args[0] === "plugin") console.log(JSON.stringify({ result: { plugins: [{ plugin_id: "herdr-agent-title-sync", enabled: true }] } }));\n` +
      `else if (args[0] === "pane" && args[1] === "list") console.log(JSON.stringify({ result: { panes: [pane] } }));\n` +
      `else if (args[0] === "pane" && args[1] === "rename") { pane.label = args[3]; writeFileSync(process.env.FAKE_PANE, JSON.stringify(pane)); appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(args) + "\\n"); }\n` +
      `else process.exit(1);\n`,
  );
  chmodSync(fakeHerdr, 0o755);

  const env = {
    ...process.env,
    FAKE_HERDR_LOG: log,
    FAKE_PANE: pane,
    HERDR_AGENT_TITLE_SYNC_INTERVAL_MS: "25",
    HERDR_AGENT_TITLE_SYNC_WATCHER_TOKEN: "test-watcher",
    HERDR_BIN_PATH: fakeHerdr,
    HERDR_PLUGIN_STATE_DIR: stateRoot,
  };
  const script = fileURLToPath(new URL("src/index.ts", import.meta.url));
  const watcher = spawn(process.execPath, ["--no-warnings", script, "watch"], { env });
  let stderr = "";
  watcher.stderr.on("data", (chunk) => (stderr += chunk));

  try {
    await waitFor(() => existsSync(log) && readFileSync(log, "utf8").includes("First title"));
    writeFileSync(
      pane,
      JSON.stringify({
        agent: "opencode",
        pane_id: "w1:p1",
        revision: 2,
        terminal_title_stripped: "OC | Updated title",
      }),
    );
    await waitFor(() => readFileSync(log, "utf8").includes("Updated title"));
  } finally {
    spawnSync(process.execPath, ["--no-warnings", script, "stop-watcher"], { env });
    await waitFor(() => watcher.exitCode !== null).catch(() => watcher.kill());
  }
  assert.equal(watcher.exitCode, 0, stderr);
});
