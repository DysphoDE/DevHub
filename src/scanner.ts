import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig, GitInfo, LauncherDefinition, LauncherKind, ProjectDefinition } from "./types.js";

const execFileAsync = promisify(execFile);
const packageScriptPattern = /^(dev|start|serve|preview)(:|$)/i;
const starterFiles = new Map<string, LauncherKind>([
  ["start.bat", "batch"],
  ["start.cmd", "command"],
  ["start.ps1", "powershell"]
]);
const thumbnailNames = new Set(["thumbnail.jpg", "thumbnail.jpeg", "thumbnail.png", "thumbnail.webp", "thumbnail.gif"]);
const genericHeadings = /^(readme|getting started|welcome|documentation|installation|development|home|react\s*\+\s*vite|vite\s*\+.*|astro starter kit.*)$/i;

interface PackageData {
  name?: string;
  displayName?: string;
  description?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface ComposerData {
  name?: string;
  description?: string;
  require?: Record<string, string>;
  "require-dev"?: Record<string, string>;
}

interface MetadataCandidate {
  name?: string;
  description?: string;
}

interface WorkspaceWebInfo {
  documentRoot: string | null;
  virtualHostCount: number;
  hosts: Array<{ documentRoot: string; serverName: string }>;
}

interface ScanEvidence {
  packagePaths: string[];
  composerPaths: string[];
  readmePaths: string[];
  htmlEntries: string[];
  phpEntries: string[];
  starterPaths: Array<{ path: string; kind: LauncherKind }>;
  thumbnailPath: string | null;
  gitRoot: string | null;
  names: Set<string>;
  fileCount: number;
  maxModifiedMs: number;
  truncated: boolean;
}

function stableId(value: string): string {
  return createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 16);
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function depthFrom(base: string, candidate: string): number {
  const relative = path.relative(base, candidate);
  return relative ? relative.split(path.sep).length : 0;
}

function pathStartsWith(candidate: string, parent: string): boolean {
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  const normalizedParent = path.resolve(parent).toLowerCase();
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(normalizedParent + path.sep.toLowerCase());
}

function humanize(value: string): string {
  const acronyms = new Map([["php", "PHP"], ["html", "HTML"], ["api", "API"], ["pdf", "PDF"], ["ui", "UI"], ["url", "URL"], ["sql", "SQL"], ["tuc", "TUC"], ["lra", "LRA"]]);
  return value
    .replace(/^@[^/]+\//, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => acronyms.get(word.toLocaleLowerCase("de")) ?? (word ? word[0].toLocaleUpperCase("de") + word.slice(1) : word))
    .join(" ");
}

function normalizedWords(value: string): string[] {
  return value.toLocaleLowerCase("de").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9äöüß]+/gi, " ").split(/\s+/).filter((word) => word.length >= 4);
}

function chooseInferredName(folderName: string, candidates: Array<string | undefined>, rawFolderName: string): string {
  const usable = candidates.map((value) => value?.trim()).filter((value): value is string => typeof value === "string" && value.length > 0 && !genericHeadings.test(value));
  const folderWords = new Set(normalizedWords(folderName));
  const folderLooksTechnical = /[_]/.test(rawFolderName) || rawFolderName === rawFolderName.toLocaleLowerCase("de");
  const matching = usable.find((candidate) => normalizedWords(candidate).some((word) => folderWords.has(word)));
  return matching ?? (folderLooksTechnical ? usable[0] : undefined) ?? folderName;
}

function truncate(value: string, length = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= length ? normalized : `${normalized.slice(0, length - 1).trim()}…`;
}

