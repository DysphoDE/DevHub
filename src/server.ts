import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, getAppDirectory, saveScanRoot } from "./config.js";
import { readGitCommit, readGitDiff, readGitHistory, runGitAction, suggestGitCommitMessage, type GitAction, type GitActionPayload } from "./git-actions.js";
import { getLaragonStatus, runLaragonAction, type LaragonAction } from "./laragon.js";
import { ProcessManager } from "./process-manager.js";
import { readGitInfo, scanWorkspace } from "./scanner.js";
import { chooseWorkspaceDirectory, getSystemCapabilities, runProjectAction } from "./system-actions.js";
import type { ProjectDefinition, PublicProject } from "./types.js";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(sourceDirectory, "../public");
const fontAwesomeDirectory = path.resolve(sourceDirectory, "../node_modules/@fortawesome/fontawesome-free");
const config = await loadConfig();
const processManager = new ProcessManager();
const capabilities = await getSystemCapabilities(config);
const csrfToken = randomBytes(24).toString("base64url");
let projects: ProjectDefinition[] = [];
let scanning = false;
let scanPromise: Promise<void> | null = null;
const eventClients = new Set<ServerResponse>();

function isLoopback(address?: string): boolean {
  if (!address) return false;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}

function publicProject(project: ProjectDefinition): PublicProject {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    relativePath: project.relativePath,
    modifiedAt: project.modifiedAt,
    technologies: project.technologies,
    kind: project.kind,
    defaultUrl: project.defaultUrl,
    git: project.git,
    fileCount: project.fileCount,
    thumbnailUrl: project.thumbnailPath ? `/api/projects/${project.id}/thumbnail` : null,
    launchers: project.launchers.map(({ cwd: _cwd, executable: _executable, args: _args, ...launcher }) => ({
      ...launcher,
      runtime: processManager.getSnapshot(launcher.id)
    }))
  };
}

function publicProjects(): PublicProject[] {
  return projects.map(publicProject);
}

function findLauncher(id: string) {
  for (const project of projects) {
    const launcher = project.launchers.find((candidate) => candidate.id === id);
    if (launcher) return launcher;
  }
  return null;
}

function broadcast(type: string, payload: unknown): void {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of eventClients) client.write(message);
}

processManager.onChange((launcherId, runtime) => broadcast("runtime", { launcherId, runtime }));
processManager.onLog((launcherId, entry) => broadcast("log", { launcherId, entry }));

async function refreshProjects(): Promise<void> {
  if (scanPromise) return scanPromise;
  scanning = true;
  scanPromise = (async () => {
    try {
      projects = await scanWorkspace(config, getAppDirectory());
      broadcast("projects", { projects: publicProjects() });
    } finally {
      scanning = false;
      scanPromise = null;
    }
  })();
  return scanPromise;
}

function requireToken(request: IncomingMessage, response: ServerResponse): boolean {
  if (request.headers["x-devhub-token"] !== csrfToken) {
    sendJson(response, 403, { error: "Ungültiges Sicherheitstoken. Bitte die Seite neu laden." });
    return false;
  }
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error("Anfrage ist zu groß.");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Ungültige Anfrage.");
  return parsed as Record<string, unknown>;
}

async function refreshProjectGit(project: ProjectDefinition): Promise<void> {
  if (!project.git) return;
  const repository = path.resolve(project.absolutePath, project.git.repositoryRoot);
  project.git = await readGitInfo(repository, project.absolutePath);
}

