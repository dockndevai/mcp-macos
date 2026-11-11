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
- **Require a human for destructive ops.** Set `MACOS_REQUIRE_HUMAN_APPROVAL=true` so `run_command`,
  `run_applescript`, `delete_path`, `kill_process` and file overwrites are refused when the client cannot show
  an approval prompt. Each approval is bound to the exact tool and arguments (fingerprint, so the command text
  or script you were shown is what runs) and, where there is a target, to its version: for `delete_path` and
  file overwrites the canonical (symlink-resolved) path plus inode, mtime and size (a folder: entry count
  instead of size); for `kill_process` the pid plus process start time and command line. If the target
  changed while the human was deciding, the action is refused. Trashing a folder also asks the human to
  type its path. Approval receipts are written to the audit log (`"audit":"approval"`, with `approvedBy` =
  `human` or `flag-only`). Limits: a folder's token covers only its immediate entries, and the prompt shows
  the first 1500 characters of the arguments (the fingerprint covers all of them).
  `write_file` creates a path that did not exist with exclusive-create (`O_EXCL`) and never follows a symlink at the
  final path component (`O_NOFOLLOW`, also on overwrites): a file or link that appears at the target between the
  existence check and the write is re-resolved, re-checked against the allowlist and put to the human as an overwrite
  (refused in strict mode), never silently overwritten; a dangling symlink at the target is refused. Limit: only the
  last path component is protected — a parent directory swapped for a symlink in the same instant is not detected.
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
