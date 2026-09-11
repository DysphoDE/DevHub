import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { commandPath, expandHome, fileExists, findMacApp, isLinux, isMac, isWindows, platformName, spawnDetached, trashSupport } from "./platform.js";
import type { AppConfig, SystemCapabilities } from "./types.js";

const execFileAsync = promisify(execFile);

interface ToolDefinition {
  executable: string;
  argsForPath: (projectPath: string) => string[];
  name: string;
  visible: boolean;
}

let cachedEditor: ToolDefinition | null | undefined;
let cachedTerminal: ToolDefinition | null | undefined;

function macAppTool(appPath: string, name: string): ToolDefinition {
  return { executable: "open", argsForPath: (projectPath) => ["-a", appPath, projectPath], name, visible: true };
}

function displayName(executable: string): string {
  return path.basename(executable, path.extname(executable)).replace(/\.app$/i, "");
}

/**
 * Ein konfigurierter Editor darf ein absoluter Pfad, ein Kommando auf dem PATH oder unter macOS
 * ein App-Name ("Cursor", "Visual Studio Code.app") sein.
 */
async function resolveConfiguredTool(value: string, fallbackName?: string): Promise<ToolDefinition | null> {
  const configured = expandHome(value.trim());
  if (!configured) return null;
  if (isMac) {
    const app = /\.app$/i.test(configured) || !configured.includes(path.sep) ? await findMacApp(configured) : null;
    if (app) return macAppTool(app, fallbackName ?? displayName(app));
    if (/\.app\/?$/i.test(configured) && await fileExists(configured)) return macAppTool(configured, fallbackName ?? displayName(configured));
  }
  if (path.isAbsolute(configured)) {
    return await fileExists(configured) ? { executable: configured, argsForPath: (projectPath) => [projectPath], name: fallbackName ?? displayName(configured), visible: true } : null;
  }
  const onPath = await commandPath(configured);
  return onPath ? { executable: onPath, argsForPath: (projectPath) => [projectPath], name: fallbackName ?? displayName(configured), visible: true } : null;
}

