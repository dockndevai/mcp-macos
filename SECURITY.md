# Security

`mcp-macos` can drive an entire Mac — read and write files, run commands and
AppleScript, delete, kill processes, and inject keyboard/mouse input. Treat it as
a highly privileged automation and grant it the least access that gets the job done.

## Principles

- **Start read-only.** Leave `MACOS_MODE=read-only` until you need more. Tools above
  the current mode are **never registered** — an agent can't call what isn't there.
- **Every high-impact power is opt-in twice.** On top of `admin` mode, arbitrary
  execution and process kills need `MACOS_ALLOW_EXEC=true`, deletes need
  `MACOS_ALLOW_DELETE=true`, and GUI input needs `MACOS_ALLOW_INPUT=true`.
- **Confine the filesystem.** Set `MACOS_PATH_ALLOWLIST` to the directories the agent
  should touch. Sensitive roots (`/System`, `/usr`, `/bin`, `/sbin`, `/private`,
  `/Library`, `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/Library/Keychains`) are read-only
  forever via `MACOS_PROTECTED_PATHS` and never mutated.
- **Restrict which programs can run.** Use `MACOS_COMMAND_ALLOWLIST` to limit
  `run_command` to a specific set of binaries.
- **Humans approve the dangerous calls.** When the client supports MCP elicitation,
  `run_command`, `run_applescript`, `delete_path`, `kill_process` and file overwrites
  pause and ask you to approve before running — a model can't self-approve. Without
  elicitation, the `MACOS_ALLOW_*` flags remain the gate.
- **Deletes are recoverable.** `delete_path` moves items to the Trash, not `rm`.
- **Preview with dry-run.** `MACOS_DRY_RUN=true` validates and logs intent without
  touching the machine.
- **Keep the audit log on.** `MACOS_AUDIT_LOG=true` (default) writes a JSON line per
  guarded operation to stderr — ship it to your logging pipeline.
- **macOS permissions are the outer gate.** The host process still needs Screen
  Recording, Accessibility, Automation and file-access grants; nothing bypasses a
  permission you haven't granted in System Settings.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a
public issue.
