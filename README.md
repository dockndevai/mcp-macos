# mcp-macos

[![npm](https://img.shields.io/npm/v/@dockndevai/mcp-macos)](https://www.npmjs.com/package/@dockndevai/mcp-macos)
[![CI](https://github.com/dockndevai/mcp-macos/actions/workflows/ci.yml/badge.svg)](https://github.com/dockndevai/mcp-macos/actions/workflows/ci.yml)
[![licence](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

A **safe-by-default** [Model Context Protocol](https://modelcontextprotocol.io) server that lets an agent **observe and operate a Mac** — read files, list processes and apps, take screenshots (read-only); write files, set the clipboard, post notifications, open things (read-write); and, behind explicit opt-ins, **run commands / AppleScript, delete to Trash, kill processes and drive the GUI** (admin).

It starts **read-only**. Every high-impact power needs both `admin` mode **and** its own flag, and the most dangerous ones ask the **human** to approve each call. Part of the [dockndevai MCP server suite](https://dockndevai.github.io/) — one governance model across all of them.

> Pure Node + `osascript`/`screencapture` — no native add-ons. macOS only.

## What it gives an agent

The server starts **read-only** (see [Safe by default](#safe-by-default)); higher-capability tools are only registered when you raise the mode.

| Tool | For | Needs mode |
|---|---|---|
| `system_info` | macOS version, hardware, memory, load, uptime | read-only |
| `list_directory` / `read_file` | browse & read files (path-allowlisted) | read-only |
| `list_processes` | running processes by CPU/mem | read-only |
| `get_clipboard` | read the clipboard | read-only |
| `list_apps` / `get_frontmost_app` | running apps; the active one | read-only |
| `screenshot` | capture the screen as a PNG | read-only |
| `write_file` | create/overwrite a file (confirms on overwrite) | read-write |
| `set_clipboard` / `notify` / `open` | set clipboard, notify, open a file/URL/app | read-write |
| `run_command` | run a program (argv, no shell) | admin + `MACOS_ALLOW_EXEC` |
| `run_applescript` | run AppleScript / JXA | admin + `MACOS_ALLOW_EXEC` |
| `kill_process` | signal a process | admin + `MACOS_ALLOW_EXEC` |
| `delete_path` | move a path to the Trash | admin + `MACOS_ALLOW_DELETE` |
| `type_text` / `key_press` / `click` / `move_mouse` | drive the GUI | admin + `MACOS_ALLOW_INPUT` |

## Install

```bash
npx -y @dockndevai/mcp-macos
```

Requires **macOS** and **Node ≥ 22**. `click`/`move_mouse` also need [`cliclick`](https://github.com/BlueM/cliclick) (`brew install cliclick`).

## Configure

```json
{
  "mcpServers": {
    "macos": {
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-macos"],
      "env": {
        "MACOS_MODE": "read-only"
      }
    }
  }
}
```

See [docs/CLIENTS.md](docs/CLIENTS.md) for Claude Code / Cursor / Codex / VS Code / Windsurf snippets, and [.env.example](.env.example) for every supported variable.

## Safe by default

This server can drive an entire Mac, so the access model (enforced by [`src/security.ts`](src/security.ts)) is deliberately strict — defence in depth, not documentation:

| Question | Setting | Default | Notes |
|---|---|---|---|
| What can it do at all? | `MACOS_MODE` | `read-only` | `read-only` observes; `read-write` writes files/clipboard/opens; `admin` adds exec/delete/kill/GUI. Tools above the mode are **never registered**. |
| Which paths can it touch? | `MACOS_PATH_ALLOWLIST` | *(anywhere)* | Comma-separated roots. When set, any file op outside them is refused. |
| Which paths are read-only forever? | `MACOS_PROTECTED_PATHS` | system + secrets | `/System`, `/usr`, `/bin`, `/sbin`, `/private`, `/Library`, `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/Library/Keychains` — readable, never mutated. |
| Can it run commands? | `MACOS_ALLOW_EXEC` | `false` | Gates `run_command`, `run_applescript`, `kill_process` (on top of admin). |
| Restrict which programs? | `MACOS_COMMAND_ALLOWLIST` | *(any)* | When set, `run_command` may only invoke these program names. |
| Can it delete? | `MACOS_ALLOW_DELETE` | `false` | Gates `delete_path` (moves to the **Trash**, recoverable). |
| Can it drive the GUI? | `MACOS_ALLOW_INPUT` | `false` | Gates `type_text`/`key_press`/`click`/`move_mouse`. |
| Preview without doing | `MACOS_DRY_RUN` | `false` | Mutating tools validate + log intent, then return. |
| Audit trail | `MACOS_AUDIT_LOG` | `true` | JSON line to stderr per guarded operation (`ALLOW`/`DENY`/`DRY_RUN`). |
| Interactive confirmation | *(automatic)* | — | `run_command`, `run_applescript`, `delete_path`, `kill_process` and file overwrites ask the human to approve via MCP elicitation before running; clients without elicitation fall back to the flags. |

See [SECURITY.md](SECURITY.md).

## macOS permissions

The host process (your terminal / MCP client) must be granted, in **System Settings → Privacy & Security**:

- **Screen Recording** — for `screenshot`.
- **Accessibility** — for `type_text` / `key_press` / `click` / `move_mouse`.
- **Automation** (per-app prompts) — for `run_applescript` and app control.
- **Files and Folders / Full Disk Access** — to read/write outside the default sandbox.

You'll be prompted the first time each is needed; nothing works around a permission you haven't granted.

## Developing

```bash
npm install
npm run build
MACOS_MODE=read-only node dist/index.js
# introspect the tool list:
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js
```

## Licence

MIT
