import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileExists, isWindows, runningProcessNames, spawnDetached } from "./platform.js";
import type { LocalStack } from "./stack.js";
import type { AppConfig, StackActionDescriptor, StackActionId, StackSite, StackStatus, StackWebInfo } from "./types.js";

const execFileAsync = promisify(execFile);

function iniValue(contents: string, section: string, key: string): string | null {
  const sectionContents = contents.match(new RegExp(`\\[${section}\\]([\\s\\S]*?)(?=\\r?\\n\\[|$)`, "i"))?.[1] ?? "";
  return sectionContents.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "im"))?.[1]?.trim() ?? null;
}

async function readText(filePath: string, maxBytes: number): Promise<string> {
  try { return (await readFile(filePath)).subarray(0, maxBytes).toString("utf8"); } catch { return ""; }
}

function executablePath(config: AppConfig): string {
  return path.join(config.laragonRoot, "laragon.exe");
}

const actions: StackActionDescriptor[] = [
  { id: "start", label: "Apache starten", description: "Startet den Apache-Webserver aus der Laragon-Installation." },
  { id: "stop", label: "Apache stoppen", description: "Beendet Apache bzw. Nginx aus der Laragon-Installation." },
  { id: "open", label: "Laragon öffnen", description: "Öffnet das Laragon-Fenster." },
  { id: "reload", label: "VHosts laden", description: "Virtual Hosts synchronisieren und Webserver neu laden." }
];

async function getStatus(config: AppConfig): Promise<StackStatus> {
  const base: StackStatus = {
    provider: "laragon", name: "Laragon", installed: false, root: null, appRunning: false, webServerName: "Apache",
    webServer: null, database: null, mail: false, documentRoot: null, sites: 0, tld: null, actions
  };
  if (!isWindows || !await fileExists(executablePath(config))) return base;
  const [names, ini] = await Promise.all([
    runningProcessNames(),
    readText(path.join(config.laragonRoot, "usr", "laragon.ini"), 128_000)
  ]);
  const sitesPath = path.join(config.laragonRoot, "etc", "apache2", "sites-enabled");
  const sites = await readdir(sitesPath, { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().startsWith("auto.")).length)
    .catch(() => 0);
  return {
    ...base,
    installed: true,
    root: config.laragonRoot,
    appRunning: names.has("laragon.exe"),
    webServer: names.has("httpd.exe") ? "Apache" : names.has("nginx.exe") ? "Nginx" : null,
    database: names.has("mysqld.exe") ? "MySQL" : names.has("mariadbd.exe") ? "MariaDB" : names.has("postgres.exe") ? "PostgreSQL" : null,
    mail: names.has("mailpit.exe"),
    documentRoot: iniValue(ini, "apache", "DocumentRoot"),
    sites,
    tld: iniValue(ini, "general", "TLD") ?? "test"
  };
}

// Laragon legt für jeden Ordner unter dem DocumentRoot einen Virtual Host an (auto.<name>.test.conf).
async function readWebInfo(config: AppConfig): Promise<StackWebInfo> {
  const ini = await readText(path.join(config.laragonRoot, "usr", "laragon.ini"), 128_000);
  const result: StackWebInfo = { documentRoot: iniValue(ini, "apache", "DocumentRoot"), sites: [] };
  const sitesDirectory = path.join(config.laragonRoot, "etc", "apache2", "sites-enabled");
  try {
    const files = (await readdir(sitesDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".conf"));
    for (const file of files) {
      const contents = await readText(path.join(sitesDirectory, file.name), 64_000);
      const documentRoot = contents.match(/^\s*DocumentRoot\s+["']?([^"'\r\n]+)["']?/im)?.[1]?.trim();
      const serverName = contents.match(/^\s*ServerName\s+([^\s#]+)/im)?.[1]?.trim();
      if (!documentRoot || !serverName) continue;
      const site: StackSite = { documentRoot: path.resolve(documentRoot), serverName, url: `http://${serverName}/` };
      result.sites.push(site);
    }
  } catch {
    // Laragon or its Apache configuration is optional.
  }
  return result;
}

function runLaragon(config: AppConfig, args: string[], visible: boolean): Promise<void> {
  return spawnDetached(executablePath(config), args, { cwd: config.laragonRoot, visible });
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
  const running = await runningProcessNames();
  if (running.has("httpd.exe")) return "Apache läuft bereits.";
  const apacheDir = await newestVersionDir(path.join(config.laragonRoot, "bin", "apache"));
  const httpd = apacheDir ? path.join(apacheDir, "bin", "httpd.exe") : null;
  if (!httpd || !await fileExists(httpd)) throw new Error("Apache wurde unter Laragon nicht gefunden.");
  await spawnDetached(httpd, [], { cwd: path.dirname(httpd) });
  return "Apache wird gestartet.";
}

async function stopServices(config: AppConfig): Promise<string> {
  const running = await runningProcessNames();
  if (!running.has("httpd.exe") && !running.has("nginx.exe")) return "Es läuft kein Webserver.";
  const rootFilter = `${config.laragonRoot.replace(/'/g, "''")}\\*`;
  await execFileAsync("powershell.exe", [
    "-NoProfile", "-Command",
    `Get-Process httpd,nginx -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${rootFilter}' } | Stop-Process -Force; exit 0`
  ], { timeout: 15_000, windowsHide: true });
  return "Apache wird gestoppt.";
}

async function runAction(config: AppConfig, action: StackActionId): Promise<string> {
  if (!isWindows) throw new Error("Laragon ist nur unter Windows verfügbar.");
  if (!await fileExists(executablePath(config))) throw new Error("Laragon wurde nicht gefunden.");
  if (action === "open") {
    await runLaragon(config, [], true);
    return "Laragon wurde geöffnet.";
  }
  if (action === "start") return startServices(config);
  if (action === "stop") return stopServices(config);
  await runLaragon(config, ["reload"], false);
  return "Laragon-Konfiguration und Virtual Hosts werden neu geladen.";
}

export const laragonStack: LocalStack = {
  provider: "laragon",
  name: "Laragon",
  isInstalled: (config) => isWindows ? fileExists(executablePath(config)) : Promise.resolve(false),
  getStatus,
  readWebInfo,
  runAction
};
