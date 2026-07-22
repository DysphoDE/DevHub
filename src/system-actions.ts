import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig, SystemCapabilities } from "./types.js";

const execFileAsync = promisify(execFile);

interface ToolDefinition {
  executable: string;
  argsForPath: (projectPath: string) => string[];
  name: string;
  visible: boolean;
}

let cachedEditor: ToolDefinition | null | undefined;

async function exists(candidate: string): Promise<boolean> {
  try { await access(candidate); return true; } catch { return false; }
}

async function detectEditor(config: AppConfig): Promise<ToolDefinition | null> {
  if (cachedEditor !== undefined) return cachedEditor;
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const configured = config.editor !== "auto" ? config.editor : null;
  const candidates: Array<{ path: string; name: string }> = [
    ...(configured ? [{ path: configured, name: path.basename(configured, path.extname(configured)) }] : []),
    { path: path.join(localAppData, "Programs", "cursor", "Cursor.exe"), name: "Cursor" },
    { path: path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"), name: "VS Code" },
    { path: path.join(programFiles, "Microsoft VS Code", "Code.exe"), name: "VS Code" },
    { path: path.join(localAppData, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe"), name: "VS Code Insiders" }
  ];
  for (const candidate of candidates) {
    if (candidate.path && await exists(candidate.path)) {
      cachedEditor = { executable: candidate.path, argsForPath: (projectPath) => [projectPath], name: candidate.name, visible: true };
      return cachedEditor;
    }
  }
  cachedEditor = null;
  return null;
}

function runDetached(tool: ToolDefinition, projectPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool.executable, tool.argsForPath(projectPath), {
      detached: true,
      stdio: "ignore",
      windowsHide: !tool.visible
    });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

export async function getSystemCapabilities(config: AppConfig): Promise<SystemCapabilities> {
  const editor = await detectEditor(config);
  return {
    platform: process.platform,
    editor: { available: Boolean(editor), name: editor?.name ?? null },
    terminal: { available: process.platform === "win32", name: process.platform === "win32" ? "Windows Terminal" : null },
    folder: true,
    folderPicker: process.platform === "win32" || process.platform === "darwin"
  };
}

export async function chooseWorkspaceDirectory(initialPath: string): Promise<string | null> {
  if (process.platform === "win32") {
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

  if (process.platform === "darwin") {
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

  throw new Error("Auf diesem System ist keine native Ordnerauswahl verfügbar. Gib den absoluten Pfad direkt ein.");
}

export async function runProjectAction(config: AppConfig, projectPath: string, action: "folder" | "editor" | "terminal"): Promise<string> {
  if (action === "folder") {
    const tool: ToolDefinition = process.platform === "win32"
      ? { executable: "explorer.exe", argsForPath: (value) => [value], name: "Explorer", visible: true }
      : process.platform === "darwin"
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

  if (process.platform !== "win32") throw new Error("Terminal öffnen ist derzeit nur unter Windows verfügbar.");
  const terminal: ToolDefinition = {
    executable: "wt.exe",
    argsForPath: (value) => ["-d", value],
    name: "Windows Terminal",
    visible: true
  };
  try {
    await runDetached(terminal, projectPath);
  } catch {
    await runDetached({
      executable: process.env.ComSpec ?? "cmd.exe",
      argsForPath: (value) => ["/K", `cd /d "${value.replaceAll('"', '""')}"`],
      name: "Eingabeaufforderung",
      visible: true
    }, projectPath);
  }
  return "Terminal geöffnet.";
}
