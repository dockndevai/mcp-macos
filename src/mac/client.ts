import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeLimits } from "../config.js";

export class MacError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MacError";
  }
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Thin wrapper over the local macOS system. Every method is a single, well-scoped capability. */
export class MacClient {
  constructor(private readonly limits: RuntimeLimits) {}

  // ---- low-level process runner (no shell; argv only) ----
  run(
    command: string,
    args: string[],
    opts: { input?: string; timeoutMs?: number; maxBytes?: number; cwd?: string } = {},
  ): Promise<ExecResult> {
    const timeoutMs = opts.timeoutMs ?? this.limits.commandTimeoutMs;
    const maxBytes = opts.maxBytes ?? this.limits.maxOutputBytes;
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(command, args, { cwd: opts.cwd, env: process.env });
      } catch (e) {
        reject(new MacError(`Failed to start '${command}': ${(e as Error).message}`));
        return;
      }
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const cap = (buf: string, chunk: Buffer) =>
        buf.length >= maxBytes ? buf : (buf + chunk.toString("utf8")).slice(0, maxBytes);
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout?.on("data", (c) => (stdout = cap(stdout, c)));
      child.stderr?.on("data", (c) => (stderr = cap(stderr, c)));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new MacError(`'${command}' failed: ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      });
      if (opts.input !== undefined) {
        child.stdin?.write(opts.input);
        child.stdin?.end();
      }
    });
  }

  /** Run an AppleScript (or JXA) snippet via osascript, script supplied on stdin. */
  async osa(script: string, language: "AppleScript" | "JavaScript" = "AppleScript"): Promise<string> {
    const args = language === "JavaScript" ? ["-l", "JavaScript"] : [];
    const r = await this.run("osascript", args, { input: script });
    if (r.code !== 0) throw new MacError(`osascript failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    return r.stdout.trim();
  }

