import { z } from "zod";
import { resolvePath } from "../config.js";
import type { ToolDef } from "./types.js";
import { jsonResult, textResult } from "./types.js";

/**
 * Write tools. Registered in `read-write` mode and up. Reversible, scoped mutations.
 * Filesystem writes honour the path allowlist and refuse protected paths; overwriting an
 * existing file asks the human to confirm.
 */
export const writeTools: ToolDef[] = [
  {
    name: "write_file",
    capability: "write",
    config: {
      title: "Write a file",
      description:
        "Create or overwrite a text file. Honours the path allowlist, refuses protected paths, and asks " +
        "for confirmation before overwriting an existing file.",
      inputSchema: {
        path: z.string().min(1).describe("File path (supports ~ for home)."),
        content: z.string().describe("Full UTF-8 contents to write."),
      },
    },
    handler: async (args, { client, policy, confirm }) => {
      const abs = resolvePath(args.path as string);
      const { dryRun } = policy.guard({ tool: "write_file", capability: "write", path: abs, pathMutation: true });
      const exists = await client.pathExists(abs);
      if (dryRun) return textResult(`[dry-run] Would ${exists ? "overwrite" : "create"} ${abs}.`);
      if (exists) {
        const ok = await confirm.confirm({ action: "overwrite file", target: abs });
        if (!ok.approved) return textResult(`Write cancelled — ${ok.reason}.`);
      }
      await client.writeFile(abs, args.content as string);
      return jsonResult({ written: true, path: abs, bytes: Buffer.byteLength(args.content as string) });
    },
  },
  {
    name: "set_clipboard",
    capability: "write",
    config: {
      title: "Set the clipboard",
      description: "Replace the macOS clipboard contents with the given text.",
      inputSchema: { text: z.string().describe("Text to place on the clipboard.") },
    },
    handler: async (args, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "set_clipboard", capability: "write" });
      if (dryRun) return textResult("[dry-run] Would set the clipboard.");
      await client.setClipboard(args.text as string);
      return jsonResult({ ok: true });
    },
  },
  {
    name: "notify",
    capability: "write",
    config: {
      title: "Show a notification",
      description: "Post a macOS notification with a title and message.",
      inputSchema: {
        title: z.string().describe("Notification title."),
        message: z.string().describe("Notification body."),
      },
    },
    handler: async (args, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "notify", capability: "write" });
      if (dryRun) return textResult("[dry-run] Would post a notification.");
      await client.notify(args.title as string, args.message as string);
      return jsonResult({ ok: true });
    },
  },
  {
    name: "open",
    capability: "write",
    config: {
      title: "Open a file, URL or app",
      description:
        "Open a file/folder path or URL with its default handler, or launch an app by name (set app=true).",
      inputSchema: {
        target: z.string().min(1).describe("A path, a URL (https://…), or — with app=true — an application name."),
        app: z.boolean().optional().describe("If true, treat target as an application name to launch."),
      },
    },
    handler: async (args, { client, policy }) => {
      const asApp = (args.app as boolean | undefined) ?? false;
      const target = args.target as string;
      const { dryRun } = policy.guard({ tool: "open", capability: "write" });
      if (dryRun) return textResult(`[dry-run] Would open ${asApp ? `app '${target}'` : target}.`);
      await client.open(target, asApp);
      return jsonResult({ opened: target, asApp });
    },
  },
];
