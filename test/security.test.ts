import { describe, expect, it } from "vitest";
import { PolicyError, SecurityPolicy, isUnder, type SecurityConfig } from "../src/security.js";

function makePolicy(overrides: Partial<SecurityConfig> = {}): SecurityPolicy {
  return new SecurityPolicy({
    mode: "read-only",
    pathAllowlist: [],
    protectedPaths: ["/System", "/Users/me/.ssh"],
    allowExec: false,
    commandAllowlist: [],
    allowDelete: false,
    allowInput: false,
    dryRun: false,
    auditLog: false,
    ...overrides,
  });
}

describe("capability gating", () => {
  it("read-only enables read only", () => {
    const p = makePolicy();
    expect(p.isCapabilityEnabled("read")).toBe(true);
    expect(p.isCapabilityEnabled("write")).toBe(false);
    expect(p.isCapabilityEnabled("admin")).toBe(false);
  });
  it("admin enables everything", () => {
    const p = makePolicy({ mode: "admin" });
    expect(p.isCapabilityEnabled("write")).toBe(true);
    expect(p.isCapabilityEnabled("admin")).toBe(true);
  });
  it("guard throws when capability exceeds mode", () => {
    const p = makePolicy();
    expect(() => p.guard({ tool: "write_file", capability: "write" })).toThrow(PolicyError);
  });
});

describe("isUnder (path boundary)", () => {
  it("matches a path at or under a root, segment-aware", () => {
    expect(isUnder("/Users/me/docs", "/Users/me")).toBe(true);
    expect(isUnder("/Users/me", "/Users/me")).toBe(true);
    expect(isUnder("/Users/mentor", "/Users/me")).toBe(false); // no partial-segment match
    expect(isUnder("/tmp/x", "/")).toBe(true);
  });
});

describe("path allowlist + protected paths", () => {
  it("allows any path when the allowlist is empty", () => {
    expect(makePolicy().isPathAllowed("/anywhere")).toBe(true);
  });
  it("confines to the allowlist when set", () => {
    const p = makePolicy({ mode: "read-write", pathAllowlist: ["/tmp", "/Users/me/work"] });
    expect(p.isPathAllowed("/tmp/a")).toBe(true);
    expect(p.isPathAllowed("/Users/me/work/x")).toBe(true);
    expect(p.isPathAllowed("/etc/passwd")).toBe(false);
  });
  it("denies a mutation outside the allowlist", () => {
    const p = makePolicy({ mode: "read-write", pathAllowlist: ["/tmp"] });
    expect(() => p.guard({ tool: "write_file", capability: "write", path: "/etc/x", pathMutation: true })).toThrow(
      /allowlist/,
    );
  });
  it("refuses to mutate a protected path but allows reading it", () => {
    const p = makePolicy({ mode: "admin" });
    expect(() =>
      p.guard({ tool: "write_file", capability: "write", path: "/System/x", pathMutation: true }),
    ).toThrow(/protected/);
    // reading a protected path is fine
    expect(p.guard({ tool: "read_file", capability: "read", path: "/System/x" })).toEqual({ dryRun: false });
  });
});

describe("high-impact opt-in flags", () => {
  it("blocks exec unless allowExec", () => {
    expect(() =>
      makePolicy({ mode: "admin" }).guard({ tool: "run_command", capability: "admin", requiresExec: true }),
    ).toThrow(/MACOS_ALLOW_EXEC/);
    expect(
      makePolicy({ mode: "admin", allowExec: true }).guard({ tool: "run_command", capability: "admin", requiresExec: true }),
    ).toEqual({ dryRun: false });
  });
  it("enforces the command allowlist", () => {
    const p = makePolicy({ mode: "admin", allowExec: true, commandAllowlist: ["ls", "echo"] });
    expect(() => p.guard({ tool: "run_command", capability: "admin", requiresExec: true, command: "rm" })).toThrow(
      /allowlist/,
    );
    expect(p.guard({ tool: "run_command", capability: "admin", requiresExec: true, command: "echo" })).toEqual({
      dryRun: false,
    });
  });
  it("blocks delete unless allowDelete", () => {
    expect(() =>
      makePolicy({ mode: "admin" }).guard({ tool: "delete_path", capability: "admin", requiresDelete: true }),
    ).toThrow(/MACOS_ALLOW_DELETE/);
  });
  it("blocks GUI input unless allowInput", () => {
    expect(() =>
      makePolicy({ mode: "admin" }).guard({ tool: "type_text", capability: "admin", requiresInput: true }),
    ).toThrow(/MACOS_ALLOW_INPUT/);
  });
});

describe("dry-run", () => {
  it("returns dryRun for mutating ops but never for reads", () => {
    const p = makePolicy({ mode: "admin", allowExec: true, dryRun: true });
    expect(p.guard({ tool: "run_command", capability: "admin", requiresExec: true }).dryRun).toBe(true);
    expect(p.guard({ tool: "read_file", capability: "read" }).dryRun).toBe(false);
  });
});