  /**
   * Run a small AppleScript whose user-supplied values are passed as argv (accessible as
   * `item N of argv`), never interpolated into the source — so no string escaping is required
   * and user text cannot alter the script.
   */
  private async osaArgv(lines: string[], argv: string[]): Promise<string> {
    const eArgs = lines.flatMap((l) => ["-e", l]);
    const r = await this.run("osascript", [...eArgs, "--", ...argv]);
    if (r.code !== 0) throw new MacError(`osascript failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    return r.stdout.trim();
  }

  // ---- observe / read ----
  async systemInfo(): Promise<Record<string, unknown>> {
    const sw = await this.run("sw_vers", []).catch(() => null);
    const macVersion = sw && sw.code === 0 ? sw.stdout.trim().replace(/\s+/g, " ") : undefined;
    const mem = os.totalmem();
    return {
      macVersion,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      kernel: os.release(),
      cpuModel: os.cpus()[0]?.model,
      cpuCount: os.cpus().length,
      totalMemGB: +(mem / 1024 ** 3).toFixed(1),
      freeMemGB: +(os.freemem() / 1024 ** 3).toFixed(1),
      loadAvg: os.loadavg().map((n) => +n.toFixed(2)),
      uptimeHours: +(os.uptime() / 3600).toFixed(1),
      user: os.userInfo().username,
      home: os.homedir(),
    };
  }

  async listDirectory(abs: string): Promise<Array<Record<string, unknown>>> {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch (e) {
      throw new MacError(`Cannot list '${abs}': ${(e as Error).message}`);
    }
    const out: Array<Record<string, unknown>> = [];
    for (const d of entries) {
      const full = path.join(abs, d.name);
      let size: number | undefined;
      try {
        if (d.isFile()) size = (await fs.stat(full)).size;
      } catch {
        /* ignore */
      }
      out.push({
        name: d.name,
        type: d.isDirectory() ? "dir" : d.isSymbolicLink() ? "symlink" : "file",
        ...(size !== undefined ? { bytes: size } : {}),
      });
    }
    return out;
  }

  async readFile(abs: string): Promise<{ path: string; bytes: number; truncated: boolean; content: string }> {
    let fh;
    try {
      fh = await fs.open(abs, "r");
    } catch (e) {
      throw new MacError(`Cannot read '${abs}': ${(e as Error).message}`);
    }
    try {
      // Stat the open handle (not the path again) so there is no time-of-check/time-of-use gap.
      const stat = await fh.stat();
      if (stat.isDirectory()) throw new MacError(`'${abs}' is a directory; use list_directory.`);
      const len = Math.min(stat.size, this.limits.maxFileBytes);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, 0);
      return { path: abs, bytes: stat.size, truncated: stat.size > len, content: buf.toString("utf8") };
    } finally {
      await fh.close();
    }
  }

  async pathExists(abs: string): Promise<boolean> {
    try {
      await fs.access(abs);
      return true;
    } catch {
      return false;
    }
  }

  async writeFile(abs: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }

  /** Move a path to the Trash (recoverable) via Finder. */
  async trashPath(abs: string): Promise<void> {
    await this.osaArgv(
      ["on run argv", 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', "end run"],
      [abs],
    );
  }

  async listProcesses(limit: number, filter?: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.run("ps", ["-Aco", "pid,ppid,%cpu,%mem,comm"]);
    const lines = r.stdout.split("\n").slice(1).filter(Boolean);
    let rows = lines.map((l) => {
      const m = l.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.*)$/);
      if (!m) return null;
      return { pid: +m[1], ppid: +m[2], cpu: +m[3], mem: +m[4], command: m[5] };
    });
    let out = rows.filter(Boolean) as Array<Record<string, unknown>>;
    if (filter) {
      const f = filter.toLowerCase();
      out = out.filter((p) => String(p.command).toLowerCase().includes(f));
    }
    return out.sort((a, b) => (b.cpu as number) - (a.cpu as number)).slice(0, limit);
  }

  killProcess(pid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(pid, signal);
    } catch (e) {
      throw new MacError(`Cannot signal pid ${pid}: ${(e as Error).message}`);
    }
  }

  async getClipboard(): Promise<string> {
    const r = await this.run("pbpaste", []);
    return r.stdout;
  }
  async setClipboard(text: string): Promise<void> {
    const r = await this.run("pbcopy", [], { input: text });
    if (r.code !== 0) throw new MacError(`pbcopy failed: ${r.stderr}`);
  }

  async listApps(): Promise<string[]> {
    const out = await this.osa(
      'tell application "System Events" to get name of (every process whose background only is false)',
    );
    return out.split(", ").map((s) => s.trim()).filter(Boolean).sort();
  }
  async frontmostApp(): Promise<string> {
    return this.osa('tell application "System Events" to get name of first process whose frontmost is true');
  }

  async notify(title: string, message: string): Promise<void> {
    await this.osaArgv(
      ["on run argv", "display notification (item 2 of argv) with title (item 1 of argv)", "end run"],
      [title, message],
    );
  }

  async open(target: string, asApp: boolean): Promise<void> {
    const args = asApp ? ["-a", target] : [target];
    const r = await this.run("open", args);
    if (r.code !== 0) throw new MacError(`open failed: ${r.stderr.trim() || `exit ${r.code}`}`);
  }

  async screenshot(): Promise<string> {
    const tmp = path.join(os.tmpdir(), `mcp-macos-${Date.now()}.png`);
    const r = await this.run("screencapture", ["-x", "-t", "png", tmp]);
    if (r.code !== 0) {
      throw new MacError(
        `screencapture failed (${r.stderr.trim() || `exit ${r.code}`}). The host process likely needs Screen Recording permission (System Settings → Privacy & Security → Screen Recording).`,
      );
    }
    const data = await fs.readFile(tmp);
    await fs.rm(tmp, { force: true });
    return data.toString("base64");
  }

  // ---- GUI input ----
  /** Type literal text into the frontmost app (native, via System Events; text passed as argv). */
  async typeText(text: string): Promise<void> {
    await this.osaArgv(
      ["on run argv", 'tell application "System Events" to keystroke (item 1 of argv)', "end run"],
      [text],
    );
  }

  /** Press a key with optional modifiers (native, via System Events). */
  async keyPress(key: string, modifiers: string[]): Promise<void> {
    // Whitelist modifiers so nothing user-supplied is interpolated into the script.
    const allowed = new Set(["command", "option", "control", "shift"]);
    const mods = modifiers.filter((m) => allowed.has(m)).map((m) => `${m} down`).join(", ");
    const using = mods ? ` using {${mods}}` : "";
    // Named keys map to a fixed numeric `key code`; single characters use keystroke (via argv).
    const codes: Record<string, number> = {
      return: 36, enter: 36, tab: 48, space: 49, delete: 51, escape: 53, esc: 53,
      left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121,
    };
    const code = codes[key.toLowerCase()];
    if (code !== undefined) {
      await this.osa(`tell application "System Events" to key code ${code}${using}`);
    } else {
      await this.osaArgv(
        ["on run argv", `tell application "System Events" to keystroke (item 1 of argv)${using}`, "end run"],
        [key],
      );
    }
  }

  private cliclickChecked?: boolean;
  private async requireCliclick(): Promise<string> {
    if (this.cliclickChecked === undefined) {
      const r = await this.run("which", ["cliclick"]).catch(() => null);
      this.cliclickChecked = !!r && r.code === 0 && r.stdout.trim().length > 0;
    }
    if (!this.cliclickChecked) {
      throw new MacError("Mouse control needs `cliclick`. Install it with: brew install cliclick");
    }
    return "cliclick";
  }

  async click(x: number, y: number, button: "left" | "right" | "double"): Promise<void> {
    await this.requireCliclick();
    const cmd = button === "right" ? `rc:${x},${y}` : button === "double" ? `dc:${x},${y}` : `c:${x},${y}`;
    const r = await this.run("cliclick", [cmd]);
    if (r.code !== 0) throw new MacError(`cliclick failed: ${r.stderr.trim() || `exit ${r.code}`}`);
  }
  async moveMouse(x: number, y: number): Promise<void> {
    await this.requireCliclick();
    const r = await this.run("cliclick", [`m:${x},${y}`]);
    if (r.code !== 0) throw new MacError(`cliclick failed: ${r.stderr.trim() || `exit ${r.code}`}`);
  }
}
