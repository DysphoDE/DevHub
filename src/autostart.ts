import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileExists, isMac, isWindows, platformName } from "./platform.js";
import type { AppConfig, AutostartMode } from "./types.js";

/**
 * Autostart je Plattform: Windows nutzt die bestehende Aufgabenplanung (PowerShell-Skripte),
 * macOS einen launchd-LaunchAgent des Benutzers, Linux eine systemd-Benutzereinheit.
 * Alle drei starten denselben Node-Prozess wie "npm run dev" bzw. "npm start".
 */
export const launchAgentLabel = "de.devhub.node";
export const systemdUnitName = "devhub.service";

export interface AutostartPlan {
  mode: AutostartMode;
  appRoot: string;
  nodePath: string;
  args: string[];
  logPath: string;
  /** PATH des installierenden Benutzers – launchd und systemd kennen sonst weder npm noch php noch herd. */
  pathVariable: string;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function runtimeArguments(appRoot: string, mode: AutostartMode): string[] {
  return mode === "dev"
    ? [path.join(appRoot, "node_modules", "tsx", "dist", "cli.mjs"), "watch", path.join(appRoot, "src", "server.ts")]
    : [path.join(appRoot, "dist", "server.js")];
}

export function buildPlan(appRoot: string, mode: AutostartMode, nodePath = process.execPath, pathVariable = process.env.PATH ?? ""): AutostartPlan {
  return {
    mode,
    appRoot,
    nodePath,
    args: runtimeArguments(appRoot, mode),
    logPath: path.join(appRoot, ".devhub", "autostart.log"),
    pathVariable
  };
}

export function renderLaunchAgent(plan: AutostartPlan): string {
  const programArguments = [plan.nodePath, ...plan.args].map((value) => `      <string>${xmlEscape(value)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${launchAgentLabel}</string>
    <key>ProgramArguments</key>
    <array>
${programArguments}
    </array>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(plan.appRoot)}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${xmlEscape(plan.pathVariable)}</string>
      <key>DEVHUB_AUTOSTART_MODE</key>
      <string>${plan.mode}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${xmlEscape(plan.logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(plan.logPath)}</string>
  </dict>
</plist>
`;
}

function systemdQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderSystemdUnit(plan: AutostartPlan): string {
  const command = [plan.nodePath, ...plan.args].map(systemdQuote).join(" ");
  return `[Unit]
Description=DevHub local development dashboard (${plan.mode})
After=network.target

[Service]
Type=simple
WorkingDirectory=${plan.appRoot}
Environment=PATH=${plan.pathVariable}
Environment=DEVHUB_AUTOSTART_MODE=${plan.mode}
ExecStart=${command}
Restart=always
RestartSec=5
StandardOutput=append:${plan.logPath}
StandardError=append:${plan.logPath}

[Install]
WantedBy=default.target
`;
}

export function launchAgentPath(home = os.homedir()): string {
  return path.join(home, "Library", "LaunchAgents", `${launchAgentLabel}.plist`);
}

export function systemdUnitPath(home = os.homedir()): string {
  return path.join(home, ".config", "systemd", "user", systemdUnitName);
}

function run(executable: string, args: string[], options: { cwd?: string; allowFailure?: boolean } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, stdio: "inherit", windowsHide: true });
    child.once("error", (error) => options.allowFailure ? resolve(-1) : reject(error));
    child.once("close", (code) => {
      if (code === 0 || options.allowFailure) resolve(code ?? -1);
      else reject(new Error(`${path.basename(executable)} ${args[0] ?? ""} endete mit Code ${code}.`));
    });
  });
}

async function ensureRuntime(plan: AutostartPlan): Promise<void> {
  const required = plan.args[0];
  if (await fileExists(required)) return;
  const hint = plan.mode === "dev" ? "npm install" : "npm run build";
  throw new Error(`Die Laufzeit für den Modus „${plan.mode}“ fehlt (${required}). Führe zuerst „${hint}“ aus.`);
}

export async function waitForDevHub(port: number, timeoutMs = 12_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return true;
    } catch {
      // noch nicht bereit
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export async function installAutostart(config: AppConfig, appRoot: string, mode: AutostartMode = config.autostartMode): Promise<string> {
  if (isWindows) {
    await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(appRoot, "scripts", "install-windows-autostart.ps1"), "-Mode", mode], { cwd: appRoot });
    return `Windows-Aufgabe „DevHub Node“ wurde eingerichtet (Modus ${mode}).`;
  }

  const plan = buildPlan(appRoot, mode);
  await ensureRuntime(plan);
  await mkdir(path.dirname(plan.logPath), { recursive: true });

  if (isMac) {
    const plistPath = launchAgentPath();
    await mkdir(path.dirname(plistPath), { recursive: true });
    await writeFile(plistPath, renderLaunchAgent(plan), "utf8");
    const domain = `gui/${os.userInfo().uid}`;
    await run("launchctl", ["bootout", `${domain}/${launchAgentLabel}`], { allowFailure: true });
    const code = await run("launchctl", ["bootstrap", domain, plistPath], { allowFailure: true });
    if (code !== 0) await run("launchctl", ["load", "-w", plistPath]);
    const ready = await waitForDevHub(config.port);
    return `LaunchAgent ${launchAgentLabel} wurde installiert (Modus ${mode}).${ready ? "" : ` DevHub antwortet noch nicht – prüfe ${plan.logPath}.`}`;
  }

  const unitPath = systemdUnitPath();
  await mkdir(path.dirname(unitPath), { recursive: true });
  await writeFile(unitPath, renderSystemdUnit(plan), "utf8");
  await run("systemctl", ["--user", "daemon-reload"]);
  await run("systemctl", ["--user", "enable", "--now", systemdUnitName]);
  const ready = await waitForDevHub(config.port);
  return `systemd-Einheit ${systemdUnitName} wurde aktiviert (Modus ${mode}).${ready ? "" : ` DevHub antwortet noch nicht – prüfe ${plan.logPath}.`}`;
}

export async function uninstallAutostart(appRoot: string): Promise<string> {
  if (isWindows) {
    await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(appRoot, "scripts", "uninstall-windows-autostart.ps1")], { cwd: appRoot });
    return "Windows-Aufgabe „DevHub Node“ wurde entfernt.";
  }
  if (isMac) {
    const plistPath = launchAgentPath();
    await run("launchctl", ["bootout", `gui/${os.userInfo().uid}/${launchAgentLabel}`], { allowFailure: true });
    await rm(plistPath, { force: true });
    return `LaunchAgent ${launchAgentLabel} wurde entfernt.`;
  }
  await run("systemctl", ["--user", "disable", "--now", systemdUnitName], { allowFailure: true });
  await rm(systemdUnitPath(), { force: true });
  await run("systemctl", ["--user", "daemon-reload"], { allowFailure: true });
  return `systemd-Einheit ${systemdUnitName} wurde entfernt.`;
}

export function autostartDescription(): string {
  return isWindows ? "Aufgabenplanung (Windows)" : isMac ? "LaunchAgent (macOS)" : `systemd-Benutzereinheit (${platformName()})`;
}
