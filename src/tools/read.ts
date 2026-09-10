import { z } from "zod";
import { resolvePath } from "../config.js";
import type { ToolDef } from "./types.js";
import { imageResult, jsonResult, textResult } from "./types.js";

/**
 * Read tools. Available in every mode (read-only and up). None of these mutate the machine.
 * Filesystem reads still honour the path allowlist (when configured).
 */
export const readTools: ToolDef[] = [
  {
    name: "system_info",
    capability: "read",
    config: {
      title: "System info",
      description: "Report macOS version, hardware, memory, load, uptime and the current user.",
      inputSchema: {},
    },
    handler: async (_args, { client, policy }) => {
      policy.guard({ tool: "system_info", capability: "read" });
      return jsonResult(await client.systemInfo());
    },
  },
  {
    name: "list_directory",
    capability: "read",
    config: {
      title: "List a directory",
      description: "List the entries (name, type, size) of a directory. Honours the path allowlist.",
      inputSchema: { path: z.string().min(1).describe("Directory path (supports ~ for home).") },
    },
    handler: async (args, { client, policy }) => {
      const abs = resolvePath(args.path as string);
      policy.guard({ tool: "list_directory", capability: "read", path: abs });
      return jsonResult({ path: abs, entries: await client.listDirectory(abs) });
    },
  },
  {
    name: "read_file",
    capability: "read",
    config: {
      title: "Read a file",
      description: "Read a text file's contents (capped at MACOS_MAX_FILE_BYTES). Honours the path allowlist.",
      inputSchema: { path: z.string().min(1).describe("File path (supports ~ for home).") },
    },
    handler: async (args, { client, policy }) => {
      const abs = resolvePath(args.path as string);
      policy.guard({ tool: "read_file", capability: "read", path: abs });
      return jsonResult(await client.readFile(abs));
    },
  },
  {
    name: "list_processes",
    capability: "read",
    config: {
      title: "List processes",
      description: "List running processes (pid, cpu%, mem%, command), busiest first.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(30).describe("Max rows (default 30)."),
        filter: z.string().optional().describe("Only processes whose command contains this substring."),
      },
    },
    handler: async (args, { client, policy }) => {
      policy.guard({ tool: "list_processes", capability: "read" });
      const limit = (args.limit as number | undefined) ?? 30;
      return jsonResult(await client.listProcesses(limit, args.filter as string | undefined));
    },
  },
  {
    name: "get_clipboard",
    capability: "read",
    config: {
      title: "Read the clipboard",
      description: "Return the current text contents of the macOS clipboard.",
      inputSchema: {},
    },
    handler: async (_args, { client, policy }) => {
      policy.guard({ tool: "get_clipboard", capability: "read" });
      return textResult(await client.getClipboard());
    },
  },
  {
    name: "list_apps",
    capability: "read",
    config: {
      title: "List running apps",
      description: "List the names of currently running (non-background) applications.",
      inputSchema: {},
    },
    handler: async (_args, { client, policy }) => {
      policy.guard({ tool: "list_apps", capability: "read" });
      return jsonResult(await client.listApps());
    },
  },
  {
    name: "get_frontmost_app",
    capability: "read",
    config: {
      title: "Frontmost app",
      description: "Return the name of the frontmost (active) application.",
      inputSchema: {},
    },
    handler: async (_args, { client, policy }) => {
      policy.guard({ tool: "get_frontmost_app", capability: "read" });
      return textResult(await client.frontmostApp());
    },
  },
  {
    name: "screenshot",
    capability: "read",
    config: {
      title: "Screenshot",
      description:
        "Capture the screen and return it as a PNG image. Needs Screen Recording permission for the host process.",
      inputSchema: {},
    },
    handler: async (_args, { client, policy }) => {
      policy.guard({ tool: "screenshot", capability: "read" });
      return imageResult(await client.screenshot(), "image/png", "Screen capture:");
    },
  },
];
