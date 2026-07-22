import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ProjectDefinition } from "./types.js";

const execFileAsync = promisify(execFile);

export type GitAction = "refresh" | "stage" | "unstage" | "stage-all" | "unstage-all" | "commit" | "push";

export interface GitActionPayload {
  file?: unknown;
  message?: unknown;
}

export interface GitDiffSection {
  scope: "staged" | "working";
  label: string;
  patch: string;
  truncated: boolean;
}

function repositoryPath(project: ProjectDefinition): string {
  if (!project.git) throw new Error("Für dieses Projekt wurde kein Git-Repository erkannt.");
  const repository = path.resolve(project.absolutePath, project.git.repositoryRoot);
  const relative = path.relative(project.absolutePath, repository);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Das Git-Repository liegt außerhalb des Projektordners.");
  return repository;
}

function knownFile(project: ProjectDefinition, value: unknown): string {
  if (typeof value !== "string" || !project.git?.files.some((file) => file.path === value)) {
    throw new Error("Die Datei gehört nicht mehr zum aktuellen Git-Status. Bitte aktualisieren.");
  }
  return value;
}

function friendlyGitError(error: unknown): Error {
  const raw = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : error instanceof Error ? error.message : String(error);
  const text = raw.trim();
  if (/nothing to commit|no changes added to commit/i.test(text)) return new Error("Es sind keine vorgemerkten Änderungen für einen Commit vorhanden.");
  if (/please tell me who you are|unable to auto-detect email/i.test(text)) return new Error("Git-Benutzername und E-Mail fehlen. Konfiguriere sie zuerst im Terminal.");
  if (/authentication failed|could not read username|terminal prompts disabled/i.test(text)) return new Error("Push-Anmeldung fehlgeschlagen. Melde dich einmal im Terminal beim Remote an.");
  if (/non-fast-forward|fetch first|rejected/i.test(text)) return new Error("Der Push wurde abgelehnt. Hole zuerst die neueren Remote-Commits im Terminal.");
  return new Error(text.split(/\r?\n/).filter(Boolean).slice(-2).join(" ") || "Git-Aktion fehlgeschlagen.");
}

async function git(repository: string, args: string[], timeout = 15_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
      timeout,
      windowsHide: true,
      maxBuffer: 1_000_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" }
    });
    return stdout.trim();
  } catch (error) {
    throw friendlyGitError(error);
  }
}

async function gitDiff(repository: string, args: string[], allowDifferenceExit = false): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 5_000_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" }
    });
    return stdout;
  } catch (error) {
    if (allowDifferenceExit && error && typeof error === "object" && "code" in error && error.code === 1 && "stdout" in error) {
      return String(error.stdout);
    }
    throw friendlyGitError(error);
  }
}

function limitedPatch(patch: string): { patch: string; truncated: boolean } {
  const limit = 750_000;
  return patch.length > limit ? { patch: patch.slice(0, limit), truncated: true } : { patch, truncated: false };
}

export async function readGitDiff(project: ProjectDefinition, requestedFile: unknown): Promise<GitDiffSection[]> {
  const repository = repositoryPath(project);
  const file = knownFile(project, requestedFile);
  const change = project.git!.files.find((candidate) => candidate.path === file)!;
  const sections: GitDiffSection[] = [];
  const common = ["--no-ext-diff", "--no-color", "--unified=3"];

  if (change.indexStatus !== "." && change.indexStatus !== "?") {
    const result = limitedPatch(await gitDiff(repository, ["diff", "--cached", ...common, "--", file]));
    sections.push({ scope: "staged", label: "Vorgemerkte Änderungen", ...result });
  }
  if (change.worktreeStatus !== "." && change.worktreeStatus !== "?") {
    const result = limitedPatch(await gitDiff(repository, ["diff", ...common, "--", file]));
    sections.push({ scope: "working", label: "Lokale Änderungen", ...result });
  }
  if (change.worktreeStatus === "?") {
    const result = limitedPatch(await gitDiff(repository, ["diff", "--no-index", ...common, "--", "/dev/null", file], true));
    sections.push({ scope: "working", label: "Neue Datei", ...result });
  }
  return sections;
}

export async function runGitAction(project: ProjectDefinition, action: GitAction, payload: GitActionPayload): Promise<string> {
  const repository = repositoryPath(project);
  const info = project.git!;

  if (action === "refresh") return "Git-Status aktualisiert.";
  if (action === "stage") {
    await git(repository, ["add", "--", knownFile(project, payload.file)]);
    return "Datei vorgemerkt.";
  }
  if (action === "unstage") {
    const file = knownFile(project, payload.file);
    try {
      await git(repository, ["restore", "--staged", "--", file]);
    } catch (error) {
      if (info.lastCommit) throw error;
      await git(repository, ["rm", "--cached", "-r", "--", file]);
    }
    return "Datei aus der Vormerkung entfernt.";
  }
  if (action === "stage-all") {
    await git(repository, ["add", "-A"]);
    return "Alle Änderungen vorgemerkt.";
  }
  if (action === "unstage-all") {
    if (!info.staged) return "Es waren keine Dateien vorgemerkt.";
    if (info.lastCommit) await git(repository, ["reset"]);
    else await git(repository, ["rm", "--cached", "-r", "."]);
    return "Alle Vormerkungen entfernt.";
  }
  if (action === "commit") {
    const message = typeof payload.message === "string" ? payload.message.trim().replace(/\s+/g, " ") : "";
    if (message.length < 3) throw new Error("Die Commit-Nachricht muss mindestens drei Zeichen enthalten.");
    if (message.length > 200) throw new Error("Die Commit-Nachricht darf höchstens 200 Zeichen lang sein.");
    if (!info.staged) throw new Error("Merke zuerst mindestens eine Datei für den Commit vor.");
    await git(repository, ["commit", "-m", message], 30_000);
    return "Commit wurde erstellt.";
  }
  if (action === "push") {
    if (!info.branch) throw new Error("Ein Push ist im detached-HEAD-Zustand nicht verfügbar.");
    if (!info.remoteName || !/^[\w.-]+$/.test(info.remoteName)) throw new Error("Kein verwendbares Git-Remote erkannt.");
    if (info.upstream) await git(repository, ["push"], 60_000);
    else await git(repository, ["push", "--set-upstream", info.remoteName, info.branch], 60_000);
    return "Commits wurden zum Remote übertragen.";
  }
  throw new Error("Unbekannte Git-Aktion.");
}
