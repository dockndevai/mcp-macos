import os from "node:os";
import path from "node:path";
import type { AccessMode, SecurityConfig } from "./security.js";

export interface RuntimeLimits {
  /** Max bytes returned when reading a file. */
  maxFileBytes: number;
  /** Max bytes of stdout/stderr returned from a command. */
  maxOutputBytes: number;
  /** Default timeout for shell / AppleScript execution (ms). */
  commandTimeoutMs: number;
}

export interface AppConfig {
  security: SecurityConfig;
  limits: RuntimeLimits;
}

const HOME = os.homedir();

/** Expand a leading `~` and resolve to an absolute, normalized path. */
export function resolvePath(p: string): string {
  let s = p.trim();
  if (s === "~") s = HOME;
  else if (s.startsWith("~/")) s = path.join(HOME, s.slice(2));
  return path.resolve(s);
}

function csv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(name: string, dflt = false): boolean {
  const v = process.env[name];
  if (v === undefined) return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

function num(name: string, dflt: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

function parseMode(): AccessMode {
  const raw = (process.env.MACOS_MODE ?? "read-only").toLowerCase();
  if (raw === "read-only" || raw === "read-write" || raw === "admin") return raw;
  throw new Error(`Invalid MACOS_MODE '${raw}'. Expected one of: read-only, read-write, admin.`);
}

/** Sensitive roots that may be read but never mutated, unless the operator overrides the list. */
const DEFAULT_PROTECTED = [
  "/System",
  "/usr",
  "/bin",
  "/sbin",
  "/private",
  "/Library",
  path.join(HOME, ".ssh"),
  path.join(HOME, ".aws"),
  path.join(HOME, ".gnupg"),
  path.join(HOME, "Library", "Keychains"),
];

export function loadConfig(): AppConfig {
  const protectedRaw = csv("MACOS_PROTECTED_PATHS");
  const security: SecurityConfig = {
    mode: parseMode(),
    pathAllowlist: csv("MACOS_PATH_ALLOWLIST").map(resolvePath),
    protectedPaths: (protectedRaw.length ? protectedRaw : DEFAULT_PROTECTED).map(resolvePath),
    allowExec: bool("MACOS_ALLOW_EXEC"),
    commandAllowlist: csv("MACOS_COMMAND_ALLOWLIST"),
    allowDelete: bool("MACOS_ALLOW_DELETE"),
    allowInput: bool("MACOS_ALLOW_INPUT"),
    dryRun: bool("MACOS_DRY_RUN"),
    auditLog: bool("MACOS_AUDIT_LOG", true),
  };
  const limits: RuntimeLimits = {
    maxFileBytes: num("MACOS_MAX_FILE_BYTES", 1_000_000),
    maxOutputBytes: num("MACOS_MAX_OUTPUT_BYTES", 100_000),
    commandTimeoutMs: num("MACOS_COMMAND_TIMEOUT_MS", 30_000),
  };
  return { security, limits };
}