function serveStatic(requestPath: string, response: ServerResponse): void {
  const fontAwesomePrefix = "/vendor/fontawesome/";
  const isFontAwesomeAsset = requestPath.startsWith(fontAwesomePrefix);
  const requested = isFontAwesomeAsset
    ? requestPath.slice(fontAwesomePrefix.length)
    : requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const rootDirectory = isFontAwesomeAsset ? fontAwesomeDirectory : publicDirectory;
  const allowedFontAwesomeAsset = /^(?:css\/(?:fontawesome|solid|regular)\.min\.css|webfonts\/fa-(?:solid-900|regular-400)\.woff2)$/;
  const resolved = path.resolve(rootDirectory, requested);
  if ((isFontAwesomeAsset && !allowedFontAwesomeAsset.test(requested)) || (!resolved.startsWith(rootDirectory + path.sep) && resolved !== path.join(rootDirectory, "index.html"))) {
    sendJson(response, 404, { error: "Nicht gefunden" });
    return;
  }
  const extensions: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2"
  };
  stat(resolved).then((fileStats) => {
    if (!fileStats.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "Content-Type": extensions[path.extname(resolved)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    createReadStream(resolved).pipe(response);
  }).catch(() => sendJson(response, 404, { error: "Nicht gefunden" }));
}

const server = createServer(async (request, response) => {
  if (!isLoopback(request.socket.remoteAddress)) {
    sendJson(response, 403, { error: "DevHub ist nur lokal erreichbar." });
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (request.method === "GET" && pathname === "/api/bootstrap") {
      sendJson(response, 200, {
        token: csrfToken,
        root: config.scanRoot,
        publicUrl: `http://${config.publicHost}:${config.port}`,
        projects: publicProjects(),
        capabilities,
        laragon: await getLaragonStatus(config),
        scanning
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      response.write("event: connected\ndata: {}\n\n");
      eventClients.add(response);
      request.on("close", () => eventClients.delete(response));
      return;
    }

    if (request.method === "GET" && pathname === "/api/laragon/status") {
      sendJson(response, 200, { laragon: await getLaragonStatus(config) });
      return;
    }

    const thumbnailMatch = pathname.match(/^\/api\/projects\/([a-f0-9]+)\/thumbnail$/);
    if (request.method === "GET" && thumbnailMatch) {
      const project = projects.find((candidate) => candidate.id === thumbnailMatch[1]);
      if (!project?.thumbnailPath) {
        sendJson(response, 404, { error: "Kein Vorschaubild vorhanden." });
        return;
      }
      const mimeTypes: Record<string, string> = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"
      };
      response.writeHead(200, { "Content-Type": mimeTypes[path.extname(project.thumbnailPath).toLowerCase()] ?? "application/octet-stream" });
      createReadStream(project.thumbnailPath).pipe(response);
      return;
    }

    const logsMatch = pathname.match(/^\/api\/launchers\/([a-f0-9]+)\/logs$/);
    if (request.method === "GET" && logsMatch) {
      if (!findLauncher(logsMatch[1])) {
        sendJson(response, 404, { error: "Starter nicht gefunden." });
        return;
      }
      sendJson(response, 200, { logs: processManager.getLogs(logsMatch[1]) });
      return;
    }

    if (request.method === "POST" && pathname === "/api/rescan") {
      if (!requireToken(request, response)) return;
      await refreshProjects();
      sendJson(response, 200, { projects: publicProjects() });
      return;
    }

    if (request.method === "POST" && pathname === "/api/settings/workspace/pick") {
      if (!requireToken(request, response)) return;
      const root = await chooseWorkspaceDirectory(config.scanRoot);
      sendJson(response, 200, { root });
      return;
    }

    if (request.method === "PUT" && pathname === "/api/settings/workspace") {
      if (!requireToken(request, response)) return;
      const payload = await readJsonBody(request);
      if (typeof payload.root !== "string") {
        sendJson(response, 400, { error: "Ein Workspace-Pfad ist erforderlich." });
        return;
      }
      if (scanPromise) await scanPromise;
      let root: string;
      try {
        root = await saveScanRoot(config, payload.root);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : "Der Workspace konnte nicht gespeichert werden." });
        return;
      }
      await processManager.stopAll();
      await refreshProjects();
      const publicPayload = { root, projects: publicProjects() };
      broadcast("workspace", publicPayload);
      sendJson(response, 200, publicPayload);
      return;
    }

    const projectActionMatch = pathname.match(/^\/api\/projects\/([a-f0-9]+)\/(folder|editor|terminal)$/);
    if (request.method === "POST" && projectActionMatch) {
      if (!requireToken(request, response)) return;
      const project = projects.find((candidate) => candidate.id === projectActionMatch[1]);
      if (!project) {
        sendJson(response, 404, { error: "Projekt nicht gefunden. Bitte Projekte neu einlesen." });
        return;
      }
      const message = await runProjectAction(config, project.absolutePath, projectActionMatch[2] as "folder" | "editor" | "terminal");
      sendJson(response, 200, { message });
      return;
    }

    const gitMessageMatch = pathname.match(/^\/api\/projects\/([a-f0-9]+)\/git\/commit-message$/);
    if (request.method === "GET" && gitMessageMatch) {
      const project = projects.find((candidate) => candidate.id === gitMessageMatch[1]);
      if (!project?.git) {
        sendJson(response, 404, { error: "Git-Repository nicht gefunden. Bitte Projekte neu einlesen." });
        return;
      }
      sendJson(response, 200, { message: await suggestGitCommitMessage(project) });
      return;
    }

    const gitActionMatch = pathname.match(/^\/api\/projects\/([a-f0-9]+)\/git\/(refresh|stage|unstage|stage-files|unstage-files|discard-files|stage-all|unstage-all|commit|fetch|pull|push)$/);
    if (request.method === "POST" && gitActionMatch) {
      if (!requireToken(request, response)) return;
      const project = projects.find((candidate) => candidate.id === gitActionMatch[1]);
      if (!project?.git) {
        sendJson(response, 404, { error: "Git-Repository nicht gefunden. Bitte Projekte neu einlesen." });
        return;
      }
      const payload = await readJsonBody(request) as GitActionPayload;
      const message = await runGitAction(project, gitActionMatch[2] as GitAction, payload);
      await refreshProjectGit(project);
      broadcast("projects", { projects: publicProjects() });
      sendJson(response, 200, { message, project: publicProject(project) });
      return;
    }

    const gitDiffMatch = pathname.match(/^\/api\/projects\/([a-f0-9]+)\/git\/diff$/);
    if (request.method === "GET" && gitDiffMatch) {
      const project = projects.find((candidate) => candidate.id === gitDiffMatch[1]);
      if (!project?.git) {
        sendJson(response, 404, { error: "Git-Repository nicht gefunden. Bitte Projekte neu einlesen." });
        return;
      }
      const file = url.searchParams.get("file");
      sendJson(response, 200, { file, sections: await readGitDiff(project, file) });
      return;
    }

    const gitHistoryMatch = pathname.match(/^\/api\/projects\/([a-f0-9]+)\/git\/history$/);
    if (request.method === "GET" && gitHistoryMatch) {
      const project = projects.find((candidate) => candidate.id === gitHistoryMatch[1]);
      if (!project?.git) {
        sendJson(response, 404, { error: "Git-Repository nicht gefunden. Bitte Projekte neu einlesen." });
        return;
      }
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Number(url.searchParams.get("limit") || 60);
      sendJson(response, 200, await readGitHistory(project, offset, limit));
      return;
    }

    const gitCommitMatch = pathname.match(/^\/api\/projects\/([a-f0-9]+)\/git\/commits\/([0-9a-f]{7,40})$/i);
    if (request.method === "GET" && gitCommitMatch) {
      const project = projects.find((candidate) => candidate.id === gitCommitMatch[1]);
      if (!project?.git) {
        sendJson(response, 404, { error: "Git-Repository nicht gefunden. Bitte Projekte neu einlesen." });
        return;
      }
      sendJson(response, 200, await readGitCommit(project, gitCommitMatch[2]));
      return;
    }

    const laragonActionMatch = pathname.match(/^\/api\/laragon\/(open|start|stop|reload|reload-apache|reload-nginx)$/);
    if (request.method === "POST" && laragonActionMatch) {
      if (!requireToken(request, response)) return;
      const message = await runLaragonAction(config, laragonActionMatch[1] as LaragonAction);
      sendJson(response, 200, { message, laragon: await getLaragonStatus(config) });
      return;
    }

    const actionMatch = pathname.match(/^\/api\/launchers\/([a-f0-9]+)\/(start|stop|restart)$/);
    if (request.method === "POST" && actionMatch) {
      if (!requireToken(request, response)) return;
      const launcher = findLauncher(actionMatch[1]);
      if (!launcher) {
        sendJson(response, 404, { error: "Starter nicht gefunden. Bitte Projekte neu einlesen." });
        return;
      }
      const runtime = actionMatch[2] === "start"
        ? await processManager.start(launcher)
        : actionMatch[2] === "restart"
          ? await processManager.restart(launcher)
          : await processManager.stop(launcher.id);
      sendJson(response, 200, { runtime });
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "API-Endpunkt nicht gefunden." });
      return;
    }
    serveStatic(pathname, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    sendJson(response, 500, { error: message });
  }
});

await refreshProjects();
server.listen(config.port, config.host, () => {
  console.log(`DevHub Node läuft auf http://${config.publicHost}:${config.port}`);
  console.log(`Lokale Bindung: http://${config.host}:${config.port}`);
  console.log(`Projektwurzel: ${config.scanRoot}`);
});

async function shutdown(): Promise<void> {
  console.log("\nDevHub wird beendet …");
  await processManager.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
