import { execFile, spawn } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig, LaragonStatus } from "./types.js";

const execFileAsync = promisify(execFile);

async function fileExists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

async function processNames(): Promise<Set<string>> {
  if (process.platform !== "win32") return new Set();
  try {
    const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"], { timeout: 3000, windowsHide: true, maxBuffer: 2_000_000 });
    return new Set(stdout.split(/\r?\n/).map((line) => line.match(/^"([^"]+)"/)?.[1]?.toLowerCase()).filter((name): name is string => Boolean(name)));
  } catch {
    return new Set();
  }
}

function iniValue(contents: string, section: string, key: string): string | null {
  const sectionContents = contents.match(new RegExp(`\\[${section}\\]([\\s\\S]*?)(?=\\r?\\n\\[|$)`, "i"))?.[1] ?? "";
  return sectionContents.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "im"))?.[1]?.trim() ?? null;
}

export async function getLaragonStatus(config: AppConfig): Promise<LaragonStatus> {
  const executable = path.join(config.laragonRoot, "laragon.exe");
  if (!await fileExists(executable)) {
    return { installed: false, root: null, appRunning: false, webServer: null, database: null, mail: false, documentRoot: null, virtualHosts: 0 };
  }
  const [names, ini] = await Promise.all([
    processNames(),
    readFile(path.join(config.laragonRoot, "usr", "laragon.ini"), "utf8").catch(() => "")
  ]);
  const sitesPath = path.join(config.laragonRoot, "etc", "apache2", "sites-enabled");
  const virtualHosts = await readdir(sitesPath, { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().startsWith("auto.")).length)
    .catch(() => 0);
  return {
    installed: true,
    root: config.laragonRoot,
    appRunning: names.has("laragon.exe"),
    webServer: names.has("httpd.exe") ? "Apache" : names.has("nginx.exe") ? "Nginx" : null,
    database: names.has("mysqld.exe") ? "MySQL" : names.has("mariadbd.exe") ? "MariaDB" : names.has("postgres.exe") ? "PostgreSQL" : null,
    mail: names.has("mailpit.exe"),
    documentRoot: iniValue(ini, "apache", "DocumentRoot"),
    virtualHosts
  };
}

function spawnDetached(executable: string, args: string[], cwd: string, visible = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, detached: true, stdio: "ignore", windowsHide: !visible });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

function runLaragon(config: AppConfig, args: string[], visible: boolean): Promise<void> {
  return spawnDetached(path.join(config.laragonRoot, "laragon.exe"), args, config.laragonRoot, visible);
}

async function newestVersionDir(parent: string): Promise<string | null> {
  const names = await readdir(parent, { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort())
    .catch(() => [] as string[]);
  return names.length ? path.join(parent, names[names.length - 1]) : null;
}

// Laragon selbst hat keine Start/Stop-CLI (nur "reload"), daher wird Apache
// hier genauso gestartet und beendet, wie Laragon es intern tut.
async function startServices(config: AppConfig): Promise<string> {
  const running = await processNames();
  if (running.has("httpd.exe")) return "Apache läuft bereits.";
  const apacheDir = await newestVersionDir(path.join(config.laragonRoot, "bin", "apache"));
  const httpd = apacheDir ? path.join(apacheDir, "bin", "httpd.exe") : null;
  if (!httpd || !await fileExists(httpd)) throw new Error("Apache wurde unter Laragon nicht gefunden.");
  await spawnDetached(httpd, [], path.dirname(httpd));
  return "Apache wird gestartet.";
}

async function stopServices(config: AppConfig): Promise<string> {
  const running = await processNames();
  if (!running.has("httpd.exe") && !running.has("nginx.exe")) return "Es läuft kein Webserver.";
  const rootFilter = `${config.laragonRoot.replace(/'/g, "''")}\\*`;
  await execFileAsync("powershell.exe", [
    "-NoProfile", "-Command",
    `Get-Process httpd,nginx -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${rootFilter}' } | Stop-Process -Force; exit 0`
  ], { timeout: 15_000, windowsHide: true });
  return "Apache wird gestoppt.";
}

export type LaragonAction = "open" | "start" | "stop" | "reload" | "reload-apache" | "reload-nginx";

export async function runLaragonAction(config: AppConfig, action: LaragonAction): Promise<string> {
  if (!await fileExists(path.join(config.laragonRoot, "laragon.exe"))) throw new Error("Laragon wurde nicht gefunden.");
  if (action === "open") {
    await runLaragon(config, [], true);
    return "Laragon wurde geöffnet.";
  }
  if (action === "start") return startServices(config);
  if (action === "stop") return stopServices(config);
  const args = action === "reload-apache" ? ["reload", "apache"] : action === "reload-nginx" ? ["reload", "nginx"] : ["reload"];
  await runLaragon(config, args, false);
  return action === "reload" ? "Laragon-Konfiguration und Virtual Hosts werden neu geladen." : `${args[1]} wird neu geladen.`;
}
