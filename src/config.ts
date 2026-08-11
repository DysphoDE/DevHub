import { access, readFile, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig, AutostartMode } from "./types.js";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const defaults: AppConfig = {
  host: "127.0.0.1",
  publicHost: "devhub",
  autostartMode: "dev",
  port: 7331,
  scanRoot: "..",
  categoryDepth: 3,
  maxDepth: 5,
  maxEntriesPerProject: 15000,
  laragonRoot: "C:\\laragon",
  editor: "auto",
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

export async function loadConfig(): Promise<AppConfig> {
  let fileConfig: Partial<AppConfig> = {};
  const configPath = path.join(appDirectory, "devhub.config.json");

  try {
    fileConfig = JSON.parse(await readFile(configPath, "utf8")) as Partial<AppConfig>;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }

  const merged = { ...defaults, ...fileConfig };
  const configuredRoot = process.env.DEVHUB_ROOT ?? merged.scanRoot;
  const configuredPort = Number(process.env.DEVHUB_PORT ?? merged.port);
  const configuredHost = process.env.DEVHUB_HOST ?? merged.host;
  const configuredPublicHost = process.env.DEVHUB_PUBLIC_HOST ?? merged.publicHost;
  const configuredAutostartMode = process.env.DEVHUB_AUTOSTART_MODE ?? merged.autostartMode;

  if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
    throw new Error(`Ungültiger DevHub-Port: ${configuredPort}`);
  }

  if (!["127.0.0.1", "localhost", "::1"].includes(configuredHost) && process.env.DEVHUB_ALLOW_REMOTE !== "1") {
    throw new Error("DevHub darf standardmäßig nur an eine Loopback-Adresse gebunden werden.");
  }

  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(configuredPublicHost)) {
    throw new Error(`Ungültiger öffentlicher DevHub-Hostname: ${configuredPublicHost}`);
  }

  if (configuredAutostartMode !== "dev" && configuredAutostartMode !== "production") {
    throw new Error(`Ungültiger Autostart-Modus: ${configuredAutostartMode}`);
  }

  return {
    ...merged,
    host: configuredHost,
    publicHost: configuredPublicHost.toLowerCase(),
    autostartMode: configuredAutostartMode as AutostartMode,
    port: configuredPort,
    scanRoot: path.resolve(appDirectory, configuredRoot),
    categoryDepth: Math.max(0, Math.min(3, Math.trunc(Number(merged.categoryDepth ?? defaults.categoryDepth)) || 0)),
    maxDepth: Math.max(1, Math.min(12, Number(merged.maxDepth) || defaults.maxDepth)),
    maxEntriesPerProject: Math.max(1000, Math.min(100000, Number(merged.maxEntriesPerProject) || defaults.maxEntriesPerProject)),
    laragonRoot: path.resolve(merged.laragonRoot || defaults.laragonRoot),
    editor: merged.editor || defaults.editor,
    ignore: Array.from(new Set([...defaults.ignore, ...(merged.ignore ?? [])]))
  };
}

export async function saveScanRoot(config: AppConfig, requestedRoot: string, configPath = path.join(appDirectory, "devhub.config.json")): Promise<string> {
  if (process.env.DEVHUB_ROOT) {
    throw new Error("Der Workspace wird durch DEVHUB_ROOT vorgegeben und kann nicht im UI geändert werden.");
  }

  const value = requestedRoot.trim();
  if (!value || !path.isAbsolute(value)) {
    throw new Error("Gib einen absoluten Workspace-Pfad an.");
  }

  const resolvedRoot = path.resolve(value);
  const rootStats = await stat(resolvedRoot).catch(() => null);
  if (!rootStats?.isDirectory()) {
    throw new Error("Der gewählte Workspace existiert nicht oder ist kein Ordner.");
  }
  await access(resolvedRoot, constants.R_OK);

  let fileConfig: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Die DevHub-Konfiguration ist ungültig.");
    fileConfig = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({ ...fileConfig, scanRoot: resolvedRoot }, null, 2)}\n`, "utf8");
  await rename(temporaryPath, configPath);
  config.scanRoot = resolvedRoot;
  return resolvedRoot;
}

export function getAppDirectory(): string {
  return appDirectory;
}
