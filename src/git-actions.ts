import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ProjectDefinition } from "./types.js";

const execFileAsync = promisify(execFile);

export type GitAction = "refresh" | "stage" | "unstage" | "stage-files" | "unstage-files" | "discard-files" | "stage-all" | "unstage-all" | "commit" | "fetch" | "pull" | "push";

export interface GitActionPayload {
  file?: unknown;
  files?: unknown;
  message?: unknown;
}

export interface GitDiffSection {
  scope: "staged" | "working";
  label: string;
  patch: string;
  truncated: boolean;
}

export interface GitHistoryCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
  parents: string[];
}

export interface GitHistoryPage {
  commits: GitHistoryCommit[];
  hasMore: boolean;
}

export interface GitCommitDetail extends GitHistoryCommit {
  files: Array<{ status: string; path: string; originalPath: string | null }>;
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

function knownFiles(project: ProjectDefinition, value: unknown): GitInfoFile[] {
  if (!Array.isArray(value) || !value.length || value.length > 500) {
    throw new Error("Wähle mindestens eine und höchstens 500 Dateien aus.");
  }
  const unique = [...new Set(value.map((file) => knownFile(project, file)))];
  return unique.map((file) => project.git!.files.find((candidate) => candidate.path === file)!);
}

type GitInfoFile = NonNullable<ProjectDefinition["git"]>["files"][number];

function filePaths(files: GitInfoFile[], includeOriginal = false): string[] {
  return [...new Set(files.flatMap((file) => includeOriginal && file.originalPath ? [file.path, file.originalPath] : [file.path]))];
}

function friendlyGitError(error: unknown): Error {
  const raw = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : error instanceof Error ? error.message : String(error);
  const text = raw.trim();
  if (/nothing to commit|no changes added to commit/i.test(text)) return new Error("Es sind keine vorgemerkten Änderungen für einen Commit vorhanden.");
  if (/please tell me who you are|unable to auto-detect email/i.test(text)) return new Error("Git-Benutzername und E-Mail fehlen. Konfiguriere sie zuerst im Terminal.");
  if (/authentication failed|could not read username|terminal prompts disabled/i.test(text)) return new Error("Remote-Anmeldung fehlgeschlagen. Melde dich einmal im Terminal beim Remote an.");
  if (/non-fast-forward|fetch first|rejected/i.test(text)) return new Error("Der Push wurde abgelehnt. Hole zuerst die neueren Remote-Commits im Terminal.");
  if (/would be overwritten by merge|please commit your changes or stash them/i.test(text)) return new Error("Lokale Änderungen verhindern den Pull. Committe oder sichere sie zuerst.");
  if (/not possible to fast-forward|divergent branches/i.test(text)) return new Error("Der Branch kann nicht automatisch vorgespult werden. Löse die Abweichung im Terminal.");
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

function parseHistoryCommit(record: string): GitHistoryCommit | null {
  const fields = record.replace(/^\s+|\s+$/g, "").split("\x1f");
  if (fields.length < 6 || !/^[0-9a-f]{40}$/i.test(fields[0])) return null;
  return {
    hash: fields[0], shortHash: fields[1], author: fields[2], date: fields[3], subject: fields[4],
    parents: fields[5].trim() ? fields[5].trim().split(/\s+/) : []
  };
}

export async function readGitHistory(project: ProjectDefinition, requestedOffset = 0, requestedLimit = 60): Promise<GitHistoryPage> {
  const repository = repositoryPath(project);
  if (!project.git?.lastCommit) return { commits: [], hasMore: false };
  const offset = Math.max(0, Math.floor(Number(requestedOffset) || 0));
  const limit = Math.min(100, Math.max(20, Math.floor(Number(requestedLimit) || 60)));
  const output = await git(repository, [
    "log", `--skip=${offset}`, `--max-count=${limit + 1}`,
    "--date=iso-strict", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%P%x1e"
  ], 30_000);
  const commits = output.split("\x1e").map(parseHistoryCommit).filter((commit): commit is GitHistoryCommit => Boolean(commit));
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
}

export async function readGitCommit(project: ProjectDefinition, requestedHash: unknown): Promise<GitCommitDetail> {
  const repository = repositoryPath(project);
  const hash = typeof requestedHash === "string" && /^[0-9a-f]{7,40}$/i.test(requestedHash) ? requestedHash : "";
  if (!hash) throw new Error("Der Commit-Hash ist ungültig.");
  const verifiedHash = await git(repository, ["rev-parse", "--verify", `${hash}^{commit}`]);
  const metadata = await git(repository, ["show", "-s", "--date=iso-strict", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%P", verifiedHash]);
  const commit = parseHistoryCommit(metadata);
  if (!commit) throw new Error("Commit-Metadaten konnten nicht gelesen werden.");
  const fileOutput = await git(repository, ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-M", verifiedHash], 30_000);
  const files = fileOutput.split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, firstPath = "", secondPath] = line.split("\t");
    return { status: status[0] || "M", path: secondPath || firstPath, originalPath: secondPath ? firstPath : null };
  });
  const result = limitedPatch(await gitDiff(repository, ["show", "--format=", "--no-ext-diff", "--no-color", "--unified=3", verifiedHash]));
  return { ...commit, files, ...result };
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
  if (action === "stage-files") {
    const files = knownFiles(project, payload.files);
    await git(repository, ["add", "-A", "--", ...filePaths(files)]);
    return `${files.length} ${files.length === 1 ? "Datei wurde" : "Dateien wurden"} vorgemerkt.`;
  }
  if (action === "unstage-files") {
    const files = knownFiles(project, payload.files).filter((file) => file.indexStatus !== "." && file.indexStatus !== "?");
    if (!files.length) return "In der Auswahl waren keine vorgemerkten Dateien.";
    const paths = filePaths(files, true);
    if (info.lastCommit) await git(repository, ["restore", "--staged", "--", ...paths]);
    else await git(repository, ["rm", "--cached", "-r", "--", ...paths]);
    return `${files.length} ${files.length === 1 ? "Vormerkung wurde" : "Vormerkungen wurden"} entfernt.`;
  }
  if (action === "discard-files") {
    const files = knownFiles(project, payload.files);
    const staged = files.filter((file) => file.indexStatus !== "." && file.indexStatus !== "?");
    if (staged.length) {
      const paths = filePaths(staged, true);
      if (info.lastCommit) await git(repository, ["reset", "-q", "HEAD", "--", ...paths]);
      else await git(repository, ["rm", "--cached", "-r", "--", ...paths]);
    }

    const restorePaths: string[] = [];
    const cleanPaths: string[] = [];
    for (const file of files) {
      if (!info.lastCommit) {
        cleanPaths.push(file.path);
      } else if (file.originalPath) {
        restorePaths.push(file.originalPath);
        cleanPaths.push(file.path);
      } else if (file.worktreeStatus === "?" || file.indexStatus === "A" || file.indexStatus === "C") {
        cleanPaths.push(file.path);
      } else {
        restorePaths.push(file.path);
      }
    }
    if (restorePaths.length) await git(repository, ["restore", "--source=HEAD", "--worktree", "--", ...new Set(restorePaths)]);
    if (cleanPaths.length) await git(repository, ["clean", "-f", "-d", "--", ...new Set(cleanPaths)]);
    return `${files.length} ${files.length === 1 ? "Änderung wurde" : "Änderungen wurden"} verworfen.`;
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
  if (action === "fetch") {
    if (!info.remoteName || !/^[\w.-]+$/.test(info.remoteName)) throw new Error("Kein verwendbares Git-Remote erkannt.");
    await git(repository, ["fetch", info.remoteName, "--prune"], 60_000);
    return "Remote-Stand wurde abgerufen.";
  }
  if (action === "pull") {
    if (!info.branch) throw new Error("Ein Pull ist im detached-HEAD-Zustand nicht verfügbar.");
    if (!info.upstream) throw new Error("Für diesen Branch ist noch kein Upstream eingerichtet.");
    await git(repository, ["pull", "--ff-only"], 60_000);
    return "Remote-Commits wurden übernommen.";
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
