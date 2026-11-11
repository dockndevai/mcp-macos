import { mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "../src/config.js";
import { FileExistsError, MacClient } from "../src/mac/client.js";
import { buildServer } from "../src/server.js";

/**
 * write_file skips the overwrite approval when the target does not exist at check time. These tests
 * inject the creation of the target BETWEEN that check (MacClient.pathExists) and the write, which is
 * the window the race lives in, and assert the new file is never silently overwritten and that a
 * symlink planted there is never followed.
 */
let base: string; // realpath'd temp root = the allowlist
let outside: string; // a sibling directory that is NOT allowlisted
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

async function connect(opts: { requireHuman?: boolean; answer?: Answer; elicits?: boolean } = {}) {
  const { server } = buildServer(config(opts.requireHuman));
  const prompts: string[] = [];
  const client = new Client({ name: "t", version: "0" }, { capabilities: opts.elicits === false ? {} : { elicitation: {} } });
  if (opts.elicits !== false) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      prompts.push(req.params.message);
      return opts.answer ?? { action: "accept", content: { confirm: true } };
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, prompts };
}

const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? "");
const decline: Answer = { action: "decline" };
let n = 0;
const uniq = (name: string) => path.join(base, `${name}-${++n}`);

/** After the FIRST existence check returns, run `plant` — i.e. act inside the check-to-write window. */
function raceAfterExistenceCheck(plant: (abs: string) => Promise<void>) {
  const original = MacClient.prototype.pathExists;
  return vi.spyOn(MacClient.prototype, "pathExists").mockImplementationOnce(async function (this: MacClient, abs: string) {
    const existed = await original.call(this, abs);
    await plant(abs);
    return existed;
  });
}

