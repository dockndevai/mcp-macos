import { appendFile, mkdir, mkdtemp, realpath, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "../src/config.js";
import { MacClient } from "../src/mac/client.js";
import { buildServer } from "../src/server.js";

let base: string; // realpath'd temp root = the allowlist
const limits = { maxFileBytes: 1_000_000, maxOutputBytes: 100_000, commandTimeoutMs: 30_000 };

const config = (requireHumanApproval = false): AppConfig => ({
  security: {
    mode: "admin",
    pathAllowlist: [base],
    protectedPaths: [],
    allowExec: true,
    commandAllowlist: [],
    allowDelete: true,
    allowInput: false,
    dryRun: false,
    auditLog: false,
    requireHumanApproval,
  },
  limits,
});

type Answer = { action: "accept" | "decline"; content?: Record<string, unknown> };

/** Connect an in-memory MCP client (optionally able to answer elicitation) to a freshly built server. */
async function connect(opts: { requireHuman?: boolean; answer?: (message: string) => Answer | Promise<Answer>; elicits?: boolean }) {
  const { server } = buildServer(config(opts.requireHuman));
  const prompts: string[] = [];
  const client = new Client({ name: "t", version: "0" }, { capabilities: opts.elicits === false ? {} : { elicitation: {} } });
  if (opts.elicits !== false) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      prompts.push(req.params.message);
      return (await opts.answer?.(req.params.message)) ?? { action: "accept", content: { confirm: true } };
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, prompts };
}

const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? "");
let n = 0;
const uniq = (name: string) => path.join(base, `${name}-${++n}`);

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "mcp-macos-approval-")));
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

