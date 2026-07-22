import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createConnection, createServer as createNetServer } from "node:net";
import process from "node:process";
import type { Readable } from "node:stream";
import type { LauncherDefinition, LogEntry, RuntimeSnapshot, RuntimeStatus } from "./types.js";

interface RuntimeRecord extends RuntimeSnapshot {
  child: ChildProcessByStdio<null, Readable, Readable> | null;
  logs: LogEntry[];
}

type RuntimeListener = (launcherId: string, snapshot: RuntimeSnapshot) => void;
type LogListener = (launcherId: string, entry: LogEntry) => void;

const MAX_LOG_LINES = 600;
const urlPattern = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{2,5})?(?:\/[^\s\x1b]*)?/i;

function emptySnapshot(): RuntimeSnapshot {
  return {
    status: "stopped",
    pid: null,
    startedAt: null,
    stoppedAt: null,
    exitCode: null,
    url: null,
    message: null
  };
}

function publicSnapshot(record?: RuntimeRecord): RuntimeSnapshot {
  if (!record) return emptySnapshot();
  return {
    status: record.status,
    pid: record.pid,
    startedAt: record.startedAt,
    stoppedAt: record.stoppedAt,
    exitCode: record.exitCode,
    url: record.url,
    message: record.message
  };
}

function removeAnsi(value: string): string {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

export class ProcessManager {
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private readonly listeners = new Set<RuntimeListener>();
  private readonly logListeners = new Set<LogListener>();

  onChange(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onLog(listener: LogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  getSnapshot(launcherId: string): RuntimeSnapshot {
    return publicSnapshot(this.runtimes.get(launcherId));
  }

  getLogs(launcherId: string): LogEntry[] {
    return [...(this.runtimes.get(launcherId)?.logs ?? [])];
  }

  private emit(launcherId: string): void {
    const snapshot = this.getSnapshot(launcherId);
    for (const listener of this.listeners) listener(launcherId, snapshot);
  }

  private setStatus(record: RuntimeRecord, launcherId: string, status: RuntimeStatus, message: string | null = null): void {
    record.status = status;
    record.message = message;
    this.emit(launcherId);
  }

  private appendLog(record: RuntimeRecord, launcherId: string, stream: LogEntry["stream"], text: string): void {
    const clean = removeAnsi(text).replace(/\r$/, "");
    if (!clean) return;
    const entry = { timestamp: new Date().toISOString(), stream, text: clean } satisfies LogEntry;
    record.logs.push(entry);
    if (record.logs.length > MAX_LOG_LINES) record.logs.splice(0, record.logs.length - MAX_LOG_LINES);
    for (const listener of this.logListeners) listener(launcherId, entry);
    const match = clean.match(urlPattern);
    if (match && record.url !== match[0]) {
      record.url = match[0].replace(/[),.;]+$/, "");
      this.emit(launcherId);
    }
  }

  async start(launcher: LauncherDefinition): Promise<RuntimeSnapshot> {
    const existing = this.runtimes.get(launcher.id);
    if (existing && ["starting", "running", "stopping"].includes(existing.status)) {
      throw new Error("Dieser Starter läuft bereits.");
    }

    const record: RuntimeRecord = {
      ...emptySnapshot(),
      status: "starting",
      child: null,
      logs: existing?.logs ?? []
    };
    record.logs.length = 0;
    const dynamicPort = launcher.dynamicPort ? await this.findAvailablePort() : null;
    const resolvedArgs = dynamicPort
      ? launcher.args.map((argument) => argument.replaceAll("{port}", String(dynamicPort)))
      : launcher.args;
    const resolvedCommand = dynamicPort ? launcher.command.replaceAll("{port}", String(dynamicPort)) : launcher.command;
    if (dynamicPort) record.url = `http://127.0.0.1:${dynamicPort}/`;
    this.runtimes.set(launcher.id, record);
    this.appendLog(record, launcher.id, "system", `$ ${resolvedCommand}`);
    this.emit(launcher.id);

    return await new Promise<RuntimeSnapshot>((resolve, reject) => {
      let settled = false;
      const usesWindowsCommandProcessor = process.platform === "win32"
        && /(?:^|[\\/])cmd\.exe$/i.test(launcher.executable);
      const child = spawn(launcher.executable, resolvedArgs, {
        cwd: launcher.cwd,
        env: { ...process.env, FORCE_COLOR: "0", BROWSER: "none" },
        windowsHide: true,
        windowsVerbatimArguments: usesWindowsCommandProcessor,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"]
      });
      record.child = child;

      const consume = (stream: LogEntry["stream"]) => {
        let remainder = "";
        return (chunk: Buffer) => {
          const lines = (remainder + chunk.toString("utf8")).split(/\r?\n/);
          remainder = lines.pop() ?? "";
          for (const line of lines) this.appendLog(record, launcher.id, stream, line);
        };
      };
      child.stdout.on("data", consume("stdout"));
      child.stderr.on("data", consume("stderr"));

      child.once("spawn", async () => {
        record.pid = child.pid ?? null;
        record.startedAt = new Date().toISOString();
        record.stoppedAt = null;
        record.exitCode = null;
        this.appendLog(record, launcher.id, "system", `Prozess gestartet${record.pid ? ` (PID ${record.pid})` : ""}.`);
        try {
          if (dynamicPort) await this.waitForPort(dynamicPort, 8000);
          if (record.child !== child) throw new Error("Der Prozess wurde vor dem Erreichen der Bereitschaft beendet.");
          settled = true;
          this.setStatus(record, launcher.id, "running");
          resolve(this.getSnapshot(launcher.id));
        } catch (error) {
          if (settled) return;
          settled = true;
          const message = error instanceof Error ? error.message : "Der Server wurde nicht rechtzeitig bereit.";
          record.message = message;
          this.appendLog(record, launcher.id, "system", `Bereitschaftsprüfung fehlgeschlagen: ${message}`);
          this.setStatus(record, launcher.id, "error", message);
          child.kill();
          reject(new Error(message));
        }
      });

      child.once("error", (error) => {
        record.child = null;
        record.pid = null;
        record.stoppedAt = new Date().toISOString();
        this.appendLog(record, launcher.id, "system", `Start fehlgeschlagen: ${error.message}`);
        this.setStatus(record, launcher.id, "error", error.message);
        if (!settled) { settled = true; reject(error); }
      });

      child.once("close", (code) => {
        record.child = null;
        record.pid = null;
        record.exitCode = code;
        record.stoppedAt = new Date().toISOString();
        this.appendLog(record, launcher.id, "system", `Prozess beendet${code === null ? "." : ` (Code ${code}).`}`);
        if (record.status !== "error") this.setStatus(record, launcher.id, code === 0 || record.status === "stopping" ? "stopped" : "error", code && code !== 0 ? `Exit-Code ${code}` : null);
        if (!settled) { settled = true; reject(new Error(`Der Prozess wurde vor der Bereitschaft beendet${code === null ? "." : ` (Code ${code}).`}`)); }
      });
    });
  }

  async restart(launcher: LauncherDefinition): Promise<RuntimeSnapshot> {
    const current = this.runtimes.get(launcher.id);
    if (current?.child && ["starting", "running"].includes(current.status)) {
      await this.stop(launcher.id);
    }
    return this.start(launcher);
  }

  private async findAvailablePort(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
      const server = createNetServer();
      server.unref();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        server.close((error) => error ? reject(error) : resolve(port));
      });
    });
  }

  private async waitForPort(port: number, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const ready = await new Promise<boolean>((resolve) => {
        const socket = createConnection({ host: "127.0.0.1", port });
        socket.setTimeout(250);
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("error", () => resolve(false));
        socket.once("timeout", () => { socket.destroy(); resolve(false); });
      });
      if (ready) return;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error(`Port ${port} wurde nicht innerhalb von ${Math.round(timeoutMs / 1000)} Sekunden erreichbar.`);
  }

  async stop(launcherId: string): Promise<RuntimeSnapshot> {
    const record = this.runtimes.get(launcherId);
    if (!record?.child || !record.pid || !["starting", "running"].includes(record.status)) {
      throw new Error("Dieser Starter läuft nicht.");
    }

    this.setStatus(record, launcherId, "stopping");
    this.appendLog(record, launcherId, "system", "Prozess wird beendet …");
    const pid = record.pid;
    const stopped = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { unsubscribe(); resolve(); }, 5000);
      const unsubscribe = this.onChange((changedId, snapshot) => {
        if (changedId === launcherId && ["stopped", "error"].includes(snapshot.status)) {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
      });
    });

    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
        killer.once("error", () => {
          record.child?.kill();
          resolve();
        });
        killer.once("close", () => resolve());
      });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        record.child.kill("SIGTERM");
      }
    }

    await stopped;
    return this.getSnapshot(launcherId);
  }

  async stopAll(): Promise<void> {
    const activeIds = [...this.runtimes.entries()]
      .filter(([, runtime]) => runtime.child && ["starting", "running"].includes(runtime.status))
      .map(([id]) => id);
    await Promise.allSettled(activeIds.map((id) => this.stop(id)));
  }
}