beforeAll(async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "mcp-macos-race-")));
  base = path.join(root, "allowed");
  outside = path.join(root, "outside");
  await mkdir(base);
  await mkdir(outside);
});
afterAll(async () => {
  await rm(path.dirname(base), { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

describe("write_file: target created between the existence check and the write", () => {
  it("does not overwrite it silently; the human is asked and a refusal leaves the file intact", async () => {
    const f = uniq("raced.txt");
    raceAfterExistenceCheck((abs) => writeFile(abs, "PRECIOUS"));
    const { client, prompts } = await connect({ answer: decline });
    const res = await client.callTool({ name: "write_file", arguments: { path: f, content: "clobber" } });
    expect(await readFile(f, "utf8")).toBe("PRECIOUS");
    expect(text(res)).toContain("Write cancelled");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("overwrite file");
    expect(prompts[0]).toContain(`"${f}"`);
  });

  it("overwrites only after the human approves the (now existing) file", async () => {
    const f = uniq("raced.txt");
    raceAfterExistenceCheck((abs) => writeFile(abs, "PRECIOUS"));
    const { client, prompts } = await connect();
    const res = await client.callTool({ name: "write_file", arguments: { path: f, content: "approved" } });
    expect(text(res)).toContain('"written": true');
    expect(prompts).toHaveLength(1);
    expect(await readFile(f, "utf8")).toBe("approved");
  });

  it("strict mode with no way to ask a human refuses instead of overwriting", async () => {
    const f = uniq("raced.txt");
    raceAfterExistenceCheck((abs) => writeFile(abs, "PRECIOUS"));
    const { client } = await connect({ requireHuman: true, elicits: false });
    const res = await client.callTool({ name: "write_file", arguments: { path: f, content: "clobber" } });
    expect(text(res)).toContain("Write cancelled");
    expect(await readFile(f, "utf8")).toBe("PRECIOUS");
  });

  it("a symlink planted at the leaf in the window is not followed out of the allowlist", async () => {
    const f = uniq("raced-link.txt");
    const victim = path.join(outside, `victim-${n}.txt`);
    await writeFile(victim, "OUTSIDE");
    raceAfterExistenceCheck((abs) => symlink(victim, abs));
    const { client, prompts } = await connect();
    const res = await client.callTool({ name: "write_file", arguments: { path: f, content: "clobber" } });
    expect(res.isError).toBe(true);
    expect(await readFile(victim, "utf8")).toBe("OUTSIDE");
    expect(await readlink(f)).toBe(victim); // still the planted link: nothing replaced it
    expect(prompts).toHaveLength(0); // refused by the path policy before any prompt
  });

  it("a symlink planted in the window to another allowlisted file is resolved, shown and asked about", async () => {
    const f = uniq("raced-inlink.txt");
    const target = uniq("inner-target.txt");
    await writeFile(target, "INNER");
    raceAfterExistenceCheck((abs) => symlink(target, abs));
    const { client, prompts } = await connect({ answer: decline });
    const res = await client.callTool({ name: "write_file", arguments: { path: f, content: "clobber" } });
    expect(text(res)).toContain("Write cancelled");
    expect(prompts[0]).toContain(`"${target}"`); // the real file the write would hit, not the lexical link
    expect(await readFile(target, "utf8")).toBe("INNER");
  });

  it("a dangling symlink already at the leaf is never created through", async () => {
    const f = uniq("dangling.txt");
    const victim = path.join(outside, `never-created-${n}.txt`);
    await symlink(victim, f); // dangling: victim does not exist
    const { client } = await connect();
    const res = await client.callTool({ name: "write_file", arguments: { path: f, content: "clobber" } });
    expect(text(res)).toContain("Write refused");
    await expect(readFile(victim, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creating a genuinely new file still works without a prompt", async () => {
    const f = uniq("fresh.txt");
    const { client, prompts } = await connect();
    const res = await client.callTool({ name: "write_file", arguments: { path: f, content: "hello" } });
    expect(text(res)).toContain('"written": true');
    expect(prompts).toHaveLength(0);
    expect(await readFile(f, "utf8")).toBe("hello");
  });
});

describe("write_file overwrite: symlink swapped in after the human approved", () => {
  it("is refused rather than followed (O_NOFOLLOW)", async () => {
    const f = uniq("swap.txt");
    const victim = path.join(outside, `swap-victim-${n}.txt`);
    await writeFile(f, "old");
    await writeFile(victim, "OUTSIDE");
    // The confirmer reads the version before and after the prompt; swap once the second read is done.
    const original = MacClient.prototype.pathVersion;
    let calls = 0;
    vi.spyOn(MacClient.prototype, "pathVersion").mockImplementation(async function (this: MacClient, abs: string) {
      const v = await original.call(this, abs);
      if (++calls === 2) {
        await unlink(f);
        await symlink(victim, f);
      }
      return v;
    });
    const { client } = await connect();
    const res = await client.callTool({ name: "write_file", arguments: { path: f, content: "clobber" } });
    expect(calls).toBe(2);
    expect(res.isError).toBe(true);
    expect(await readFile(victim, "utf8")).toBe("OUTSIDE");
  });
});

describe("MacClient.writeFile exclusive mode", () => {
  const client = new MacClient(limits);

  it("throws FileExistsError and keeps the content when the file exists", async () => {
    const f = uniq("exists.txt");
    await writeFile(f, "keep");
    await expect(client.writeFile(f, "new", { exclusive: true })).rejects.toBeInstanceOf(FileExistsError);
    expect(await readFile(f, "utf8")).toBe("keep");
  });

  it("throws FileExistsError for a dangling symlink and does not create its target", async () => {
    const f = uniq("dangle.txt");
    const victim = path.join(outside, `client-victim-${n}.txt`);
    await symlink(victim, f);
    await expect(client.writeFile(f, "new", { exclusive: true })).rejects.toBeInstanceOf(FileExistsError);
    await expect(readFile(victim, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates a new file", async () => {
    const f = uniq("new.txt");
    await client.writeFile(f, "hi", { exclusive: true });
    expect(await readFile(f, "utf8")).toBe("hi");
  });
});
