/**
 * Resolves a Herdr pane to a user-facing task title without modifying agent data.
 * Known agents prefer durable session metadata; every agent can fall back to its
 * terminal title. Missing, partial, or temporarily unreadable state means "no
 * title from this source", not a failed synchronization.
 */
import { basename } from "node:path";

import { claudeTitle } from "./claude.ts";
import { codexTitle } from "./codex.ts";
import { kimiTitle } from "./kimi.ts";
import { opencodeTitle } from "./opencode.ts";
import { errorMessage, sanitizeTitle } from "./utils.ts";

export { claudeTitle, codexTitle, kimiTitle, opencodeTitle, sanitizeTitle };

/** Agents for which this plugin can ask Herdr to install a session integration. */
export const SUPPORTED_AGENTS = ["claude", "codex", "kimi", "opencode"] as const;

/**
 * The subset of Herdr's pane payload used by title resolution. Fields are
 * optional because integrations and older Herdr versions may omit session data.
 */
export type Pane = {
  agent?: string;
  agent_session?: { agent?: string; kind?: string; value?: string };
  cwd?: string;
  foreground_cwd?: string;
  label?: string;
  pane_id?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
};

type TitlePaths = {
  claudeRoot?: string;
  codexRoot?: string;
  kimiRoot?: string;
  opencodeDb?: string;
};
type TitleReader = (
  sessionId: string | undefined,
  paths: TitlePaths,
  pane: Pane,
) => string | undefined | Promise<string | undefined>;

// Dedicated readers are optional extensions to the universal terminal-title
// adapter. An absent reader deliberately falls through instead of rejecting a
// newly introduced agent.
const TITLE_READERS = new Map<string, TitleReader>([
  ["claude", (sessionId, paths) => sessionId ? claudeTitle(sessionId, paths.claudeRoot) : undefined],
  ["codex", (sessionId, paths, pane) => codexTitle(sessionId, paths.codexRoot, pane.pane_id)],
  ["kimi", (sessionId, paths) => sessionId ? kimiTitle(sessionId, paths.kimiRoot) : undefined],
  ["opencode", (sessionId, paths) => sessionId ? opencodeTitle(sessionId, paths.opencodeDb) : undefined],
]);

/**
 * Returns the best title currently available for a pane. Durable session state
 * takes precedence over the terminal fallback; `undefined` means no source is
 * currently authoritative.
 */
export async function titleForPane(
  pane: Pane,
  paths: TitlePaths = {},
): Promise<string | undefined> {
  const agent = String(pane.agent || pane.agent_session?.agent || "").toLowerCase();
  if (!agent) return undefined;
  const sessionId = pane.agent_session?.kind === "id" ? pane.agent_session.value : undefined;

  let title: string | undefined;
  try {
    const reader = TITLE_READERS.get(agent);
    if (reader) title = await reader(sessionId, paths, pane);
  } catch (error) {
    console.error(`${agent} title lookup failed: ${errorMessage(error)}`);
  }
  return title || terminalTitle(pane, agent);
}

function terminalTitle(pane: Pane, agent: string): string | undefined {
  let title = String(pane.terminal_title_stripped || pane.terminal_title || "");
  title = title.replace(/^[✳✢·…]\s*/u, "").replace(/^OC\s*\|\s*/i, "");
  const sanitized = sanitizeTitle(title);
  if (!sanitized) return undefined;

  const generic = new Set([agent, `${agent} code`]);
  const cwd = pane.foreground_cwd || pane.cwd;
  const cwdName = cwd ? basename(cwd) : "";
  // Generic program names and cwd echoes carry no task information and would
  // otherwise overwrite a useful existing label.
  if (generic.has(sanitized.toLowerCase()) || sanitized === cwdName) return undefined;
  return sanitized;
}
