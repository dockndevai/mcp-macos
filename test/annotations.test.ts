import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "../src/server.js";
import { annotationsFor } from "../src/tools/annotations.js";

describe("tool annotations", () => {
  it("declares a known capability for every tool (safe-by-default gate)", () => {
    for (const t of ALL_TOOLS) {
      expect(["read", "write", "admin"], t.name).toContain(t.capability);
    }
  });

  it("marks every read tool read-only, non-destructive, and idempotent", () => {
    for (const t of ALL_TOOLS.filter((t) => t.capability === "read")) {
      const a = annotationsFor(t);
      expect(a.readOnlyHint, t.name).toBe(true);
      expect(a.destructiveHint, t.name).toBe(false);
      expect(a.idempotentHint, t.name).toBe(true);
    }
  });

  it("never marks a write or admin tool read-only", () => {
    for (const t of ALL_TOOLS.filter((t) => t.capability !== "read")) {
      expect(annotationsFor(t).readOnlyHint, t.name).toBe(false);
    }
  });

  it("derives destructiveHint from capability, honouring an explicit destructive flag", () => {
    // Admin tools are destructive by default; GUI-input tools opt out via destructive:false.
    for (const t of ALL_TOOLS.filter((t) => t.capability !== "read")) {
      const expected = t.destructive ?? t.capability === "admin";
      expect(annotationsFor(t).destructiveHint, t.name).toBe(expected);
    }
  });

  it("sets a title and openWorldHint on every tool", () => {
    for (const t of ALL_TOOLS) {
      const a = annotationsFor(t);
      expect(a.title, t.name).toBeTruthy();
      expect(a.openWorldHint, t.name).toBe(true);
    }
  });
});
