import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const isWindows = process.platform === "win32";
export const isMac = process.platform === "darwin";
export const isLinux = !isWindows && !isMac;

export function platformName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux";
}

/** Löst ein führendes "~" zum Home-Verzeichnis auf, damit Konfigurationen portabel bleiben. */
export function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export async function fileExists(candidate: string): Promise<boolean> {
  try { await access(candidate); return true; } catch { return false; }
}

/** Prüft, ob ein Kommando auf dem PATH liegt, und liefert seinen absoluten Pfad. */
export async function commandPath(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(isWindows ? "where.exe" : "which", [name], { timeout: 3000, windowsHide: true });
    const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first ?? null;
  } catch {
    return null;
  }
}

/** Kleingeschriebene Basisnamen aller laufenden Prozesse ("nginx", "httpd.exe", …). */
export async function runningProcessNames(): Promise<Set<string>> {
  try {
    if (isWindows) {
      const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"], { timeout: 3000, windowsHide: true, maxBuffer: 2_000_000 });
      return new Set(stdout.split(/\r?\n/).map((line) => line.match(/^"([^"]+)"/)?.[1]?.toLowerCase()).filter((name): name is string => Boolean(name)));
    }
    const { stdout } = await execFileAsync("ps", ["-axo", "comm="], { timeout: 3000, maxBuffer: 2_000_000 });
    // Nginx und PHP-FPM setzen ihren Prozesstitel ("nginx: master process /…/nginx-arm64 …"),
    // daher zählt nur das erste Wort ohne Doppelpunkt, sonst der Basisname des Programmpfads.
    return new Set(stdout.split(/\r?\n/).map((line) => {
      const first = line.trim().split(/\s+/)[0] ?? "";
      return path.basename(first.replace(/:$/, "")).toLowerCase();
    }).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function spawnDetached(executable: string, args: string[], options: { cwd?: string; visible?: boolean } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, detached: true, stdio: "ignore", windowsHide: !options.visible });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

/** Öffnet eine macOS-App (per Bundle-Name) mit optionalen Argumenten. */
export function openMacApp(appName: string, args: string[] = []): Promise<void> {
  return spawnDetached("open", ["-a", appName, ...args], { visible: true });
}

/** Sucht eine macOS-App in den üblichen Applications-Ordnern. */
export async function findMacApp(appName: string): Promise<string | null> {
  const bundle = appName.endsWith(".app") ? appName : `${appName}.app`;
  for (const directory of ["/Applications", path.join(os.homedir(), "Applications"), "/System/Applications", "/System/Applications/Utilities"]) {
    const candidate = path.join(directory, bundle);
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

export type TrashSupport = { available: true; name: string } | { available: false; name: null };

let cachedTrashSupport: TrashSupport | undefined;

export async function trashSupport(): Promise<TrashSupport> {
  if (cachedTrashSupport) return cachedTrashSupport;
  if (isWindows || isMac) cachedTrashSupport = { available: true, name: "Papierkorb" };
  else cachedTrashSupport = (await commandPath("gio")) ? { available: true, name: "Papierkorb" } : { available: false, name: null };
  return cachedTrashSupport;
}

function runWithInput(executable: string, args: string[], input: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split(/\r?\n/)[0] || `Exit-Code ${code}`));
    });
    child.stdin.end(input, "utf8");
  });
}

/**
 * Verschiebt Dateien und Ordner in den Papierkorb des Systems statt sie endgültig zu löschen.
 * Windows: Explorer-Papierkorb über .NET, macOS: Finder per AppleScript, Linux: gio trash.
 */
export async function moveToTrash(absolutePaths: string[]): Promise<void> {
  if (!absolutePaths.length) return;
  if (isWindows) {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -AssemblyName Microsoft.VisualBasic",
      "$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)",
      "$paths = $reader.ReadToEnd() -split \"`n\"",
      "foreach ($p in $paths) {",
      "  $p = $p.Trim()",
      "  if ($p.Length -eq 0) { continue }",
      "  if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
      "  elseif (Test-Path -LiteralPath $p) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
      "}"
    ].join("\n");
    await runWithInput("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], absolutePaths.join("\n"), 60_000);
    return;
  }
  if (isMac) {
    // Der Finder erhält die Pfade als Liste von POSIX-Dateien; Sonderzeichen werden AppleScript-sicher maskiert.
    const items = absolutePaths.map((value) => `POSIX file "${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(", ");
    const script = `tell application "Finder" to delete {${items}}`;
    await execFileAsync("osascript", ["-e", script], { timeout: 60_000 });
    return;
  }
  if (!(await commandPath("gio"))) throw new Error("Auf diesem System ist kein Papierkorb-Werkzeug (gio) verfügbar.");
  await execFileAsync("gio", ["trash", "--", ...absolutePaths], { timeout: 60_000 });
}
