import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalize, resolvePath } from "../src/config.js";
import { PolicyError, SecurityPolicy, type SecurityConfig } from "../src/security.js";

/**
 * Regression test for the symlink allowlist-bypass: a symlink INSIDE an allowed
 * root that points OUTSIDE it must not grant read/write access to the target.
 * The fix canonicalizes (realpath) before the allowlist check.
 */
let allowed: string; // the allowlisted sandbox root
let outside: string; // a directory outside the allowlist, with a "secret"
let secret: string;

function policy(allowRoot: string): SecurityPolicy {
  const cfg: SecurityConfig = {
    mode: "admin",
    pathAllowlist: [allowRoot],
    protectedPaths: [],
    allowExec: false,
    commandAllowlist: [],
    allowDelete: true,
    allowInput: false,
    dryRun: false,
    auditLog: false,
  };
  return new SecurityPolicy(cfg);
}

beforeAll(async () => {
  // realpath the base so comparisons are symlink-stable (macOS /var -> /private/var).
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "mcp-macos-symlink-")));
  allowed = path.join(base, "sandbox");
  await mkdir(allowed);
  outside = path.join(base, "outside");
  await mkdir(outside);
  secret = path.join(outside, "secret.txt");
  await writeFile(secret, "TOP SECRET", "utf8");
});

afterAll(async () => {
  await rm(path.dirname(allowed), { recursive: true, force: true }).catch(() => {});
});

describe("symlink allowlist bypass", () => {
  it("a symlink inside the sandbox pointing outside is canonicalized to the real target", async () => {
    const link = path.join(allowed, "leak");
    await symlink(secret, link);
    const canon = await canonicalize(resolvePath(link));
    expect(canon).toBe(secret); // resolved out of the sandbox
    expect(policy(allowed).isPathAllowed(canon)).toBe(false); // ...and thus rejected
  });

  it("guard() throws for a read through such a symlink", async () => {
    const link = path.join(allowed, "leak2");
    await symlink(secret, link);
    const canon = await canonicalize(resolvePath(link));
    expect(() => policy(allowed).guard({ tool: "read_file", capability: "read", path: canon })).toThrow(
      PolicyError,
    );
  });

  it("a brand-new file under a symlinked subdir cannot escape (parent is canonicalized)", async () => {
    const linkDir = path.join(allowed, "outlink");
    await symlink(outside, linkDir); // sandbox/outlink -> outside/
    const target = path.join(linkDir, "new.txt"); // does not exist yet
    const canon = await canonicalize(resolvePath(target));
    expect(canon).toBe(path.join(outside, "new.txt"));
    expect(policy(allowed).isPathAllowed(canon)).toBe(false);
  });

  it("a legitimate file genuinely inside the sandbox is still allowed", async () => {
    const real = path.join(allowed, "notes.txt");
    await writeFile(real, "ok", "utf8");
    const canon = await canonicalize(resolvePath(real));
    expect(canon).toBe(real);
    expect(policy(allowed).isPathAllowed(canon)).toBe(true);
    expect(() => policy(allowed).guard({ tool: "read_file", capability: "read", path: canon })).not.toThrow();
  });
});
