# Installing `mcp-macos` in your MCP client

`mcp-macos` is a **stdio** MCP server (macOS only). Any MCP-compatible agent can run it via `npx -y @dockndevai/mcp-macos` (or `node /ABSOLUTE/PATH/TO/mcp-macos/dist/index.js` from source).

> **Start in `read-only` mode** and raise it deliberately. High-impact powers also need their own flag (`MACOS_ALLOW_EXEC` / `_DELETE` / `_INPUT`). See [`.env.example`](../.env.example) for every variable, and grant the host process the macOS permissions listed in the [README](../README.md#macos-permissions).

## Claude Code (CLI)

```bash
claude mcp add macos \
  -e MACOS_MODE="read-only" \
  -- npx -y @dockndevai/mcp-macos
```

Add `-s user` to install it for all your projects. List with `claude mcp list`, remove with `claude mcp remove macos`.

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` and merge:

```json
{
  "mcpServers": {
    "macos": {
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-macos"],
      "env": { "MACOS_MODE": "read-only" }
    }
  }
}
```

Restart Claude Desktop. The server appears under the tools (🔨) menu.

## Cursor

Create `.cursor/mcp.json` (or `~/.cursor/mcp.json` for all projects):

```json
{
  "mcpServers": {
    "macos": {
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-macos"],
      "env": { "MACOS_MODE": "read-only" }
    }
  }
}
```

Then enable it in **Cursor Settings → MCP**.

## OpenAI Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.macos]
command = "npx"
args = ["-y", "@dockndevai/mcp-macos"]
env = { MACOS_MODE = "read-only" }
```

## Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "macos": {
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-macos"],
      "env": { "MACOS_MODE": "read-only" }
    }
  }
}
```

Then **Refresh** in the Windsurf MCP settings panel.

## VS Code (GitHub Copilot / Agent mode)

Create `.vscode/mcp.json` (top-level key is `servers`):

```json
{
  "servers": {
    "macos": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-macos"],
      "env": { "MACOS_MODE": "read-only" }
    }
  }
}
```

## Verify

On startup the server logs to **stderr**:

```
[macos-mcp] Starting in 'read-only' mode. 8 tools enabled: …
```

Ask your agent to *"list the macOS tools"* or *"show system_info"* to confirm it's connected. To enable writes, set `MACOS_MODE=read-write`; for exec/delete/GUI, set `MACOS_MODE=admin` plus the matching `MACOS_ALLOW_*` flag.