describe("delete_path approval (end to end)", () => {
  it("shows tool, exact args, canonical target, version and fingerprint, then trashes the CANONICAL path", async () => {
    const real = uniq("report.txt");
    await writeFile(real, "hello");
    const link = uniq("link.txt");
    await symlink(real, link);
    const trash = vi.spyOn(MacClient.prototype, "trashPath").mockResolvedValue();
    const { client, prompts } = await connect({});
    const res = await client.callTool({ name: "delete_path", arguments: { path: link } });
    expect(text(res)).toContain('"trashed": true');
    expect(trash).toHaveBeenCalledWith(real);
    expect(prompts[0]).toContain("tool: delete_path");
    expect(prompts[0]).toContain(JSON.stringify({ path: link }));
    expect(prompts[0]).toContain(`"${real}"`); // the target shown is the resolved one, not the lexical symlink
    expect(prompts[0]).toMatch(/resource version: [0-9a-f]{12}/);
    expect(prompts[0]).toMatch(/fingerprint: [0-9a-f]{16}/);
  });

  it("does NOT trash when the file changed while the human was deciding", async () => {
    const f = uniq("doc.txt");
    await writeFile(f, "v1");
    const trash = vi.spyOn(MacClient.prototype, "trashPath").mockResolvedValue();
    const { client } = await connect({
      answer: async () => {
        await appendFile(f, " and some more");
        return { action: "accept", content: { confirm: true } };
      },
    });
    const res = await client.callTool({ name: "delete_path", arguments: { path: f } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(trash).not.toHaveBeenCalled();
  });

  it("does NOT trash when the file was replaced by another file of the same size and mtime (inode differs)", async () => {
    const f = uniq("swap.txt");
    await writeFile(f, "AAAA");
    const when = new Date("2024-01-01T00:00:00Z");
    await utimes(f, when, when);
    const trash = vi.spyOn(MacClient.prototype, "trashPath").mockResolvedValue();
    const { client } = await connect({
      answer: async () => {
        const other = uniq("other.txt");
        await writeFile(other, "BBBB");
        await utimes(other, when, when);
        await rename(other, f);
        return { action: "accept", content: { confirm: true } };
      },
    });
    const res = await client.callTool({ name: "delete_path", arguments: { path: f } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(trash).not.toHaveBeenCalled();
  });

  it("does NOT trash when a parent directory is swapped for a symlink while the human decides (token is canonical)", async () => {
    const dir = uniq("proj");
    await mkdir(dir);
    await writeFile(path.join(dir, "keep.txt"), "same");
    const decoy = uniq("decoy");
    await mkdir(decoy);
    await writeFile(path.join(decoy, "keep.txt"), "same");
    const trash = vi.spyOn(MacClient.prototype, "trashPath").mockResolvedValue();
    const { client } = await connect({
      answer: async () => {
        await rename(dir, `${dir}.moved`);
        await symlink(decoy, dir);
        return { action: "accept", content: { confirm: true } };
      },
    });
    const res = await client.callTool({ name: "delete_path", arguments: { path: path.join(dir, "keep.txt") } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(trash).not.toHaveBeenCalled();
  });

  it("a folder needs the path typed; a wrong value blocks, the right one proceeds", async () => {
    const dir = uniq("folder");
    await mkdir(dir);
    await writeFile(path.join(dir, "a.txt"), "a");
    const trash = vi.spyOn(MacClient.prototype, "trashPath").mockResolvedValue();

    const wrong = await connect({ answer: () => ({ action: "accept", content: { confirm: true, typed: "folder" } }) });
    const r1 = await wrong.client.callTool({ name: "delete_path", arguments: { path: dir } });
    expect(text(r1)).toContain("typed confirmation did not match");
    expect(trash).not.toHaveBeenCalled();

    const right = await connect({ answer: () => ({ action: "accept", content: { confirm: true, typed: dir } }) });
    const r2 = await right.client.callTool({ name: "delete_path", arguments: { path: dir } });
    expect(text(r2)).toContain('"trashed": true');
    expect(trash).toHaveBeenCalledWith(dir);
  });

  it("a single file does not ask for typing", async () => {
    const f = uniq("plain.txt");
    await writeFile(f, "x");
    vi.spyOn(MacClient.prototype, "trashPath").mockResolvedValue();
    const { client } = await connect({}); // answer carries no `typed` field
    const res = await client.callTool({ name: "delete_path", arguments: { path: f } });
    expect(text(res)).toContain('"trashed": true');
  });

  it("does NOT trash a folder when an entry was added while the human was deciding", async () => {
    const dir = uniq("grow");
    await mkdir(dir);
    await writeFile(path.join(dir, "a.txt"), "a");
    const trash = vi.spyOn(MacClient.prototype, "trashPath").mockResolvedValue();
    const { client } = await connect({
      answer: async () => {
        await writeFile(path.join(dir, "b.txt"), "b");
        return { action: "accept", content: { confirm: true, typed: dir } };
      },
    });
    const res = await client.callTool({ name: "delete_path", arguments: { path: dir } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(trash).not.toHaveBeenCalled();
  });
});

describe("write_file overwrite approval (end to end)", () => {
  it("does NOT overwrite when the file changed while the human was deciding", async () => {
    const f = uniq("cfg.txt");
    await writeFile(f, "old");
    const write = vi.spyOn(MacClient.prototype, "writeFile").mockResolvedValue();
    const { client } = await connect({
      answer: async () => {
        await appendFile(f, "!");
        return { action: "accept", content: { confirm: true } };
      },
    });
    const res = await client.callTool({ name: "write_file", arguments: { path: f, content: "new" } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(write).not.toHaveBeenCalled();
  });

  it("overwrites when the file is unchanged, and the prompt shows the exact arguments", async () => {
    const f = uniq("cfg.txt");
    await writeFile(f, "old");
    const write = vi.spyOn(MacClient.prototype, "writeFile").mockResolvedValue();
    const { client, prompts } = await connect({});
    const res = await client.callTool({ name: "write_file", arguments: { path: f, content: "new" } });
    expect(text(res)).toContain('"written": true');
    expect(write).toHaveBeenCalledWith(f, "new");
    expect(prompts[0]).toContain("tool: write_file");
    expect(prompts[0]).toContain(JSON.stringify({ content: "new", path: f }));
    expect(prompts[0]).toMatch(/resource version: [0-9a-f]{12}/);
  });

  it("creating a new file does not prompt", async () => {
    const write = vi.spyOn(MacClient.prototype, "writeFile").mockResolvedValue();
    const { client, prompts } = await connect({});
    await client.callTool({ name: "write_file", arguments: { path: uniq("brand-new.txt"), content: "x" } });
    expect(prompts).toHaveLength(0);
    expect(write).toHaveBeenCalled();
  });
});

describe("run_command / run_applescript approval (the exact text is what is bound)", () => {
  it("run_command shows the exact argv and fingerprint, and runs only after approval", async () => {
    const run = vi.spyOn(MacClient.prototype, "run").mockResolvedValue({ code: 0, stdout: "hi", stderr: "", timedOut: false });
    const { client, prompts } = await connect({});
    const res = await client.callTool({ name: "run_command", arguments: { command: "zsh", args: ["-c", "echo hi; id"] } });
    expect(text(res)).toContain('"code": 0');
    expect(run).toHaveBeenCalledWith("zsh", ["-c", "echo hi; id"], { cwd: undefined });
    expect(prompts[0]).toContain("tool: run_command");
    expect(prompts[0]).toContain('{"args":["-c","echo hi; id"],"command":"zsh"}');
    expect(prompts[0]).toMatch(/fingerprint: [0-9a-f]{16}/);
  });

  it("different command text produces a different fingerprint", async () => {
    vi.spyOn(MacClient.prototype, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "", timedOut: false });
    const { client, prompts } = await connect({});
    await client.callTool({ name: "run_command", arguments: { command: "echo", args: ["a"] } });
    await client.callTool({ name: "run_command", arguments: { command: "echo", args: ["b"] } });
    const fp = (p: string) => /fingerprint: ([0-9a-f]{16})/.exec(p)?.[1];
    expect(fp(prompts[0]!)).toBeDefined();
    expect(fp(prompts[0]!)).not.toBe(fp(prompts[1]!));
  });

  it("run_command does not run when the human declines", async () => {
    const run = vi.spyOn(MacClient.prototype, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "", timedOut: false });
    const { client } = await connect({ answer: () => ({ action: "decline" }) });
    const res = await client.callTool({ name: "run_command", arguments: { command: "echo", args: ["x"] } });
    expect(text(res)).toContain("declined by the user");
    expect(run).not.toHaveBeenCalled();
  });

  it("run_applescript shows the full script text (not just the 120-char preview)", async () => {
    const osa = vi.spyOn(MacClient.prototype, "osa").mockResolvedValue("ok");
    const script = `tell application "Finder" to ${"-- padding ".repeat(15)}\nquit`;
    expect(script.length).toBeGreaterThan(120);
    const { client, prompts } = await connect({});
    await client.callTool({ name: "run_applescript", arguments: { script, language: "AppleScript" } });
    expect(osa).toHaveBeenCalledWith(script, "AppleScript");
    expect(prompts[0]).toContain("tool: run_applescript");
    expect(prompts[0]).toContain(JSON.stringify(script).slice(1, -1)); // full text, JSON-escaped
  });
});

describe("kill_process approval", () => {
  it("does NOT signal when the pid now belongs to a different process", async () => {
    vi.spyOn(MacClient.prototype, "processIdentity").mockResolvedValue({ started: "Mon Nov 11 10:00:00 2026", command: "/usr/bin/sleep 600" });
    const versions = ["p1", "p2"];
    vi.spyOn(MacClient.prototype, "processVersion").mockImplementation(async () => versions.shift());
    const kill = vi.spyOn(MacClient.prototype, "killProcess").mockImplementation(() => {});
    const { client, prompts } = await connect({});
    const res = await client.callTool({ name: "kill_process", arguments: { pid: 4242, signal: "KILL" } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(kill).not.toHaveBeenCalled();
    expect(prompts[0]).toContain("process: /usr/bin/sleep 600");
  });

  it("signals when the process is unchanged", async () => {
    vi.spyOn(MacClient.prototype, "processIdentity").mockResolvedValue({ started: "t", command: "sleep 1" });
    vi.spyOn(MacClient.prototype, "processVersion").mockResolvedValue("p1");
    const kill = vi.spyOn(MacClient.prototype, "killProcess").mockImplementation(() => {});
    const { client } = await connect({});
    await client.callTool({ name: "kill_process", arguments: { pid: 4242, signal: "TERM" } });
    expect(kill).toHaveBeenCalledWith(4242, "SIGTERM");
  });
});

describe("MACOS_REQUIRE_HUMAN_APPROVAL", () => {
  it("falls back to the flags when the client cannot elicit (default)", async () => {
    const f = uniq("fallback.txt");
    await writeFile(f, "x");
    const trash = vi.spyOn(MacClient.prototype, "trashPath").mockResolvedValue();
    const { client } = await connect({ elicits: false });
    await client.callTool({ name: "delete_path", arguments: { path: f } });
    expect(trash).toHaveBeenCalledWith(f);
  });

  it("refuses delete_path with no elicitation when human approval is required", async () => {
    const f = uniq("required.txt");
    await writeFile(f, "x");
    const trash = vi.spyOn(MacClient.prototype, "trashPath").mockResolvedValue();
    const { client } = await connect({ elicits: false, requireHuman: true });
    const res = await client.callTool({ name: "delete_path", arguments: { path: f } });
    expect(text(res)).toContain("no human approval channel");
    expect(trash).not.toHaveBeenCalled();
  });

  it("refuses run_command with no elicitation when human approval is required", async () => {
    const run = vi.spyOn(MacClient.prototype, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "", timedOut: false });
    const { client } = await connect({ elicits: false, requireHuman: true });
    const res = await client.callTool({ name: "run_command", arguments: { command: "echo", args: ["x"] } });
    expect(text(res)).toContain("no human approval channel");
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses run_applescript with no elicitation when human approval is required", async () => {
    const osa = vi.spyOn(MacClient.prototype, "osa").mockResolvedValue("ok");
    const { client } = await connect({ elicits: false, requireHuman: true });
    const res = await client.callTool({ name: "run_applescript", arguments: { script: "beep" } });
    expect(text(res)).toContain("no human approval channel");
    expect(osa).not.toHaveBeenCalled();
  });
});

describe("MacClient.pathVersion (canonical-path version token)", () => {
  const mc = () => new MacClient(limits);

  it("is the same through a symlink as for the real path (computed on the canonical path)", async () => {
    const real = uniq("real.txt");
    await writeFile(real, "abc");
    const link = uniq("alias.txt");
    await symlink(real, link);
    expect(await mc().pathVersion(link)).toBe(await mc().pathVersion(real));
  });

  it("is stable when nothing changes and changes with size, mtime and inode", async () => {
    const f = uniq("tok.txt");
    await writeFile(f, "abc");
    const t0 = await mc().pathVersion(f);
    expect(await mc().pathVersion(f)).toBe(t0);
    await appendFile(f, "d");
    const t1 = await mc().pathVersion(f);
    expect(t1).not.toBe(t0);
    const when = new Date("2020-01-01T00:00:00Z");
    await utimes(f, when, when);
    const t2 = await mc().pathVersion(f);
    expect(t2).not.toBe(t1);
    const other = uniq("tok-other.txt");
    await writeFile(other, "abcd");
    await utimes(other, when, when);
    await rename(other, f); // same size + mtime, new inode
    expect(await mc().pathVersion(f)).not.toBe(t2);
  });

  it("for a directory covers the entry count", async () => {
    const d = uniq("tokdir");
    await mkdir(d);
    await writeFile(path.join(d, "a"), "1");
    const t0 = await mc().pathVersion(d);
    await writeFile(path.join(d, "b"), "2");
    expect(await mc().pathVersion(d)).not.toBe(t0);
  });

  it("is undefined for a path that does not exist", async () => {
    expect(await mc().pathVersion(uniq("missing"))).toBeUndefined();
    expect(await mc().pathVersion(path.join(uniq("missing-dir"), "child"))).toBeUndefined();
  });
});

describe("MacClient.processVersion", () => {
  it("is stable for a live process and undefined for a pid that does not exist", async () => {
    const mc = new MacClient(limits);
    const a = await mc.processVersion(process.pid);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(await mc.processVersion(process.pid)).toBe(a);
    expect(await mc.processVersion(2 ** 22 - 1)).toBeUndefined();
  });
});
