/** Herdr argv entrypoint; title policy lives in adapter/ and watcher.ts. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SUPPORTED_AGENTS } from "./adapter/index.ts";
import { startWatcher, stopWatcher, syncAll, watch } from "./watcher.ts";

const HERDR = process.env.HERDR_BIN_PATH || "herdr";

/** Installs the Herdr integrations required to expose stable agent session IDs. */
function installIntegrations(): void {
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

async function main(): Promise<void> {
  const command = process.argv[2] || "sync-all";
  const handler = COMMAND_HANDLERS.get(command);
  if (!handler) throw new Error(`unknown command: ${command}`);
  await handler();
}

const script = fileURLToPath(import.meta.url);
const COMMAND_HANDLERS = new Map<string, () => void | Promise<void>>([
  ["sync-all", syncAll],
  ["start-watcher", () => startWatcher(script)],
  ["stop-watcher", stopWatcher],
  ["watch", watch],
  ["install-integrations", installIntegrations],
]);

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) await main();