async function detectEditor(config: AppConfig): Promise<ToolDefinition | null> {
  if (cachedEditor !== undefined) return cachedEditor;
  if (config.editor !== "auto") {
    cachedEditor = await resolveConfiguredTool(config.editor);
    return cachedEditor;
  }

  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    const candidates = [
      { path: path.join(localAppData, "Programs", "cursor", "Cursor.exe"), name: "Cursor" },
      { path: path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"), name: "VS Code" },
      { path: path.join(programFiles, "Microsoft VS Code", "Code.exe"), name: "VS Code" },
      { path: path.join(localAppData, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe"), name: "VS Code Insiders" }
    ];
    for (const candidate of candidates) {
      if (candidate.path && await fileExists(candidate.path)) {
        cachedEditor = { executable: candidate.path, argsForPath: (projectPath) => [projectPath], name: candidate.name, visible: true };
        return cachedEditor;
      }
    }
  } else if (isMac) {
    const candidates = [
      ["Cursor", "Cursor"], ["Visual Studio Code", "VS Code"], ["Visual Studio Code - Insiders", "VS Code Insiders"],
      ["Zed", "Zed"], ["PhpStorm", "PhpStorm"], ["WebStorm", "WebStorm"], ["Sublime Text", "Sublime Text"], ["Nova", "Nova"]
    ];
    for (const [appName, name] of candidates) {
      const app = await findMacApp(appName);
      if (app) {
        cachedEditor = macAppTool(app, name);
        return cachedEditor;
      }
    }
  }

  // Auf jedem System zählt zuletzt, was auf dem PATH liegt (Linux-Standard, Windows/macOS als Rückfall).
  const commands: Array<[string, string]> = [["cursor", "Cursor"], ["code", "VS Code"], ["code-insiders", "VS Code Insiders"], ["codium", "VSCodium"], ["zed", "Zed"], ["subl", "Sublime Text"]];
  for (const [command, name] of commands) {
    const executable = await commandPath(command);
    if (executable) {
      cachedEditor = { executable, argsForPath: (projectPath) => [projectPath], name, visible: true };
      return cachedEditor;
    }
  }
  cachedEditor = null;
  return null;
}

async function detectTerminal(config: AppConfig): Promise<ToolDefinition | null> {
  if (cachedTerminal !== undefined) return cachedTerminal;
  if (config.terminal !== "auto") {
    cachedTerminal = await resolveConfiguredTool(config.terminal);
    if (cachedTerminal && isLinux) cachedTerminal = withLinuxWorkingDirectory(cachedTerminal);
    return cachedTerminal;
  }

  if (isWindows) {
    const windowsTerminal = await commandPath("wt.exe");
    cachedTerminal = windowsTerminal
      ? { executable: windowsTerminal, argsForPath: (projectPath) => ["-d", projectPath], name: "Windows Terminal", visible: true }
      : { executable: process.env.ComSpec ?? "cmd.exe", argsForPath: (projectPath) => ["/K", `cd /d "${projectPath.replaceAll('"', '""')}"`], name: "Eingabeaufforderung", visible: true };
    return cachedTerminal;
  }

  if (isMac) {
    for (const [appName, name] of [["iTerm", "iTerm"], ["Warp", "Warp"], ["Ghostty", "Ghostty"], ["kitty", "kitty"], ["Alacritty", "Alacritty"], ["Terminal", "Terminal"]]) {
      const app = await findMacApp(appName);
      if (app) {
        cachedTerminal = macAppTool(app, name);
        return cachedTerminal;
      }
    }
    cachedTerminal = null;
    return null;
  }

  for (const command of ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "kitty", "alacritty", "tilix", "foot", "wezterm"]) {
    const executable = await commandPath(command);
    if (executable) {
      cachedTerminal = withLinuxWorkingDirectory({ executable, argsForPath: () => [], name: displayName(executable), visible: true });
      return cachedTerminal;
    }
  }
  cachedTerminal = null;
  return null;
}

// Linux-Terminals kennen keinen gemeinsamen Schalter für das Startverzeichnis.
function withLinuxWorkingDirectory(tool: ToolDefinition): ToolDefinition {
  const name = path.basename(tool.executable);
  const argsForPath = (projectPath: string): string[] => {
    if (/^(gnome-terminal|xfce4-terminal|tilix|mate-terminal)/.test(name)) return [`--working-directory=${projectPath}`];
    if (/^konsole/.test(name)) return ["--workdir", projectPath];
    if (/^kitty/.test(name)) return ["-d", projectPath];
    if (/^alacritty/.test(name)) return ["--working-directory", projectPath];
    if (/^wezterm/.test(name)) return ["start", "--cwd", projectPath];
    if (/^foot/.test(name)) return ["-D", projectPath];
    return [];
  };
  return { ...tool, argsForPath };
}

function runDetached(tool: ToolDefinition, projectPath: string): Promise<void> {
  return spawnDetached(tool.executable, tool.argsForPath(projectPath), { visible: tool.visible, cwd: projectPath });
}

export async function getSystemCapabilities(config: AppConfig): Promise<SystemCapabilities> {
  const [editor, terminal, trash] = await Promise.all([detectEditor(config), detectTerminal(config), trashSupport()]);
  return {
    platform: process.platform,
    platformName: platformName(),
    editor: { available: Boolean(editor), name: editor?.name ?? null },
    terminal: { available: Boolean(terminal), name: terminal?.name ?? null },
    folder: true,
    folderPicker: isWindows || isMac || Boolean(await commandPath("zenity")) || Boolean(await commandPath("kdialog")),
    trash
  };
}

export async function chooseWorkspaceDirectory(initialPath: string): Promise<string | null> {
  if (isWindows) {
    const escapedPath = initialPath.replaceAll("'", "''");
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Choose the folder that contains your projects'",
      `$dialog.SelectedPath = '${escapedPath}'`,
      "$dialog.ShowNewFolderButton = $true",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }",
      "$dialog.Dispose()"
    ].join("; ");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120_000
    });
    return stdout.trim() || null;
  }

  if (isMac) {
    const escapedPath = initialPath.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    const appleScript = `POSIX path of (choose folder with prompt "Choose the folder that contains your projects" default location POSIX file "${escapedPath}")`;
    try {
      const { stdout } = await execFileAsync("osascript", ["-e", appleScript], { encoding: "utf8", timeout: 120_000 });
      return stdout.trim().replace(/\/$/, "") || null;
    } catch (error) {
      if ((error as { code?: number }).code === 1) return null;
      throw error;
    }
  }

  const zenity = await commandPath("zenity");
  if (zenity) {
    try {
      const { stdout } = await execFileAsync(zenity, ["--file-selection", "--directory", `--filename=${initialPath}${path.sep}`, "--title=Choose the folder that contains your projects"], { encoding: "utf8", timeout: 120_000 });
      return stdout.trim() || null;
    } catch (error) {
      if ((error as { code?: number }).code === 1) return null;
      throw error;
    }
  }
  const kdialog = await commandPath("kdialog");
  if (kdialog) {
    try {
      const { stdout } = await execFileAsync(kdialog, ["--getexistingdirectory", initialPath], { encoding: "utf8", timeout: 120_000 });
      return stdout.trim() || null;
    } catch (error) {
      if ((error as { code?: number }).code === 1) return null;
      throw error;
    }
  }

  throw new Error("Auf diesem System ist keine native Ordnerauswahl verfügbar. Gib den absoluten Pfad direkt ein.");
}

export async function runProjectAction(config: AppConfig, projectPath: string, action: "folder" | "editor" | "terminal"): Promise<string> {
  if (action === "folder") {
    const tool: ToolDefinition = isWindows
      ? { executable: "explorer.exe", argsForPath: (value) => [value], name: "Explorer", visible: true }
      : isMac
        ? { executable: "open", argsForPath: (value) => [value], name: "Finder", visible: true }
        : { executable: "xdg-open", argsForPath: (value) => [value], name: "Dateimanager", visible: true };
    await runDetached(tool, projectPath);
    return `${tool.name} geöffnet.`;
  }

  if (action === "editor") {
    const editor = await detectEditor(config);
    if (!editor) throw new Error("Kein unterstützter Editor wurde gefunden. Du kannst ihn in devhub.config.json konfigurieren.");
    await runDetached(editor, projectPath);
    return `${editor.name} geöffnet.`;
  }

  const terminal = await detectTerminal(config);
  if (!terminal) throw new Error(`Unter ${platformName()} wurde kein Terminal gefunden. Du kannst eines in devhub.config.json konfigurieren.`);
  await runDetached(terminal, projectPath);
  return `${terminal.name} geöffnet.`;
}
