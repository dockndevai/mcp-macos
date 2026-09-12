# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