function parseProjectIni(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#") || line.startsWith("[")) continue;
    const match = line.match(/^([a-zA-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    result[match[1].toLowerCase()] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return result;
}

async function readText(filePath: string, maxBytes = 220_000): Promise<string> {
  try {
    const contents = await readFile(filePath);
    return contents.subarray(0, maxBytes).toString("utf8");
  } catch {
    return "";
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function parseReadme(contents: string): MetadataCandidate {
  const withoutCode = contents.replace(/```[\s\S]*?```/g, " ");
  const lines = withoutCode.split(/\r?\n/);
  const heading = lines
    .map((line) => line.match(/^#\s+(.+?)\s*#*$/)?.[1]?.trim())
    .find((value) => value && !genericHeadings.test(value) && !value.includes("[!"));
  const paragraphs = withoutCode
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph
      .replace(/^#{1,6}\s+.*$/gm, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^[-*+]\s+/gm, "")
      .replace(/[`*_>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim())
    .filter((paragraph) => paragraph.length >= 35 && !/^(install|usage|requirements|features|license)\b/i.test(paragraph));
  return { name: heading ? truncate(heading, 80) : undefined, description: paragraphs[0] ? truncate(paragraphs[0]) : undefined };
}

function parseHtml(contents: string): MetadataCandidate {
  const title = contents.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const description = contents.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1]
    ?? contents.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i)?.[1];
  return {
    name: title ? truncate(title, 80) : undefined,
    description: description ? truncate(description) : undefined
  };
}

async function readProjectIni(projectPath: string): Promise<Record<string, string>> {
  return parseProjectIni(await readText(path.join(projectPath, "project.ini"), 64_000));
}

async function readWorkspaceWebInfo(config: AppConfig): Promise<WorkspaceWebInfo> {
  const result: WorkspaceWebInfo = { documentRoot: null, virtualHostCount: 0, hosts: [] };
  const ini = await readText(path.join(config.laragonRoot, "usr", "laragon.ini"), 128_000);
  const apacheSection = ini.match(/\[apache\]([\s\S]*?)(?=\r?\n\[|$)/i)?.[1] ?? "";
  result.documentRoot = apacheSection.match(/^DocumentRoot\s*=\s*(.+)$/im)?.[1]?.trim() ?? null;

  const sitesDirectory = path.join(config.laragonRoot, "etc", "apache2", "sites-enabled");
  try {
    const files = (await readdir(sitesDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".conf"));
    result.virtualHostCount = files.filter((entry) => entry.name.toLowerCase().startsWith("auto.")).length;
    for (const file of files) {
      const contents = await readText(path.join(sitesDirectory, file.name), 64_000);
      const documentRoot = contents.match(/^\s*DocumentRoot\s+["']?([^"'\r\n]+)["']?/im)?.[1]?.trim();
      const serverName = contents.match(/^\s*ServerName\s+([^\s#]+)/im)?.[1]?.trim();
      if (documentRoot && serverName) result.hosts.push({ documentRoot: path.resolve(documentRoot), serverName });
    }
  } catch {
    // Laragon or its Apache configuration is optional.
  }
  return result;
}

async function detectPackageManager(packageDirectory: string, projectPath: string, packageManagerField?: string): Promise<"npm" | "pnpm" | "yarn" | "bun"> {
  const declared = packageManagerField?.split("@")[0];
  if (declared === "pnpm" || declared === "yarn" || declared === "bun" || declared === "npm") return declared;
  let current = packageDirectory;
  while (pathStartsWith(current, projectPath)) {
    const candidates: Array<[string, "npm" | "pnpm" | "yarn" | "bun"]> = [
      ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"], ["bun.lockb", "bun"], ["package-lock.json", "npm"]
    ];
    for (const [filename, manager] of candidates) {
      try {
        if ((await stat(path.join(current, filename))).isFile()) return manager;
      } catch { /* continue */ }
    }
    if (path.resolve(current) === path.resolve(projectPath)) break;
    current = path.dirname(current);
  }
  return "npm";
}

function packageCommand(manager: "npm" | "pnpm" | "yarn" | "bun", script: string): { executable: string; args: string[]; display: string } {
  const managerArgs = manager === "yarn" ? [script] : ["run", script];
  const display = [manager, ...managerArgs].join(" ");
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", [`${manager}.cmd`, ...managerArgs].join(" ")],
      display
    };
  }
  return { executable: manager, args: managerArgs, display };
}

function fileCommand(kind: LauncherKind, filePath: string): { executable: string; args: string[]; display: string } {
  const quotedName = `"${path.basename(filePath)}"`;
  if (kind === "powershell") {
    return {
      executable: process.platform === "win32" ? "powershell.exe" : "pwsh",
      args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filePath],
      display: `powershell -File ${quotedName}`
    };
  }
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", `call "${filePath}"`],
      display: quotedName
    };
  }
  return { executable: filePath, args: [], display: quotedName };
}

async function packageLaunchers(packagePath: string, projectId: string, projectPath: string): Promise<LauncherDefinition[]> {
  const packageJson = await readJson<PackageData>(packagePath);
  if (!packageJson) return [];
  const scripts = Object.keys(packageJson.scripts ?? {})
    .filter((name) => packageScriptPattern.test(name) && /^[a-zA-Z0-9:_-]+$/.test(name) && !/^(pre|post)/i.test(name))
    .sort((a, b) => {
      const priority = ["dev", "start", "serve", "preview"];
      return (priority.indexOf(a) < 0 ? 99 : priority.indexOf(a)) - (priority.indexOf(b) < 0 ? 99 : priority.indexOf(b)) || a.localeCompare(b);
    });
  const cwd = path.dirname(packagePath);
  const manager = await detectPackageManager(cwd, projectPath, packageJson.packageManager);
  const relativeCwd = toPosix(path.relative(projectPath, cwd)) || ".";
  return scripts.map((script, index) => {
    const command = packageCommand(manager, script);
    return {
      id: stableId(`${projectId}:${relativeCwd}:package:${script}`), projectId,
      name: relativeCwd === "." ? script : `${path.basename(cwd)} · ${script}`,
      kind: "package-script", relativeCwd, command: command.display, cwd,
      executable: command.executable, args: command.args, dynamicPort: false,
      preferred: script === "dev" || (index === 0 && !scripts.includes("dev"))
    };
  });
}

async function scanEvidence(projectPath: string, config: AppConfig, ownAppPath: string): Promise<ScanEvidence> {
  const evidence: ScanEvidence = {
    packagePaths: [], composerPaths: [], readmePaths: [], htmlEntries: [], phpEntries: [], starterPaths: [],
    thumbnailPath: null, gitRoot: null, names: new Set(), fileCount: 0, maxModifiedMs: 0, truncated: false
  };
  const ignored = new Set(config.ignore.map((name) => name.toLowerCase()));
  const queue: Array<{ directory: string; depth: number }> = [{ directory: projectPath, depth: 0 }];

  while (queue.length && evidence.fileCount < config.maxEntriesPerProject) {
    const current = queue.shift()!;
    let entries;
    try { entries = await readdir(current.directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const absolutePath = path.join(current.directory, entry.name);
      const lowerName = entry.name.toLowerCase();
      if (path.resolve(absolutePath) === path.resolve(ownAppPath) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (lowerName === ".git" && !evidence.gitRoot) evidence.gitRoot = current.directory;
        if (current.depth < config.maxDepth && !ignored.has(lowerName) && !entry.name.startsWith(".")) {
          queue.push({ directory: absolutePath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      evidence.fileCount++;
      evidence.names.add(lowerName);
      if (lowerName === "package.json") evidence.packagePaths.push(absolutePath);
      if (lowerName === "composer.json") evidence.composerPaths.push(absolutePath);
      if (/^readme(?:\.[a-z0-9_-]+)?$/i.test(entry.name) && current.depth <= 2) evidence.readmePaths.push(absolutePath);
      if ((lowerName.endsWith(".html") || lowerName.endsWith(".htm")) && current.depth <= 2) evidence.htmlEntries.push(absolutePath);
      if (lowerName === "index.php") evidence.phpEntries.push(absolutePath);
      const starterKind = starterFiles.get(lowerName);
      if (starterKind) evidence.starterPaths.push({ path: absolutePath, kind: starterKind });
      if (!evidence.thumbnailPath && thumbnailNames.has(lowerName) && current.depth <= 1) evidence.thumbnailPath = absolutePath;
      if (evidence.fileCount >= config.maxEntriesPerProject) { evidence.truncated = true; break; }
    }
  }
  try { evidence.maxModifiedMs = (await stat(projectPath)).mtimeMs; } catch { evidence.maxModifiedMs = Date.now(); }
  return evidence;
}

function addPackageTechnologies(technologies: Set<string>, packageJson: PackageData, names: Set<string>): void {
  technologies.add("Node.js");
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const has = (name: string) => Object.hasOwn(dependencies, name);
  if (has("next")) technologies.add("Next.js");
  else if (has("react")) technologies.add("React");
  if (has("vue")) technologies.add("Vue");
  if (has("svelte") || has("@sveltejs/kit")) technologies.add("Svelte");
  if (has("astro")) technologies.add("Astro");
  if (has("nuxt")) technologies.add("Nuxt");
  if (has("vite") || [...names].some((name) => name.startsWith("vite.config."))) technologies.add("Vite");
  if (has("electron")) technologies.add("Electron");
  if (has("tailwindcss")) technologies.add("Tailwind");
}

function addComposerTechnologies(technologies: Set<string>, composer: ComposerData): void {
  technologies.add("PHP");
  technologies.add("Composer");
  const dependencies = { ...composer.require, ...composer["require-dev"] };
  if (Object.keys(dependencies).some((name) => name.startsWith("laravel/"))) technologies.add("Laravel");
  if (Object.keys(dependencies).some((name) => name.startsWith("symfony/"))) technologies.add("Symfony");
}

function autoDescription(technologies: string[], fileCount: number, truncated: boolean): string {
  const primary = technologies.includes("WordPress") ? "WordPress-Projekt"
    : technologies.includes("Laravel") ? "Laravel-Anwendung"
    : technologies.includes("Next.js") ? "Next.js-Anwendung"
    : technologies.includes("PHP") ? "PHP-Projekt"
    : technologies.includes("HTML") ? "Statische Website"
    : technologies.includes("Node.js") ? "Node.js-Projekt"
    : "Lokaler Projektordner";
  const extra = technologies.filter((technology) => !primary.toLowerCase().includes(technology.toLowerCase())).slice(0, 2);
  return `${primary}${extra.length ? ` mit ${extra.join(" und ")}` : ""} · ${fileCount}${truncated ? "+" : ""} Dateien erkannt`;
}

function gitRemoteWebUrl(remote: string): string | null {
  const value = remote.trim();
  if (!value) return null;
  const ssh = value.match(/^git@([^:]+):(.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2].replace(/\.git$/, "")}`;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\.git$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function readGitInfo(repositoryPath: string | null, projectPath: string): Promise<GitInfo | null> {
  if (!repositoryPath) return null;
  try {
    const options = { timeout: 5000, windowsHide: true, maxBuffer: 2_000_000 };
    const [statusResult, logResult, remoteResult] = await Promise.all([
      execFileAsync("git", ["-C", repositoryPath, "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], options),
      execFileAsync("git", ["-C", repositoryPath, "log", "-1", "--format=%h%x1f%s%x1f%an%x1f%aI"], options).catch(() => ({ stdout: "", stderr: "" })),
      execFileAsync("git", ["-C", repositoryPath, "remote", "get-url", "origin"], options).catch(() => ({ stdout: "", stderr: "" }))
    ]);
    const records = statusResult.stdout.split("\0").filter(Boolean);
    const branch = records.find((line) => line.startsWith("# branch.head "))?.slice(14).trim() || null;
    const upstream = records.find((line) => line.startsWith("# branch.upstream "))?.slice(18).trim() || null;
    const ab = records.find((line) => line.startsWith("# branch.ab "))?.match(/\+(\d+)\s+-(\d+)/);
    let staged = 0;
    let unstaged = 0;
    let untracked = 0;
    const files: GitInfo["files"] = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record.startsWith("? ")) {
        untracked += 1;
        files.push({ path: record.slice(2), originalPath: null, indexStatus: "?", worktreeStatus: "?" });
        continue;
      }
      if (!/^[12u] /.test(record)) continue;
      const parts = record.split(" ");
      const state = parts[1] || "..";
      const pathIndex = record.startsWith("1 ") ? 8 : record.startsWith("2 ") ? 9 : 10;
      const filePath = parts.slice(pathIndex).join(" ");
      const originalPath = record.startsWith("2 ") ? records[++index] || null : null;
      if (state[0] && state[0] !== ".") staged += 1;
      if (state[1] && state[1] !== ".") unstaged += 1;
      files.push({ path: filePath, originalPath, indexStatus: state[0] || ".", worktreeStatus: state[1] || "." });
    }
    const commitParts = logResult.stdout.trim().split("\x1f");
    const lastCommit = commitParts.length === 4 ? {
      hash: commitParts[0], subject: commitParts[1], author: commitParts[2], date: commitParts[3]
    } : null;
    const remoteName = upstream?.includes("/") ? upstream.split("/")[0] : remoteResult.stdout.trim() ? "origin" : null;
    return {
      branch: branch === "(detached)" ? null : branch,
      dirty: staged + unstaged + untracked > 0,
      ahead: Number(ab?.[1] || 0),
      behind: Number(ab?.[2] || 0),
      staged,
      unstaged,
      untracked,
      changedFiles: files.length,
      remoteName,
      remoteUrl: gitRemoteWebUrl(remoteResult.stdout),
      upstream,
      repositoryRoot: toPosix(path.relative(projectPath, repositoryPath)) || ".",
      files: files.slice(0, 500),
      filesTruncated: files.length > 500,
      lastCommit
    };
  } catch {
    const head = await readText(path.join(repositoryPath, ".git", "HEAD"), 1024);
    return head ? {
      branch: head.match(/^ref:\s+refs\/heads\/(.+)$/)?.[1]?.trim() ?? null,
      dirty: false, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, changedFiles: 0,
      remoteName: null, remoteUrl: null, upstream: null, repositoryRoot: toPosix(path.relative(projectPath, repositoryPath)) || ".",
      files: [], filesTruncated: false, lastCommit: null
    } : null;
  }
}

function urlForProject(projectPath: string, metadataUrl: string | undefined, webInfo: WorkspaceWebInfo): string | null {
  if (metadataUrl && /^https?:\/\//i.test(metadataUrl)) return metadataUrl;
  const host = webInfo.hosts.find((candidate) => pathStartsWith(candidate.documentRoot, projectPath));
  if (host) return `http://${host.serverName}/`;
  if (webInfo.documentRoot && pathStartsWith(projectPath, webInfo.documentRoot)) {
    const relative = path.relative(webInfo.documentRoot, projectPath).split(path.sep).map(encodeURIComponent).join("/");
    return `http://localhost/${relative}/`;
  }
  return null;
}

function sortByDepth(projectPath: string, paths: string[]): string[] {
  return [...paths].sort((a, b) => depthFrom(projectPath, a) - depthFrom(projectPath, b) || a.localeCompare(b));
}

async function scanProject(projectPath: string, rootPath: string, config: AppConfig, ownAppPath: string, webInfo: WorkspaceWebInfo): Promise<ProjectDefinition> {
  const relativePath = toPosix(path.relative(rootPath, projectPath));
  const projectId = stableId(relativePath);
  const isOwnApp = path.relative(projectPath, ownAppPath) === "";
  const evidence = await scanEvidence(projectPath, config, ownAppPath);
  evidence.packagePaths = sortByDepth(projectPath, evidence.packagePaths);
  evidence.composerPaths = sortByDepth(projectPath, evidence.composerPaths);
  evidence.readmePaths = sortByDepth(projectPath, evidence.readmePaths);
  evidence.htmlEntries = sortByDepth(projectPath, evidence.htmlEntries);
  evidence.htmlEntries.sort((a, b) => Number(!/^index\.html?$/i.test(path.basename(a))) - Number(!/^index\.html?$/i.test(path.basename(b))) || depthFrom(projectPath, a) - depthFrom(projectPath, b));
  evidence.phpEntries = sortByDepth(projectPath, evidence.phpEntries);

  const [metadata, packages, composers, readme, html] = await Promise.all([
    readProjectIni(projectPath),
    Promise.all(evidence.packagePaths.map((file) => readJson<PackageData>(file))),
    Promise.all(evidence.composerPaths.map((file) => readJson<ComposerData>(file))),
    evidence.readmePaths[0] ? readText(evidence.readmePaths[0]) : "",
    (evidence.htmlEntries[0] ?? evidence.phpEntries[0]) ? readText(evidence.htmlEntries[0] ?? evidence.phpEntries[0]) : ""
  ]);
  const validPackages = packages.filter((value): value is PackageData => Boolean(value));
  const validComposers = composers.filter((value): value is ComposerData => Boolean(value));
  const readmeMeta = parseReadme(readme);
  const htmlMeta = parseHtml(html);
  const primaryPackage = validPackages[0];
  const primaryComposer = validComposers[0];

  const technologies = new Set<string>();
  for (const packageJson of validPackages) addPackageTechnologies(technologies, packageJson, evidence.names);
  for (const composer of validComposers) addComposerTechnologies(technologies, composer);
  if (evidence.phpEntries.length || [...evidence.names].some((name) => name.endsWith(".php"))) technologies.add("PHP");
  if (evidence.htmlEntries.length || [...evidence.names].some((name) => name.endsWith(".html") || name.endsWith(".htm"))) technologies.add("HTML");
  if (evidence.names.has("wp-config.php") || evidence.names.has("wp-load.php")) technologies.add("WordPress");
  if (evidence.names.has("artisan")) { technologies.add("Laravel"); technologies.add("PHP"); }
  if (evidence.names.has("symfony.lock")) { technologies.add("Symfony"); technologies.add("PHP"); }
  if (evidence.names.has("dockerfile") || evidence.names.has("docker-compose.yml") || evidence.names.has("compose.yml")) technologies.add("Docker");
  if (evidence.names.has("pyproject.toml") || evidence.names.has("requirements.txt") || [...evidence.names].some((name) => name.endsWith(".py"))) technologies.add("Python");
  if (evidence.names.has("manifest.json") && evidence.names.has("background.js")) technologies.add("Browser Extension");
  if (evidence.names.has("interface.toc") || [...evidence.names].some((name) => name.endsWith(".toc"))) technologies.add("WoW Addon");

  const technologyOrder = ["Laravel", "WordPress", "Symfony", "Next.js", "React", "Vue", "Svelte", "Astro", "Nuxt", "PHP", "HTML", "Node.js", "Python", "Docker", "Composer", "Vite", "Tailwind", "Electron", "Browser Extension", "WoW Addon"];
  const sortedTechnologies = [...technologies].sort((a, b) => technologyOrder.indexOf(a) - technologyOrder.indexOf(b));
  const packageName = primaryPackage?.displayName || (primaryPackage?.name ? humanize(primaryPackage.name) : undefined);
  const composerName = primaryComposer?.name ? humanize(primaryComposer.name.split("/").pop() ?? primaryComposer.name) : undefined;
  const folderName = humanize(path.basename(projectPath));
  const inferredName = metadata.title || primaryPackage?.displayName || chooseInferredName(folderName, [
    depthFrom(projectPath, evidence.readmePaths[0] ?? projectPath) <= 1 ? readmeMeta.name : undefined,
    htmlMeta.name,
    packageName,
    composerName
  ], path.basename(projectPath));
  const inferredDescription = metadata.description || primaryPackage?.description || primaryComposer?.description || htmlMeta.description || readmeMeta.description
    || autoDescription(sortedTechnologies, evidence.fileCount, evidence.truncated);

  const launchers = (await Promise.all(evidence.packagePaths.map((packagePath) => packageLaunchers(packagePath, projectId, projectPath)))).flat();
  for (const starter of evidence.starterPaths) {
    const cwd = path.dirname(starter.path);
    const relativeCwd = toPosix(path.relative(projectPath, cwd)) || ".";
    const command = fileCommand(starter.kind, starter.path);
    launchers.push({
      id: stableId(`${projectId}:${relativeCwd}:${path.basename(starter.path).toLowerCase()}`), projectId,
      name: relativeCwd === "." ? path.basename(starter.path) : `${path.basename(cwd)} · ${path.basename(starter.path)}`,
      kind: starter.kind, relativeCwd, command: command.display, cwd, executable: command.executable,
      args: command.args, dynamicPort: false, preferred: launchers.length === 0
    });
  }

  const preferredPhpEntry = evidence.phpEntries.find((entry) => path.basename(path.dirname(entry)).toLowerCase() === "public") ?? evidence.phpEntries[0];
  const preferredHtmlEntry = evidence.htmlEntries.find((entry) => depthFrom(projectPath, entry) <= 1) ?? evidence.htmlEntries[0];
  const webRoot = preferredPhpEntry ? path.dirname(preferredPhpEntry) : preferredHtmlEntry ? path.dirname(preferredHtmlEntry) : null;
  const hasPreferredLauncher = launchers.some((launcher) => launcher.preferred);
  if (preferredPhpEntry && webRoot) {
    launchers.push({
      id: stableId(`${projectId}:php-preview:${webRoot}`), projectId, name: "PHP-Vorschau", kind: "php-server",
      relativeCwd: toPosix(path.relative(projectPath, webRoot)) || ".", command: "php -S 127.0.0.1:{port}",
      cwd: webRoot, executable: "php.exe", args: ["-S", "127.0.0.1:{port}", "-t", webRoot], dynamicPort: true,
      preferred: !hasPreferredLauncher
    });
  } else if (preferredHtmlEntry && webRoot && !validPackages.length) {
    const staticServer = path.join(ownAppPath, "runtime", "static-server.mjs");
    const entryFile = path.basename(preferredHtmlEntry);
    launchers.push({
      id: stableId(`${projectId}:static-preview:${webRoot}`), projectId, name: "HTML-Vorschau", kind: "static-server",
      relativeCwd: toPosix(path.relative(projectPath, webRoot)) || ".", command: "DevHub Static Server · {port}",
      cwd: webRoot, executable: process.execPath, args: [staticServer, "--root", webRoot, "--port", "{port}", "--entry", entryFile], dynamicPort: true,
      preferred: !hasPreferredLauncher
    });
  }

  const uniqueLaunchers = Array.from(new Map(launchers.map((launcher) => [launcher.id, launcher])).values())
    .sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.name.localeCompare(b.name, "de"));
  return {
    id: projectId,
    name: truncate(inferredName, 80),
    description: truncate(inferredDescription),
    relativePath,
    absolutePath: projectPath,
    thumbnailPath: evidence.thumbnailPath,
    modifiedAt: new Date(evidence.maxModifiedMs || Date.now()).toISOString(),
    technologies: sortedTechnologies.length ? sortedTechnologies : ["Projektordner"],
    kind: sortedTechnologies[0] ?? "Projektordner",
    defaultUrl: webRoot || metadata.url ? urlForProject(projectPath, metadata.url, webInfo) : null,
    webRoot,
    git: await readGitInfo(evidence.gitRoot, projectPath),
    fileCount: evidence.fileCount,
    launchers: isOwnApp ? [] : uniqueLaunchers
  };
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function scanWorkspace(config: AppConfig, ownAppPath: string): Promise<ProjectDefinition[]> {
  const entries = await readdir(config.scanRoot, { withFileTypes: true });
  const ignored = new Set(config.ignore.map((name) => name.toLowerCase()));
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .filter((entry) => !entry.name.startsWith(".") && !entry.name.startsWith("_") && !entry.name.startsWith("$"))
    .filter((entry) => !ignored.has(entry.name.toLowerCase()))
    .map((entry) => path.join(config.scanRoot, entry.name));
  const webInfo = await readWorkspaceWebInfo(config);
  const projects = await mapLimit(directories, 6, (directory) => scanProject(directory, config.scanRoot, config, ownAppPath, webInfo));
  return projects.sort((a, b) => a.name.localeCompare(b.name, "de"));
}
