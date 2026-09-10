import { z } from "zod";
import { resolvePath } from "../config.js";
import type { ToolDef } from "./types.js";
import { jsonResult, textResult } from "./types.js";

const basename = (p: string) => p.split("/").pop() || p;

/**
 * Admin tools — the highest-impact powers. Registered only in `admin` mode, and each needs its own
 * opt-in flag on top: arbitrary command / AppleScript execution and killing processes need
 * MACOS_ALLOW_EXEC; deleting needs MACOS_ALLOW_DELETE; GUI input needs MACOS_ALLOW_INPUT. The exec,
 * delete and kill tools also ask the human to confirm each call (via elicitation) before running.
 */
export const adminTools: ToolDef[] = [
  {
    name: "run_command",
    capability: "admin",
    destructive: true,
    config: {
      title: "Run a command",
      description:
        "Run a program with arguments (no shell — pass argv, not a command line). Requires admin mode AND " +
        "MACOS_ALLOW_EXEC=true; the program must be in MACOS_COMMAND_ALLOWLIST when that is set. For a shell " +
        'pipeline, run command="zsh", args=["-c","…"].',
      inputSchema: {
        command: z.string().min(1).describe("Program to run (name or absolute path)."),
        args: z.array(z.string()).default([]).describe("Arguments (each passed verbatim; no shell expansion)."),
        cwd: z.string().optional().describe("Working directory (supports ~)."),
      },
    },
    handler: async (args, { client, policy, confirm }) => {
      const command = args.command as string;
      const argv = (args.args as string[] | undefined) ?? [];
      const cwd = args.cwd ? resolvePath(args.cwd as string) : undefined;
      const { dryRun } = policy.guard({
        tool: "run_command",
        capability: "admin",
        command: basename(command),
        requiresExec: true,
        destructive: true,
      });
      const shown = `${command} ${argv.join(" ")}`.trim();
      if (dryRun) return textResult(`[dry-run] Would run: ${shown}`);
      const ok = await confirm.confirm({ action: "run command", target: shown, details: { cwd } });
      if (!ok.approved) return textResult(`Command cancelled — ${ok.reason}.`);
      const r = await client.run(command, argv, { cwd });
      return jsonResult({ code: r.code, timedOut: r.timedOut, stdout: r.stdout, stderr: r.stderr });
    },
  },
  {
    name: "run_applescript",
    capability: "admin",
    destructive: true,
    config: {
      title: "Run AppleScript / JXA",
      description:
        "Run an AppleScript (or JavaScript for Automation) snippet via osascript. Powerful — can drive any " +
        "scriptable app. Requires admin mode AND MACOS_ALLOW_EXEC=true.",
      inputSchema: {
        script: z.string().min(1).describe("The AppleScript (or JXA) source."),
        language: z.enum(["AppleScript", "JavaScript"]).default("AppleScript").describe("Script language."),
      },
    },
    handler: async (args, { client, policy, confirm }) => {
      const script = args.script as string;
      const language = (args.language as "AppleScript" | "JavaScript" | undefined) ?? "AppleScript";
      const { dryRun } = policy.guard({
        tool: "run_applescript",
        capability: "admin",
        requiresExec: true,
        destructive: true,
      });
      const preview = script.length > 120 ? `${script.slice(0, 117)}…` : script;
      if (dryRun) return textResult(`[dry-run] Would run ${language}: ${preview}`);
      const ok = await confirm.confirm({ action: `run ${language}`, target: preview });
      if (!ok.approved) return textResult(`Script cancelled — ${ok.reason}.`);
      return jsonResult({ output: await client.osa(script, language) });
    },
  },
  {
    name: "delete_path",
    capability: "admin",
    destructive: true,
    config: {
      title: "Delete a path (to Trash)",
      description:
        "Move a file or folder to the Trash (recoverable). Requires admin mode AND MACOS_ALLOW_DELETE=true. " +
        "Honours the path allowlist and refuses protected paths.",
      inputSchema: { path: z.string().min(1).describe("Path to trash (supports ~).") },
    },
    handler: async (args, { client, policy, confirm }) => {
      const abs = resolvePath(args.path as string);
      const { dryRun } = policy.guard({
        tool: "delete_path",
        capability: "admin",
        path: abs,
        pathMutation: true,
        requiresDelete: true,
        destructive: true,
      });
      if (dryRun) return textResult(`[dry-run] Would move ${abs} to the Trash.`);
      const ok = await confirm.confirm({ action: "move to Trash", target: abs });
      if (!ok.approved) return textResult(`Deletion cancelled — ${ok.reason}.`);
      await client.trashPath(abs);
      return jsonResult({ trashed: true, path: abs });
    },
  },
  {
    name: "kill_process",
    capability: "admin",
    destructive: true,
    config: {
      title: "Kill a process",
      description:
        "Send a signal (default SIGTERM) to a process by pid. Requires admin mode AND MACOS_ALLOW_EXEC=true.",
      inputSchema: {
        pid: z.number().int().positive().describe("Process id (from list_processes)."),
        signal: z.enum(["TERM", "KILL", "INT", "HUP"]).default("TERM").describe("Signal to send."),
      },
    },
    handler: async (args, { client, policy, confirm }) => {
      const pid = args.pid as number;
      const signal = (args.signal as string | undefined) ?? "TERM";
      const { dryRun } = policy.guard({
        tool: "kill_process",
        capability: "admin",
        requiresExec: true,
        destructive: true,
      });
      if (dryRun) return textResult(`[dry-run] Would send SIG${signal} to pid ${pid}.`);
      const ok = await confirm.confirm({ action: `send SIG${signal}`, target: `pid ${pid}` });
      if (!ok.approved) return textResult(`Kill cancelled — ${ok.reason}.`);
      client.killProcess(pid, `SIG${signal}` as NodeJS.Signals);
      return jsonResult({ signalled: true, pid, signal: `SIG${signal}` });
    },
  },
  {
    name: "type_text",
    capability: "admin",
    destructive: false,
    config: {
      title: "Type text",
      description:
        "Type literal text into the frontmost app (keystrokes). Requires admin mode AND MACOS_ALLOW_INPUT=true, " +
        "plus Accessibility permission for the host process.",
      inputSchema: { text: z.string().min(1).describe("Text to type.") },
    },
    handler: async (args, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "type_text", capability: "admin", requiresInput: true });
      if (dryRun) return textResult("[dry-run] Would type text.");
      await client.typeText(args.text as string);
      return jsonResult({ typed: true });
    },
  },
  {
    name: "key_press",
    capability: "admin",
    destructive: false,
    config: {
      title: "Press a key",
      description:
        "Press a key (e.g. return, tab, escape, arrows, or a character) with optional modifiers " +
        "(command/option/control/shift). Requires admin mode AND MACOS_ALLOW_INPUT=true.",
      inputSchema: {
        key: z.string().min(1).describe("Key name (return, tab, escape, up…) or a single character."),
        modifiers: z
          .array(z.enum(["command", "option", "control", "shift"]))
          .default([])
          .describe("Modifier keys to hold."),
      },
    },
    handler: async (args, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "key_press", capability: "admin", requiresInput: true });
      if (dryRun) return textResult("[dry-run] Would press a key.");
      await client.keyPress(args.key as string, (args.modifiers as string[] | undefined) ?? []);
      return jsonResult({ pressed: args.key });
    },
  },
  {
    name: "click",
    capability: "admin",
    destructive: false,
    config: {
      title: "Click",
      description:
        "Click at screen coordinates. Requires admin mode AND MACOS_ALLOW_INPUT=true, and the `cliclick` tool " +
        "(brew install cliclick).",
      inputSchema: {
        x: z.number().int().describe("X coordinate (screen points)."),
        y: z.number().int().describe("Y coordinate (screen points)."),
        button: z.enum(["left", "right", "double"]).default("left").describe("Click type."),
      },
    },
    handler: async (args, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "click", capability: "admin", requiresInput: true });
      if (dryRun) return textResult("[dry-run] Would click.");
      await client.click(args.x as number, args.y as number, (args.button as "left" | "right" | "double") ?? "left");
      return jsonResult({ clicked: { x: args.x, y: args.y, button: args.button ?? "left" } });
    },
  },
  {
    name: "move_mouse",
    capability: "admin",
    destructive: false,
    config: {
      title: "Move the mouse",
      description: "Move the cursor to screen coordinates. Requires admin mode AND MACOS_ALLOW_INPUT=true (cliclick).",
      inputSchema: {
        x: z.number().int().describe("X coordinate (screen points)."),
        y: z.number().int().describe("Y coordinate (screen points)."),
      },
    },
    handler: async (args, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "move_mouse", capability: "admin", requiresInput: true });
      if (dryRun) return textResult("[dry-run] Would move the mouse.");
      await client.moveMouse(args.x as number, args.y as number);
      return jsonResult({ moved: { x: args.x, y: args.y } });
    },
  },
];
