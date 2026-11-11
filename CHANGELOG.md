# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-11-11

### Security
- **Approval no longer fails open on timeout.** The human-approval prompt used the MCP SDK's default
  60 s request timeout, and a timeout fell through to "approved" (the `MACOS_ALLOW_*` gate had already
  passed). A prompt nobody answered therefore auto-approved a destructive operation. A timeout is now a
  refusal, and the wait defaults to 5 minutes.

### Added
- **Approvals are bound to the exact action.** The prompt shows the tool, the full (secret-redacted)
  arguments (the command line / AppleScript text, not just a 120-character preview; the first 1500 characters are
  displayed, the fingerprint covers all of it) and a fingerprint;
  every approval and refusal is written to the audit log as `"audit":"approval"` with the fingerprint,
  resource version and `approvedBy` (`human` / `flag-only`).
- **Approvals are bound to the target's version.** `delete_path` and `write_file` (overwrite) read a version
  token before the prompt and again after the human answers, and refuse if it changed. The token is computed
  on the canonical (symlink-resolved) path and covers inode, mtime and size (a folder: entry count instead of
  size). `kill_process` pins the pid plus process start time and command line, so a recycled pid is not killed
  by an approval meant for another process.
- `MACOS_REQUIRE_HUMAN_APPROVAL=true` — refuse destructive ops when the client cannot elicit.
- `delete_path` on a folder asks the human to type the path.
- `kill_process` prompts now show the process command line and start time.

Tracking issue: https://github.com/dockndevai/mcp-core/issues/1

## [0.2.5] - 2026-11-09

### Changed
- Routine dependency maintenance: `npm audit --audit-level=high` reported 0 advisories (no high/critical vulnerabilities to fix this pass). Took in-range patch bump for `vitest` (5.0.5 → 5.1.0). `npm audit` reports 0 vulnerabilities. No feature or behavior changes.

## [0.2.4] - 2026-11-02

### Changed
- Routine dependency maintenance: `npm audit --audit-level=high` reported 0 advisories (no high/critical findings). Took in-range patch bump for `@types/node` (26.6.5 → 26.6.6). `npm audit` reports 0 vulnerabilities. No behavior change.

## [0.2.3] - 2026-10-26

### Changed
- Dependency/security maintenance: ran `npm audit fix --force` to clear a high-severity `body-parser` DoS advisory (GHSA-27r3-jxmh-p828, body-parser 2.3.0 → 2.4.0) and moderate `fast-uri` advisories (GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp, fast-uri 3.1.8 → 3.1.9), both transitive. Took in-range patch bump for `@modelcontextprotocol/sdk` (1.32.1 → 1.32.2). `npm audit` now reports 0 vulnerabilities. No feature or behavior changes.

## [0.2.2] - 2026-10-19

### Changed
- Routine dependency maintenance: `npm audit --audit-level=high` reported 0 advisories (no high/critical vulnerabilities to fix this pass). Took in-range patch bumps for `vitest` (5.0.3 → 5.0.5) and `zod` (4.6.6 → 4.6.7). No feature or behavior changes.

## [0.2.1] - 2026-10-12

### Changed
- Dependency/security maintenance: bumped `@modelcontextprotocol/sdk` (1.30.0 → 1.32.1, in-range) and transitive deps (`ip-address`, `proxy-addr`, `fast-uri`, `source-map-js`) to clear 5 npm audit advisories (1 critical, 2 high, 2 moderate). Took in-range patch bumps for `@types/node`, `tsx`, `vitest`, `zod`. `npm audit` now reports 0 vulnerabilities. No feature or behavior changes.

## [0.2.0] - 2026-09-29

### Added
- **Optional AI risk guard (laya-guard).** Mutating tools can consult a local [laya-guard](https://github.com/dockndevai/laya-guard) daemon that classifies each operation allow / confirm / block before it runs. Runs after the deterministic policy gates and can only *tighten*, never grant; fails closed. Off by default (`MACOS_GUARD_MODE=monitor|enforce`).

## [0.1.1] - 2026-09-12

### Changed
- Bring dependencies and CI to current majors: `zod` ^4, TypeScript ^7, `@types/node` ^26, `tsx` ^4.23, and GitHub Actions (checkout v7, setup-node v7, action-gh-release v3, gitleaks v3, codeql-action v4). Clears the open Dependabot updates; `npm audit` reports 0 vulnerabilities.

## [0.1.0]

### Added
- Initial release: a safe-by-default MCP server for macOS. 20 tools across
  read/read-write/admin — system info, files, processes, clipboard, apps and
  screenshots (read); write files, clipboard, notifications, open (read-write);
  run_command, run_applescript, delete_path (to Trash), kill_process and GUI
  input (type/key/click/move) behind admin mode + per-power opt-in flags.
- Security model: access modes, path allowlist and protected paths, per-power
  opt-ins (`MACOS_ALLOW_EXEC`/`_DELETE`/`_INPUT`), command allowlist, dry-run,
  JSON audit logging, and human-in-the-loop confirmation (MCP elicitation) on
  the exec/delete/kill tools and file overwrites.
- MCP tool annotations derived from each tool's capability, with a test keeping
  them consistent.
