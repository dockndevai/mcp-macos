# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
