import { access, readFile, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultHerdRoot } from "./herd.js";
import { expandHome, isWindows } from "./platform.js";
import type { AppConfig, AutostartMode, StackSelection } from "./types.js";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const stackSelections: StackSelection[] = ["auto", "laragon", "herd", "valet", "none"];

export const defaults: AppConfig = {
  host: "127.0.0.1",
  publicHost: "devhub",
  publicUrl: null,
  autostartMode: "dev",
  port: 7331,
  scanRoot: "..",
  categoryDepth: 3,
  maxDepth: 5,
  maxEntriesPerProject: 15000,
  stack: "auto",
  laragonRoot: "C:\\laragon",
  herdRoot: "",
  editor: "auto",
  terminal: "auto",
  ignore: [
    ".git",
    ".idea",
    ".vscode",
    "node_modules",
    "vendor",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".output",
    ".cache",
    ".turbo",
    "browser_profile",
    "userdata",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    "target",
    "obj",
    "out",
    "_backup",
    "test-results",
    "tmp",
    "$RECYCLE.BIN",
    "System Volume Information"
  ]
};

export function isValidPublicHost(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(value);
}

/** Löst einen konfigurierten Pfad relativ zum App-Ordner auf, "~" zeigt auf das Home-Verzeichnis. */
export function resolveConfiguredPath(value: string, base = appDirectory): string {
  return path.resolve(base, expandHome(value));
}

export async function readConfigFile(configPath = path.join(appDirectory, "devhub.config.json")): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Die DevHub-Konfiguration ist ungültig.");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {};
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const fileConfig = await readConfigFile() as Partial<AppConfig>;
  const merged = { ...defaults, ...fileConfig };
  const configuredRoot = process.env.DEVHUB_ROOT ?? merged.scanRoot;
  const configuredPort = Number(process.env.DEVHUB_PORT ?? merged.port);
  const configuredHost = process.env.DEVHUB_HOST ?? merged.host;
  const configuredPublicHost = process.env.DEVHUB_PUBLIC_HOST ?? merged.publicHost;
  const configuredPublicUrl = process.env.DEVHUB_PUBLIC_URL ?? merged.publicUrl;
  const configuredAutostartMode = process.env.DEVHUB_AUTOSTART_MODE ?? merged.autostartMode;
  const configuredStack = (process.env.DEVHUB_STACK ?? merged.stack ?? "auto") as StackSelection;

  if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
    throw new Error(`Ungültiger DevHub-Port: ${configuredPort}`);
  }

  if (!["127.0.0.1", "localhost", "::1"].includes(configuredHost) && process.env.DEVHUB_ALLOW_REMOTE !== "1") {
    throw new Error("DevHub darf standardmäßig nur an eine Loopback-Adresse gebunden werden.");
  }

  if (!isValidPublicHost(configuredPublicHost)) {
    throw new Error(`Ungültiger öffentlicher DevHub-Hostname: ${configuredPublicHost}`);
  }

  if (configuredAutostartMode !== "dev" && configuredAutostartMode !== "production") {
    throw new Error(`Ungültiger Autostart-Modus: ${configuredAutostartMode}`);
  }

  if (!stackSelections.includes(configuredStack)) {
    throw new Error(`Ungültiger Stack: ${configuredStack}. Erlaubt sind ${stackSelections.join(", ")}.`);
  }

  if (configuredPublicUrl && !/^https?:\/\/[^\s/]+\/?$/i.test(configuredPublicUrl)) {
    throw new Error(`Ungültige öffentliche DevHub-Adresse: ${configuredPublicUrl}`);
  }

  return {
    ...merged,
    host: configuredHost,
    publicHost: configuredPublicHost.toLowerCase(),
    publicUrl: configuredPublicUrl ? configuredPublicUrl.replace(/\/$/, "") : null,
    autostartMode: configuredAutostartMode as AutostartMode,
    port: configuredPort,
    scanRoot: resolveConfiguredPath(configuredRoot),
    categoryDepth: Math.max(0, Math.min(3, Math.trunc(Number(merged.categoryDepth ?? defaults.categoryDepth)) || 0)),
    maxDepth: Math.max(1, Math.min(12, Number(merged.maxDepth) || defaults.maxDepth)),
    maxEntriesPerProject: Math.max(1000, Math.min(100000, Number(merged.maxEntriesPerProject) || defaults.maxEntriesPerProject)),
    stack: configuredStack,
    // Unter Windows zeigt der Laragon-Standard auf C:\laragon; auf anderen Systemen bleibt der Wert
    // ein harmloser, nicht existierender Pfad, bis jemand Laragon ausdrücklich konfiguriert.
    laragonRoot: isWindows || fileConfig.laragonRoot ? resolveConfiguredPath(merged.laragonRoot || defaults.laragonRoot) : path.join(appDirectory, ".no-laragon"),
    herdRoot: merged.herdRoot ? resolveConfiguredPath(merged.herdRoot) : defaultHerdRoot(),
    editor: merged.editor || defaults.editor,
    terminal: merged.terminal || defaults.terminal,
    ignore: Array.from(new Set([...defaults.ignore, ...(merged.ignore ?? [])]))
  };
}

/** Schreibt die Konfiguration atomar, damit ein Absturz nie eine halbe Datei hinterlässt. */
export async function writeConfigFile(values: Record<string, unknown>, configPath = path.join(appDirectory, "devhub.config.json")): Promise<void> {
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(values, null, 2)}\n`, "utf8");
  await rename(temporaryPath, configPath);
}

export async function saveScanRoot(config: AppConfig, requestedRoot: string, configPath = path.join(appDirectory, "devhub.config.json")): Promise<string> {
  if (process.env.DEVHUB_ROOT) {
    throw new Error("Der Workspace wird durch DEVHUB_ROOT vorgegeben und kann nicht im UI geändert werden.");
  }

  const value = expandHome(requestedRoot.trim());
  if (!value || !path.isAbsolute(value)) {
    throw new Error("Gib einen absoluten Workspace-Pfad an.");
  }

  const resolvedRoot = path.resolve(value);
  const rootStats = await stat(resolvedRoot).catch(() => null);
  if (!rootStats?.isDirectory()) {
    throw new Error("Der gewählte Workspace existiert nicht oder ist kein Ordner.");
  }
  await access(resolvedRoot, constants.R_OK);

  const fileConfig = await readConfigFile(configPath);
  await writeConfigFile({ ...fileConfig, scanRoot: resolvedRoot }, configPath);
  config.scanRoot = resolvedRoot;
  return resolvedRoot;
}

export function getAppDirectory(): string {
  return appDirectory;
}
