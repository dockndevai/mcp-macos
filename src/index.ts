#!/usr/bin/env node
/**
 * MCP server for macOS.
 *
 * Lets an agent observe and operate a Mac — system info, files, processes, clipboard, apps and
 * screenshots (read-only); write files, set the clipboard, post notifications and open things
 * (read-write); and, in admin mode behind explicit opt-in flags, run commands / AppleScript,
 * delete to Trash, kill processes and drive the GUI (type / key / click).
 *
 * Safe by default: starts read-only, so only observe/read tools are registered. Every high-impact
 * power needs both admin mode AND its own flag (MACOS_ALLOW_EXEC / _DELETE / _INPUT), and the
 * exec/delete/kill tools additionally ask the human to confirm each call. See src/security.ts.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(`[macos-mcp] Configuration error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const { server, enabled } = buildServer(config);

  process.stderr.write(
    `[macos-mcp] Starting in '${config.security.mode}' mode` +
      `${config.security.dryRun ? " (DRY RUN)" : ""}. ` +
      `${enabled.length} tools enabled: ${enabled.join(", ")}\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[macos-mcp] Fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
