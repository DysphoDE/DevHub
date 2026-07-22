const storedFavorites = JSON.parse(localStorage.getItem("devhub_favorites") || "[]");
const storedRecent = JSON.parse(localStorage.getItem("devhub_recent") || "[]");
const state = {
  token: "",
  root: "",
  projects: [],
  laragon: null,
  capabilities: null,
  filter: "all",
  technology: null,
  query: "",
  sort: localStorage.getItem("devhub_sort") || "smart",
  view: localStorage.getItem("devhub_view") || "grid",
  favorites: new Set(Array.isArray(storedFavorites) ? storedFavorites : []),
  recent: Array.isArray(storedRecent) ? storedRecent : [],
  expandedProjects: new Set(),
  activeProjectId: null,
  runtimeExpanded: localStorage.getItem("devhub_runtime_expanded") === "true",
  gitCommitMessages: new Map(),
  pendingGitAction: null,
  activeGitFiles: new Map(),
  gitDiffs: new Map(),
  gitDiffLoading: null,
  activeLogId: null
};

const elements = {
  grid: document.querySelector("#project-grid"), empty: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"), emptyMessage: document.querySelector("#empty-message"), emptyAction: document.querySelector("#empty-action"),
  rootLabel: document.querySelector("#drive-label"), rootPath: document.querySelector("#workspace-path"), workspaceSettings: document.querySelector("#workspace-settings"),
  workspaceDialog: document.querySelector("#workspace-dialog"), workspaceForm: document.querySelector("#workspace-form"), workspaceInput: document.querySelector("#workspace-input"),
  workspaceBrowse: document.querySelector("#workspace-browse"), workspaceSave: document.querySelector("#workspace-save"),
  resultCount: document.querySelector("#result-count"), projectCount: document.querySelector("#project-count"),
  runningCount: document.querySelector("#running-count"), launcherCount: document.querySelector("#launcher-count"), allCount: document.querySelector("#all-count"),
  favoriteCount: document.querySelector("#favorite-count"), recentCount: document.querySelector("#recent-count"), runningFilterCount: document.querySelector("#running-filter-count"),
  attentionCount: document.querySelector("#attention-count"),
  scanStatus: document.querySelector("#scan-status"), search: document.querySelector("#search"), sort: document.querySelector("#sort"), rescan: document.querySelector("#rescan"),
  techFilters: document.querySelector("#tech-filters"), mobileTech: document.querySelector("#mobile-tech"), clearTech: document.querySelector("#clear-tech"), activeFilter: document.querySelector("#active-filter"),
  laragonState: document.querySelector("#laragon-state"), webState: document.querySelector("#web-state"), databaseState: document.querySelector("#database-state"),
  serviceSummary: document.querySelector("#service-summary"), runtimePorts: document.querySelector("#runtime-ports"), laragonToggle: document.querySelector("#laragon-toggle"), laragonToggleLabel: document.querySelector("#laragon-toggle-label"),
  laragonOpen: document.querySelector("#laragon-open"), laragonOpenLabel: document.querySelector("#laragon-open-label"), laragonReload: document.querySelector("#laragon-reload"),
  serviceDock: document.querySelector("#service-dock"), runtimeDetails: document.querySelector("#runtime-details"), runtimeTopology: document.querySelector("#runtime-topology"),
  projectDialog: document.querySelector("#project-dialog"), projectDialogContent: document.querySelector("#project-dialog-content"),
  logDialog: document.querySelector("#log-dialog"), logTitle: document.querySelector("#log-title"), logCommand: document.querySelector("#log-command"),
  logOutput: document.querySelector("#log-output"), logState: document.querySelector("#log-state"), restartLog: document.querySelector("#restart-log"),
  toastRegion: document.querySelector("#toast-region")
};

const statusLabels = { stopped: "bereit", starting: "startet", running: "läuft", stopping: "stoppt", error: "Fehler" };
const techPresentation = {
  "Laravel": ["L", "tech-laravel"], "WordPress": ["W", "tech-wordpress"], "Symfony": ["S", "tech-symfony"],
  "Next.js": ["N", "tech-next"], "React": ["R", "tech-react"], "Vue": ["V", "tech-vue"], "Svelte": ["S", "tech-svelte"],
  "PHP": ["P", "tech-php"], "HTML": ["H", "tech-html"], "Node.js": ["N", "tech-node"], "Python": ["Py", "tech-python"],
  "WoW Addon": ["W", "tech-addon"], "Docker": ["D", "tech-docker"], "Projektordner": ["·", "tech-folder"]
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function projectIsRunning(project) {
  return project.launchers.some((launcher) => ["starting", "running", "stopping"].includes(launcher.runtime.status));
}

function activeLauncher(project) {
  return project.launchers.find((launcher) => ["starting", "running", "stopping"].includes(launcher.runtime.status));
}

function preferredLauncher(project) {
  return activeLauncher(project) || project.launchers.find((launcher) => launcher.preferred) || project.launchers[0] || null;
}

function runtimePort(launcher) {
  if (!launcher?.runtime?.url) return null;
  try {
    const url = new URL(launcher.runtime.url);
    return `:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  } catch { return null; }
}

function projectAttentionReasons(project) {
  const reasons = [];
  const failed = project.launchers.filter((launcher) => launcher.runtime.status === "error").length;
  const conflicts = project.git ? gitConflictCount(project.git) : 0;
  if (failed) reasons.push({ kind: "error", label: `${failed} Prozess${failed === 1 ? "" : "e"} fehlgeschlagen` });
  if (conflicts) reasons.push({ kind: "conflict", label: `${conflicts} Git-Konflikt${conflicts === 1 ? "" : "e"}` });
  if (project.git?.behind) reasons.push({ kind: "behind", label: `${project.git.behind} Commit${project.git.behind === 1 ? "" : "s"} zurück` });
  if (project.git?.ahead) reasons.push({ kind: "ahead", label: `${project.git.ahead} Push ausstehend` });
  if (project.git?.dirty && !conflicts) {
    const changed = project.git.changedFiles ?? project.git.files?.length ?? 0;
    reasons.push({ kind: "changes", label: `${changed} offene Änderung${changed === 1 ? "" : "en"}` });
  }
  return reasons;
}

function projectState(project) {
  const launcher = activeLauncher(project);
  const attention = projectAttentionReasons(project);
  if (attention[0]?.kind === "error") return { kind: "error", label: "Prozessfehler" };
  if (launcher) return { kind: "running", label: `läuft${runtimePort(launcher) ? ` · ${runtimePort(launcher)}` : ""}` };
  if (attention[0]) return { kind: attention[0].kind, label: attention[0].label };
  if (!project.launchers.length) return { kind: "folder", label: "kein Starter" };
  return { kind: "ready", label: relativeTime(project.modifiedAt).replace(" geändert", "") };
}

function findLauncher(id) {
  for (const project of state.projects) {
    const launcher = project.launchers.find((item) => item.id === id);
    if (launcher) return { project, launcher };
  }
  return null;
}

function relativeTime(isoDate) {
  const delta = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.max(0, Math.floor(delta / 60_000));
  if (minutes < 1) return "gerade geändert";
  if (minutes < 60) return `vor ${minutes} Min. geändert`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std. geändert`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "gestern geändert";
  if (days < 30) return `vor ${days} Tagen`;
  const months = Math.round(days / 30);
  if (months < 12) return `vor ${months} Mon.`;
  return `vor ${Math.round(months / 12)} J.`;
}

function dateTime(isoDate) {
  if (!isoDate) return "unbekannt";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(isoDate));
}

function projectPath(project) {
  const separator = state.root.includes("\\") ? "\\" : "/";
  return `${state.root.replace(/[\\/]+$/, "")}${separator}${project.relativePath.replaceAll("/", separator)}`;
}

function setWorkspaceRoot(root) {
  state.root = root;
  const normalized = root.replace(/[\\/]+$/, "");
  const drive = normalized.match(/^[a-z]:$/i)?.[0];
  const name = drive || normalized.split(/[\\/]/).filter(Boolean).at(-1) || root;
  elements.rootLabel.textContent = name;
  elements.rootPath.textContent = root;
  elements.workspaceSettings.title = `Workspace wechseln · ${root}`;
  elements.workspaceInput.value = root;
}

function techClass(project) {
  return techPresentation[project.technologies[0]] || [project.technologies[0]?.slice(0, 2) || "·", "tech-folder"];
}

function runningBrowserUrl(project) {
  return project.launchers.find((launcher) => launcher.runtime.status === "running" && launcher.runtime.url)?.runtime.url || null;
}

function browserUrl(project) {
  return runningBrowserUrl(project) || (state.laragon?.webServer ? project.defaultUrl : null);
}

function markRecent(projectId) {
  state.recent = [projectId, ...state.recent.filter((id) => id !== projectId)].slice(0, 16);
  localStorage.setItem("devhub_recent", JSON.stringify(state.recent));
}

function getVisibleProjects() {
  const query = state.query.trim().toLocaleLowerCase("de");
  let projects = state.projects.filter((project) => {
    if (state.filter === "favorites" && !state.favorites.has(project.id)) return false;
    if (state.filter === "recent" && !state.recent.includes(project.id)) return false;
    if (state.filter === "running" && !projectIsRunning(project)) return false;
    if (state.filter === "attention" && projectAttentionReasons(project).length === 0) return false;
    if (state.technology && !project.technologies.includes(state.technology)) return false;
    if (!query) return true;
    return [project.name, project.description, project.relativePath, project.git?.branch, ...project.technologies,
      ...project.launchers.flatMap((launcher) => [launcher.name, launcher.command, launcher.relativeCwd])]
      .join(" ").toLocaleLowerCase("de").includes(query);
  });
  const recentIndex = (project) => { const index = state.recent.indexOf(project.id); return index < 0 ? 999 : index; };
  projects.sort((a, b) => {
    if (state.sort === "name") return a.name.localeCompare(b.name, "de");
    if (state.sort === "modified") return new Date(b.modifiedAt) - new Date(a.modifiedAt);
    if (state.sort === "opened") return recentIndex(a) - recentIndex(b) || a.name.localeCompare(b.name, "de");
    return Number(projectIsRunning(b)) - Number(projectIsRunning(a))
      || Number(state.favorites.has(b.id)) - Number(state.favorites.has(a.id))
      || recentIndex(a) - recentIndex(b)
      || new Date(b.modifiedAt) - new Date(a.modifiedAt);
  });
  return projects;
}

function launcherRow(launcher) {
  const runtime = launcher.runtime;
  const busy = ["starting", "stopping"].includes(runtime.status);
  const action = runtime.status === "running" ? "stop" : "start";
  return `<div class="launcher-row" data-launcher="${launcher.id}">
    <div class="launcher-copy"><span class="launcher-name">${escapeHtml(launcher.name)}</span><code class="launcher-command" title="${escapeHtml(launcher.command)}">${escapeHtml(launcher.command)}</code></div>
    <span class="launcher-status ${runtime.status}">${statusLabels[runtime.status] || runtime.status}</span>
    <div class="launcher-tools">
      ${runtime.url && runtime.status === "running" ? `<a class="mini-action" href="${escapeHtml(runtime.url)}" data-open-id="${launcher.projectId}" target="_blank" rel="noopener noreferrer" aria-label="Im Browser öffnen"><span aria-hidden="true">↗</span><span class="mini-label">Browser</span></a>` : ""}
      <button class="mini-action" data-log="${launcher.id}" data-focus-key="log-${launcher.id}" aria-label="Logs anzeigen"><span aria-hidden="true">&gt;_</span><span class="mini-label">Logs</span></button>
      <button class="mini-action ${action === "stop" ? "stop" : ""} ${busy ? "busy" : ""}" data-launcher-action="${action}" data-id="${launcher.id}" data-focus-key="run-${launcher.id}" ${busy ? "disabled" : ""} aria-label="${action === "stop" ? "Stoppen" : "Starten"}"><span aria-hidden="true">${busy ? "…" : action === "stop" ? "■" : "▶"}</span><span class="mini-label">${action === "stop" ? "Stoppen" : "Starten"}</span></button>
    </div>
  </div>`;
}

function primaryAction(project) {
  const url = browserUrl(project);
  if (url) return `<a class="primary-card-action running" href="${escapeHtml(url)}" data-open-id="${project.id}" target="_blank" rel="noopener noreferrer">Browser öffnen <span>↗</span></a>`;
  const launcher = preferredLauncher(project);
  if (launcher) {
    const running = launcher.runtime.status === "running";
    const busy = ["starting", "stopping"].includes(launcher.runtime.status);
    return `<button class="primary-card-action ${running ? "running" : ""}" data-launcher-action="${running ? "stop" : "start"}" data-id="${launcher.id}" data-project-id="${project.id}" ${busy ? "disabled" : ""}>${busy ? "Wird ausgeführt …" : running ? "Stoppen" : `Starten · ${escapeHtml(launcher.name)}`}</button>`;
  }
  return `<button class="primary-card-action folder" data-project-action="folder" data-project-id="${project.id}">Ordner öffnen</button>`;
}

function gitConflictCount(git) {
  const conflictStates = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
  return git.files?.filter((file) => conflictStates.has(`${file.indexStatus}${file.worktreeStatus}`)).length || 0;
}

function favoriteIcon() {
  return '<svg class="favorite-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.62 6.9 19.3l.98-5.68L3.65 9.6l5.8-.83L12 3.6Z"/></svg>';
}

function gitStatusPresentation(git) {
  const conflicts = gitConflictCount(git);
  const changed = git.changedFiles ?? git.files?.length ?? (git.staged + git.unstaged + git.untracked);
  if (conflicts) return { kind: "conflict", label: `${conflicts} Konflikt${conflicts === 1 ? "" : "e"}`, title: "Git-Konflikte müssen vor einem Commit gelöst werden" };
  if (git.dirty) return { kind: "changes", label: `${changed}${git.filesTruncated ? "+" : ""} Änderung${changed === 1 ? "" : "en"}`, title: `${changed} Dateien mit offenen Änderungen` };
  if (git.ahead || git.behind) return { kind: git.behind ? "behind" : "ahead", label: `${git.ahead ? `↑${git.ahead}` : ""}${git.ahead && git.behind ? " · " : ""}${git.behind ? `↓${git.behind}` : ""}`, title: "Abstand zum Upstream" };
  return { kind: "clean", label: "sauber", title: "Keine lokalen Git-Änderungen" };
}

function gitBranchMeta(git) {
  const status = gitStatusPresentation(git);
  return `<span class="meta-item git-meta ${status.kind}" title="${escapeHtml(status.title)}">
    <svg class="git-branch-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="4" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="20" r="2"/><path d="M6 6v12M18 9c0 4-3.5 5-12 5"/></svg>
    <code>${escapeHtml(git.branch || "detached")}</code><span class="git-inline-status"><i></i>${escapeHtml(status.label)}</span>
  </span>`;
}

function projectCard(project) {
  const running = projectIsRunning(project);
  const status = projectState(project);
  const [symbol, className] = techClass(project);
  const expanded = state.expandedProjects.has(project.id);
  const focusedLauncher = preferredLauncher(project);
  const visibleLaunchers = expanded ? project.launchers : focusedLauncher ? [focusedLauncher] : [];
  const favorite = state.favorites.has(project.id);
  const editorName = state.capabilities?.editor.name || "Editor";
  return `<article class="project-card ${className} ${running ? "running" : ""}" data-project="${project.id}" tabindex="0" aria-label="Details zu ${escapeHtml(project.name)} öffnen">
    <div class="card-accent"></div>
    <div class="card-body">
      <div class="card-kicker">
        ${project.thumbnailUrl ? `<img class="card-thumb" src="${escapeHtml(project.thumbnailUrl)}" alt="">` : `<span class="stack-symbol">${escapeHtml(symbol)}</span>`}
        <span class="card-state ${status.kind}"><i></i>${escapeHtml(status.label)}</span>
        <button class="favorite-button ${favorite ? "active" : ""}" data-favorite="${project.id}" data-focus-key="fav-${project.id}" aria-label="${favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}" aria-pressed="${favorite}">${favoriteIcon()}</button>
      </div>
      <h2 title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</h2>
      <code class="project-path" title="${escapeHtml(project.relativePath)}">${escapeHtml(project.relativePath)}</code>
      <p class="project-description">${escapeHtml(project.description)}</p>
      <div class="tech-list">${project.technologies.slice(0, 5).map((technology) => `<span class="tech-chip">${escapeHtml(technology)}</span>`).join("")}</div>
      <div class="card-meta">
        ${project.git ? gitBranchMeta(project.git) : `<span class="meta-item">${project.fileCount} Dateien</span>`}
        <span class="meta-time">${relativeTime(project.modifiedAt)}</span>
      </div>
    </div>
    ${project.launchers.length ? `<div class="launcher-panel focused-launcher-panel"><div class="launcher-panel-label"><span>${expanded ? "Alle Starter" : "Bevorzugter Starter"}</span><b>${project.launchers.length}</b></div>${visibleLaunchers.map(launcherRow).join("")}${project.launchers.length > 1 ? `<button class="more-launchers" data-expand="${project.id}">${expanded ? "Auf bevorzugten Starter reduzieren" : `${project.launchers.length - 1} weitere Starter anzeigen`}</button>` : ""}</div>` : ""}
    <div class="card-actions">
      ${primaryAction(project)}
      <button class="card-icon-action" data-project-action="editor" data-project-id="${project.id}" aria-label="In ${escapeHtml(editorName)} öffnen" ${state.capabilities?.editor.available ? "" : "disabled"}><span aria-hidden="true">IDE</span><b>Editor</b></button>
      <button class="card-icon-action" data-project-action="terminal" data-project-id="${project.id}" aria-label="Terminal hier öffnen" ${state.capabilities?.terminal.available ? "" : "disabled"}><span aria-hidden="true">&gt;_</span><b>Terminal</b></button>
      <button class="card-icon-action" data-project-action="folder" data-project-id="${project.id}" aria-label="Ordner öffnen"><span aria-hidden="true">▱</span><b>Ordner</b></button>
      <button class="card-icon-action" data-copy-path="${project.id}" aria-label="Pfad kopieren"><span aria-hidden="true">⧉</span><b>Pfad</b></button>
    </div>
  </article>`;
}

function projectListItem(project) {
  const running = projectIsRunning(project);
  const status = projectState(project);
  const [symbol, className] = techClass(project);
  const expanded = state.expandedProjects.has(project.id);
  const focusedLauncher = preferredLauncher(project);
  const visibleLaunchers = expanded ? project.launchers : focusedLauncher ? [focusedLauncher] : [];
  const hiddenLauncherCount = Math.max(0, project.launchers.length - visibleLaunchers.length);
  const favorite = state.favorites.has(project.id);
  const editorName = state.capabilities?.editor.name || "Editor";
  const visibleTechnologies = project.technologies.slice(0, 3);
  const extraTechnologies = Math.max(0, project.technologies.length - visibleTechnologies.length);
  const projectMeta = project.git
    ? gitBranchMeta(project.git)
    : `<span class="meta-item">${project.fileCount} Dateien</span>`;

  return `<article class="project-card project-list-row ${className} ${running ? "running" : ""}" data-project="${project.id}" tabindex="0" aria-label="Details zu ${escapeHtml(project.name)} öffnen">
    <div class="card-accent"></div>
    <section class="list-identity">
      ${project.thumbnailUrl ? `<img class="card-thumb list-project-symbol" src="${escapeHtml(project.thumbnailUrl)}" alt="">` : `<span class="stack-symbol list-project-symbol">${escapeHtml(symbol)}</span>`}
      <div class="list-project-copy">
        <div class="list-title-row">
          <h2 title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</h2>
          <span class="card-state ${status.kind}"><i></i>${escapeHtml(status.label)}</span>
        </div>
        <code class="project-path" title="${escapeHtml(project.relativePath)}">${escapeHtml(project.relativePath)}</code>
        <p class="project-description" title="${escapeHtml(project.description)}">${escapeHtml(project.description)}</p>
        <div class="list-detail-row">
          <div class="tech-list">${visibleTechnologies.map((technology) => `<span class="tech-chip">${escapeHtml(technology)}</span>`).join("")}${extraTechnologies ? `<span class="tech-chip tech-more">+${extraTechnologies}</span>` : ""}</div>
          <div class="list-project-meta">${projectMeta}<span class="meta-time">${relativeTime(project.modifiedAt)}</span></div>
        </div>
      </div>
      <button class="favorite-button ${favorite ? "active" : ""}" data-favorite="${project.id}" data-focus-key="fav-${project.id}" aria-label="${favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}" aria-pressed="${favorite}">${favoriteIcon()}</button>
    </section>
    <section class="launcher-panel list-launchers" aria-label="Starter für ${escapeHtml(project.name)}">
      <div class="list-launcher-head">
        <span>${expanded ? "Alle Starter" : "Bevorzugter Starter"}</span><b>${project.launchers.length}</b>
        ${project.launchers.length > 1 ? `<button class="list-launcher-toggle" data-expand="${project.id}">${expanded ? "Reduzieren" : `+${hiddenLauncherCount} weitere`}</button>` : ""}
      </div>
      ${visibleLaunchers.length ? visibleLaunchers.map(launcherRow).join("") : '<p class="list-no-launcher">Kein automatischer Starter erkannt</p>'}
    </section>
    <div class="card-actions list-actions">
      ${primaryAction(project)}
      <div class="list-utility-actions" aria-label="Projektaktionen">
        <button class="card-icon-action" data-project-action="editor" data-project-id="${project.id}" aria-label="In ${escapeHtml(editorName)} öffnen" ${state.capabilities?.editor.available ? "" : "disabled"}><span aria-hidden="true">IDE</span><b>Editor</b></button>
        <button class="card-icon-action" data-project-action="terminal" data-project-id="${project.id}" aria-label="Terminal hier öffnen" ${state.capabilities?.terminal.available ? "" : "disabled"}><span aria-hidden="true">&gt;_</span><b>Terminal</b></button>
        <button class="card-icon-action" data-project-action="folder" data-project-id="${project.id}" aria-label="Ordner öffnen"><span aria-hidden="true">▱</span><b>Ordner</b></button>
        <button class="card-icon-action" data-copy-path="${project.id}" aria-label="Pfad kopieren"><span aria-hidden="true">⧉</span><b>Pfad</b></button>
      </div>
    </div>
  </article>`;
}

function gitStatusLabel(code) {
  return ({ M: "Geändert", A: "Neu", D: "Gelöscht", R: "Umbenannt", C: "Kopiert", U: "Konflikt", T: "Typ geändert", "?": "Unversioniert" })[code] || "Geändert";
}

function activeGitFile(project) {
  const selected = state.activeGitFiles.get(project.id);
  if (project.git?.files.some((file) => file.path === selected)) return selected;
  const first = project.git?.files[0]?.path || null;
  if (first) state.activeGitFiles.set(project.id, first);
  else state.activeGitFiles.delete(project.id);
  return first;
}

function diffKey(projectId, file) {
  return `${projectId}\u0000${file}`;
}

function renderPatch(patch) {
  if (!patch) return '<div class="diff-empty">Für diese Änderung hat Git keinen Text-Patch erzeugt.</div>';
  const sourceLines = patch.replace(/\r\n/g, "\n").split("\n");
  const limited = sourceLines.slice(0, 2500);
  let oldLine = null;
  let newLine = null;
  const html = limited.map((line) => {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return `<div class="diff-line hunk"><span></span><span></span><code>${escapeHtml(line)}</code></div>`;
    }
    let type = "meta";
    let oldNumber = "";
    let newNumber = "";
    if (line.startsWith("+") && !line.startsWith("+++")) {
      type = "addition"; newNumber = newLine ?? ""; if (newLine !== null) newLine += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      type = "deletion"; oldNumber = oldLine ?? ""; if (oldLine !== null) oldLine += 1;
    } else if (line.startsWith(" ")) {
      type = "context"; oldNumber = oldLine ?? ""; newNumber = newLine ?? ""; if (oldLine !== null) oldLine += 1; if (newLine !== null) newLine += 1;
    }
    return `<div class="diff-line ${type}"><span>${oldNumber}</span><span>${newNumber}</span><code>${escapeHtml(line || " ")}</code></div>`;
  }).join("");
  return html + (sourceLines.length > limited.length ? '<div class="diff-limit-note">Darstellung nach 2.500 Zeilen gekürzt.</div>' : "");
}

function gitDiffViewer(project) {
  const file = activeGitFile(project);
  if (!file) return `<section class="git-diff-panel empty"><span>✓</span><strong>Arbeitsbaum sauber</strong><small>Wähle nach der nächsten Änderung hier eine Datei aus.</small></section>`;
  const key = diffKey(project.id, file);
  if (state.gitDiffLoading === key) return `<section class="git-diff-panel"><div class="git-diff-head"><strong>${escapeHtml(file)}</strong></div><div class="diff-loading"><i></i>Diff wird geladen …</div></section>`;
  const data = state.gitDiffs.get(key);
  if (data?.error) return `<section class="git-diff-panel"><div class="git-diff-head"><strong>${escapeHtml(file)}</strong><button data-reload-diff data-project-id="${project.id}" data-file="${escapeHtml(file)}">Erneut laden</button></div><div class="diff-error">${escapeHtml(data.error)}</div></section>`;
  if (!data) return `<section class="git-diff-panel"><div class="git-diff-head"><strong>${escapeHtml(file)}</strong></div><div class="diff-loading">Datei auswählen, um den Diff zu laden.</div></section>`;
  let additions = 0;
  let deletions = 0;
  data.sections.forEach((section) => section.patch.split(/\r?\n/).forEach((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }));
  return `<section class="git-diff-panel">
    <div class="git-diff-head"><strong title="${escapeHtml(file)}">${escapeHtml(file)}</strong><div><span class="diff-additions">+${additions}</span><span class="diff-deletions">−${deletions}</span><button data-reload-diff data-project-id="${project.id}" data-file="${escapeHtml(file)}" title="Diff neu laden">↻</button></div></div>
    <div class="git-diff-scroll">
      ${data.sections.map((section) => `<section class="diff-section ${section.scope}"><header><i></i>${escapeHtml(section.label)}</header><div class="diff-code">${renderPatch(section.patch)}</div>${section.truncated ? '<div class="diff-limit-note">Sehr großer Diff wurde gekürzt.</div>' : ""}</section>`).join("") || '<div class="diff-empty">Keine darstellbaren Textänderungen.</div>'}
    </div>
  </section>`;
}

async function loadGitDiff(projectId, file, force = false) {
  const key = diffKey(projectId, file);
  state.activeGitFiles.set(projectId, file);
  if (!force && state.gitDiffs.has(key)) { renderProjectDialog(); return; }
  state.gitDiffLoading = key;
  renderProjectDialog();
  try {
    const data = await api(`/api/projects/${projectId}/git/diff?file=${encodeURIComponent(file)}`);
    state.gitDiffs.set(key, data);
  } catch (error) {
    state.gitDiffs.set(key, { error: error.message });
  } finally {
    if (state.gitDiffLoading === key) state.gitDiffLoading = null;
    if (state.activeProjectId === projectId && elements.projectDialog.open) renderProjectDialog();
  }
}

function gitFileRow(project, file) {
  const staged = file.indexStatus !== "." && file.indexStatus !== "?";
  const working = file.worktreeStatus !== ".";
  const primaryStatus = staged ? file.indexStatus : file.worktreeStatus;
  const slash = file.path.lastIndexOf("/");
  const directory = slash >= 0 ? file.path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;
  const pending = state.pendingGitAction?.startsWith(`${project.id}:`);
  return `<div class="git-file-row ${activeGitFile(project) === file.path ? "active" : ""}" data-git-file="${escapeHtml(file.path)}" data-project-id="${project.id}" tabindex="0">
    <span class="git-file-status status-${escapeHtml(primaryStatus)}" title="${escapeHtml(gitStatusLabel(primaryStatus))}">${escapeHtml(primaryStatus)}</span>
    <div class="git-file-path" title="${escapeHtml(file.path)}"><span>${escapeHtml(directory)}</span><strong>${escapeHtml(name)}</strong>${file.originalPath ? `<small>von ${escapeHtml(file.originalPath)}</small>` : ""}</div>
    <div class="git-file-flags">
      ${staged ? '<span class="file-flag staged">vorgemerkt</span>' : ""}
      ${working && file.worktreeStatus !== "?" ? '<span class="file-flag working">lokal</span>' : ""}
      ${file.worktreeStatus === "?" ? '<span class="file-flag untracked">neu</span>' : ""}
    </div>
    <button class="git-file-action ${staged ? "unstage" : "stage"}" data-git-action="${staged ? "unstage" : "stage"}" data-project-id="${project.id}" data-file="${escapeHtml(file.path)}" ${pending ? "disabled" : ""}>${staged ? "Entfernen" : "Vormerken"}</button>
  </div>`;
}

function gitDetail(project) {
  const git = project.git;
  if (!git) return `<section class="detail-panel git-detail empty-git">
    <div class="detail-section-head"><div><p class="eyebrow">Versionskontrolle</p><h3>Kein Git-Repository</h3></div></div>
    <p>In diesem Projektordner wurde kein Repository erkannt. Du kannst direkt ein Terminal öffnen, um eines anzulegen.</p>
    <button class="detail-secondary-action" data-project-action="terminal" data-project-id="${project.id}" ${state.capabilities?.terminal.available ? "" : "disabled"}>&gt;_ Terminal öffnen</button>
  </section>`;
  const changes = git.changedFiles ?? git.files.length;
  const branch = git.branch || "detached HEAD";
  const repoHint = git.repositoryRoot === "." ? "im Projektstamm" : `in ${git.repositoryRoot}`;
  const pending = state.pendingGitAction?.startsWith(`${project.id}:`);
  const draft = state.gitCommitMessages.get(project.id) || "";
  const canPush = Boolean(git.remoteName && git.branch && (!git.upstream || git.ahead > 0));
  return `<section class="detail-panel git-detail">
    <div class="detail-section-head">
      <div><p class="eyebrow">Git · ${escapeHtml(repoHint)}</p><h3>${escapeHtml(branch)}</h3></div>
      <span class="git-health ${git.dirty ? "dirty" : "clean"}"><i></i>${git.dirty ? `${changes} Änderung${changes === 1 ? "" : "en"}` : "Arbeitsbaum sauber"}</span>
    </div>
    <div class="git-track" aria-label="Git-Status">
      <div class="git-branch-line"><span class="git-node"></span><code>${escapeHtml(branch)}</code></div>
      <div class="git-sync">
        <span title="Lokale Commits vor dem Upstream">↑ ${git.ahead}</span>
        <span title="Commits hinter dem Upstream">↓ ${git.behind}</span>
        <small>${escapeHtml(git.remoteName || "kein Upstream")}</small>
      </div>
    </div>
    <div class="git-change-grid">
      <div><strong>${git.staged}</strong><span>vorgemerkt</span></div>
      <div><strong>${git.unstaged}</strong><span>nicht vorgemerkt</span></div>
      <div><strong>${git.untracked}</strong><span>unversioniert</span></div>
    </div>
    <div class="git-workbench">
      <div class="git-files-panel">
        <div class="git-files-head">
          <div><strong>Geänderte Dateien</strong><span>${changes}${git.filesTruncated ? "+" : ""} im Arbeitsbaum</span></div>
          <div>
            <button data-git-action="refresh" data-project-id="${project.id}" ${pending ? "disabled" : ""} title="Git-Status aktualisieren">↻</button>
            <button data-git-action="${git.staged ? "unstage-all" : "stage-all"}" data-project-id="${project.id}" ${pending || !changes ? "disabled" : ""}>${git.staged ? "Vormerkungen lösen" : "Alle vormerken"}</button>
          </div>
        </div>
        <div class="git-file-list">
          ${git.files.length ? git.files.map((file) => gitFileRow(project, file)).join("") : '<div class="git-file-empty"><span>✓</span><strong>Keine lokalen Änderungen</strong><small>Der Arbeitsbaum entspricht dem letzten Commit.</small></div>'}
          ${git.filesTruncated ? '<p class="git-files-truncated">Weitere Dateien werden aus Performancegründen nicht einzeln angezeigt. „Alle vormerken“ erfasst sie trotzdem.</p>' : ""}
        </div>
      </div>
      ${gitDiffViewer(project)}
      <aside class="git-commit-panel">
        <div>
          <p class="eyebrow">Letzter Commit</p>
          ${git.lastCommit ? `<div class="last-commit">
            <span class="commit-hash">${escapeHtml(git.lastCommit.hash)}</span>
            <div><strong>${escapeHtml(git.lastCommit.subject)}</strong><small>${escapeHtml(git.lastCommit.author)} · ${dateTime(git.lastCommit.date)}</small></div>
          </div>` : '<p class="git-empty-note">Noch kein Commit vorhanden.</p>'}
        </div>
        <div class="commit-composer">
          <label for="git-commit-message">Commit-Nachricht <span>${git.staged} vorgemerkt</span></label>
          <input id="git-commit-message" data-commit-message="${project.id}" value="${escapeHtml(draft)}" maxlength="200" placeholder="Was wurde geändert?" autocomplete="off">
          <button class="git-commit-button" data-git-action="commit" data-project-id="${project.id}" ${pending || !git.staged || draft.trim().length < 3 ? "disabled" : ""}>${state.pendingGitAction === `${project.id}:commit` ? "Commit läuft …" : "Commit erstellen"}</button>
          <small>Der Commit enthält nur vorgemerkte Dateien.</small>
        </div>
        <div class="push-panel">
          <div><strong>${git.upstream ? escapeHtml(git.upstream) : "Branch veröffentlichen"}</strong><span>${git.upstream ? `${git.ahead} voraus · ${git.behind} zurück` : `auf ${escapeHtml(git.remoteName || "Remote")}`}</span></div>
          <button data-git-action="push" data-project-id="${project.id}" ${pending || !canPush ? "disabled" : ""}>${state.pendingGitAction === `${project.id}:push` ? "Push läuft …" : git.upstream ? `Push · ↑${git.ahead}` : "Push & Upstream"}</button>
        </div>
        <div class="detail-inline-actions">
          ${git.remoteUrl ? `<a class="detail-secondary-action" href="${escapeHtml(git.remoteUrl)}" target="_blank" rel="noopener noreferrer">Remote öffnen ↗</a>` : ""}
          <button class="detail-secondary-action" data-copy-value="${escapeHtml(branch)}" data-copy-label="Branch kopiert.">Branch kopieren</button>
          <button class="detail-secondary-action" data-project-action="terminal" data-project-id="${project.id}" ${state.capabilities?.terminal.available ? "" : "disabled"}>&gt;_ Terminal</button>
        </div>
      </aside>
    </div>
  </section>`;
}

function gitOverview(project) {
  return `<section class="detail-panel git-overview empty-git-overview"><div><p class="eyebrow">Versionskontrolle</p><h3>Kein Git-Repository</h3></div><p>Für dieses Projekt wurde kein Repository erkannt.</p></section>`;
}

function renderProjectDialog() {
  const project = state.projects.find((item) => item.id === state.activeProjectId);
  if (!project) {
    if (elements.projectDialog.open) elements.projectDialog.close();
    return;
  }
  const running = projectIsRunning(project);
  const [symbol, className] = techClass(project);
  const favorite = state.favorites.has(project.id);
  const editorName = state.capabilities?.editor.name || "Editor";
  const workbench = Boolean(project.git);
  elements.projectDialog.classList.toggle("workbench", workbench);
  elements.projectDialogContent.innerHTML = `<article class="project-detail ${className} ${running ? "running" : ""}">
    <header class="project-detail-head">
      <div class="detail-accent"></div>
      <div class="detail-title-row">
        ${project.thumbnailUrl ? `<img class="detail-symbol" src="${escapeHtml(project.thumbnailUrl)}" alt="">` : `<span class="stack-symbol detail-symbol">${escapeHtml(symbol)}</span>`}
        <div class="detail-title-copy"><p class="eyebrow">Projektakte</p><h2 id="project-dialog-title">${escapeHtml(project.name)}</h2><code>${escapeHtml(projectPath(project))}</code></div>
        <button class="favorite-button detail-favorite ${favorite ? "active" : ""}" data-favorite="${project.id}" aria-label="${favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}" aria-pressed="${favorite}">${favoriteIcon()}</button>
        <button class="project-dialog-close" data-close-project aria-label="Projektdetails schließen">×</button>
      </div>
      <p class="detail-description">${escapeHtml(project.description)}</p>
      <div class="detail-tech-list">${project.technologies.map((technology) => `<span class="tech-chip">${escapeHtml(technology)}</span>`).join("")}</div>
      <div class="detail-primary-actions">
        ${primaryAction(project)}
        <button class="detail-action-button" data-project-action="editor" data-project-id="${project.id}" ${state.capabilities?.editor.available ? "" : "disabled"}>IDE <span>${escapeHtml(editorName)}</span></button>
        <button class="detail-action-button" data-project-action="terminal" data-project-id="${project.id}" ${state.capabilities?.terminal.available ? "" : "disabled"}>&gt;_ <span>Terminal</span></button>
        <button class="detail-action-button" data-project-action="folder" data-project-id="${project.id}">▱ <span>Ordner</span></button>
        <button class="detail-action-button" data-copy-path="${project.id}">⧉ <span>Pfad</span></button>
      </div>
    </header>
    <div class="project-detail-body combined-body">
      <section class="detail-facts" aria-label="Projektübersicht">
        <div><strong>${project.fileCount.toLocaleString("de-DE")}</strong><span>Dateien erkannt</span></div>
        <div><strong>${project.launchers.length}</strong><span>Starter</span></div>
        <div><strong>${running ? "Aktiv" : "Bereit"}</strong><span>Laufzeitstatus</span></div>
        <div><strong>${dateTime(project.modifiedAt)}</strong><span>Zuletzt geändert</span></div>
      </section>
      ${project.git ? gitDetail(project) : gitOverview(project)}
      <section class="detail-panel launcher-detail">
        <div class="detail-section-head"><div><p class="eyebrow">Ausführung</p><h3>Starter</h3></div><span class="detail-count">${project.launchers.length}</span></div>
        ${project.launchers.length ? `<div class="detail-launcher-list">${project.launchers.map(launcherRow).join("")}</div>` : '<p class="detail-empty-note">Kein automatischer Starter erkannt. Ordner, IDE und Terminal stehen trotzdem bereit.</p>'}
      </section>
    </div>
  </article>`;
}

function openProjectDetails(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  state.activeProjectId = projectId;
  markRecent(projectId);
  const file = activeGitFile(project);
  renderProjectDialog();
  if (!elements.projectDialog.open) elements.projectDialog.showModal();
  if (file) loadGitDiff(projectId, file);
  renderStats();
}

function renderRuntimeTopology() {
  const routes = [];
  if (state.laragon?.webServer) {
    routes.push(`<div class="topology-route system-route"><span class="topology-source"><i></i>${escapeHtml(state.laragon.webServer)}</span><span class="topology-line"></span><strong>${state.laragon.virtualHosts} lokale Domains</strong><code>:80</code></div>`);
  }
  state.projects.forEach((project) => project.launchers
    .filter((launcher) => launcher.runtime.status === "running")
    .forEach((launcher) => {
      const source = launcher.kind === "php-server" ? "PHP" : launcher.kind === "static-server" ? "Static" : project.technologies.includes("Python") ? "Python" : "Node";
      const endpoint = runtimePort(launcher) || "live";
      routes.push(`<div class="topology-route"><span class="topology-source"><i></i>${source}</span><span class="topology-line"></span><button data-open-details="${project.id}">${escapeHtml(project.name)}</button>${launcher.runtime.url ? `<a href="${escapeHtml(launcher.runtime.url)}" data-open-id="${project.id}" target="_blank" rel="noopener noreferrer">${escapeHtml(endpoint)} ↗</a>` : `<code>${escapeHtml(endpoint)}</code>`}</div>`);
    }));
  elements.runtimeTopology.innerHTML = routes.length
    ? `<div class="topology-head"><span>Lokaler Dienst</span><span>Route</span><span>Ziel</span></div>${routes.slice(0, 9).join("")}${routes.length > 9 ? `<p class="topology-more">${routes.length - 9} weitere aktive Routen</p>` : ""}`
    : '<p class="topology-empty">Noch keine aktive Route. Starte ein Projekt, dann erscheint hier seine Verbindung zum lokalen Dienst und Port.</p>';
}

function renderStats() {
  const launchers = state.projects.flatMap((project) => project.launchers);
  const running = launchers.filter((launcher) => launcher.runtime.status === "running").length;
  elements.runningCount.textContent = running;
  elements.projectCount.textContent = state.projects.length;
  elements.launcherCount.textContent = launchers.length;
  elements.allCount.textContent = state.projects.length;
  elements.favoriteCount.textContent = state.projects.filter((project) => state.favorites.has(project.id)).length;
  elements.recentCount.textContent = state.projects.filter((project) => state.recent.includes(project.id)).length;
  elements.runningFilterCount.textContent = state.projects.filter(projectIsRunning).length;
  elements.attentionCount.textContent = state.projects.filter((project) => projectAttentionReasons(project).length > 0).length;
}

function renderTechFilters() {
  const counts = new Map();
  state.projects.forEach((project) => project.technologies.forEach((technology) => counts.set(technology, (counts.get(technology) || 0) + 1)));
  elements.techFilters.innerHTML = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).slice(0, 12)
    .map(([technology, count]) => `<button class="tech-filter ${state.technology === technology ? "active" : ""}" data-tech="${escapeHtml(technology)}" aria-pressed="${state.technology === technology}">${escapeHtml(technology)} · ${count}</button>`).join("");
  elements.mobileTech.innerHTML = '<option value="">Technologie</option>' + [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))
    .map(([technology, count]) => `<option value="${escapeHtml(technology)}">${escapeHtml(technology)} · ${count}</option>`).join("");
  elements.mobileTech.value = state.technology || "";
  elements.clearTech.hidden = !state.technology;
}

function renderServiceDock() {
  const laragon = state.laragon;
  if (!laragon) return;
  const runtimeErrors = state.projects.flatMap((project) => project.launchers).filter((launcher) => launcher.runtime.status === "error").length;
  if (runtimeErrors) state.runtimeExpanded = true;
  const nodes = { laragon: laragon.appRunning, web: Boolean(laragon.webServer), database: Boolean(laragon.database) };
  Object.entries(nodes).forEach(([service, online]) => document.querySelector(`[data-service="${service}"]`)?.classList.toggle("online", online));
  elements.laragonState.textContent = !laragon.installed ? "fehlt" : laragon.appRunning ? "geöffnet" : "bereit";
  elements.webState.textContent = laragon.webServer || "offline";
  elements.databaseState.textContent = laragon.database || "offline";
  elements.serviceSummary.textContent = laragon.webServer
    ? `${laragon.webServer} versorgt ${laragon.virtualHosts} lokale Domains`
    : laragon.appRunning ? "Laragon ist offen · Dienste warten auf Start" : "Laragon ist bereit, aber noch geschlossen";
  elements.laragonOpenLabel.textContent = laragon.appRunning ? "Zu Laragon" : "Laragon öffnen";
  elements.laragonOpen.disabled = !laragon.installed;
  elements.laragonReload.disabled = !laragon.installed;
  const webRunning = webOnline();
  elements.laragonToggle.disabled = !laragon.installed;
  elements.laragonToggleLabel.textContent = webRunning ? "Apache stoppen" : "Apache starten";
  elements.laragonToggle.classList.toggle("secondary", webRunning);
  const runningUrls = state.projects.flatMap((project) => project.launchers)
    .filter((launcher) => launcher.runtime.status === "running" && launcher.runtime.url)
    .map((launcher) => launcher.runtime.url);
  elements.runtimePorts.innerHTML = [...new Set(runningUrls)].slice(0, 4).map((url) => {
    let label = "live";
    try { label = `:${new URL(url).port || (url.startsWith("https:") ? "443" : "80")}`; } catch { /* keep label */ }
    return `<a class="port-chip" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }).join("");
  elements.serviceDock.classList.toggle("expanded", state.runtimeExpanded);
  elements.serviceDock.classList.toggle("has-issues", runtimeErrors > 0);
  elements.runtimeDetails.setAttribute("aria-expanded", String(state.runtimeExpanded));
  elements.runtimeDetails.querySelector("span").textContent = runtimeErrors ? `${runtimeErrors} Problem${runtimeErrors === 1 ? "" : "e"}` : "Topologie";
  elements.runtimeTopology.hidden = !state.runtimeExpanded;
  renderRuntimeTopology();
}

function render(preserveFocus = true) {
  const focusKey = preserveFocus ? document.activeElement?.dataset?.focusKey : null;
  const projects = getVisibleProjects();
  elements.resultCount.textContent = projects.length;
  elements.grid.classList.toggle("list-view", state.view === "list");
  elements.grid.innerHTML = projects.map(state.view === "list" ? projectListItem : projectCard).join("");
  elements.grid.hidden = projects.length === 0;
  elements.empty.hidden = projects.length !== 0;
  const noWorkspaceProjects = state.projects.length === 0;
  elements.emptyTitle.textContent = noWorkspaceProjects ? "Keine Projektordner erkannt" : "Keine passenden Projekte";
  elements.emptyMessage.textContent = noWorkspaceProjects ? "Wähle den Ordner aus, der deine Projektordner enthält, oder prüfe die Leserechte." : "Ändere Suche, Ansicht oder Technologie-Filter.";
  elements.emptyAction.textContent = noWorkspaceProjects ? "Workspace auswählen" : "Filter zurücksetzen";
  elements.activeFilter.hidden = !state.technology;
  if (state.technology) elements.activeFilter.innerHTML = `${escapeHtml(state.technology)} <button aria-label="Technologie-Filter entfernen">×</button>`;
  renderStats();
  renderTechFilters();
  renderServiceDock();
  document.querySelectorAll("[data-view]").forEach((button) => { button.classList.toggle("active", button.dataset.view === state.view); button.setAttribute("aria-pressed", String(button.dataset.view === state.view)); });
  document.querySelectorAll("[data-mobile-filter]").forEach((button) => { const active = button.dataset.mobileFilter === state.filter; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
  if (elements.projectDialog.open && state.activeProjectId) renderProjectDialog();
  if (focusKey) document.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  if (type === "error") node.setAttribute("role", "alert");
  elements.toastRegion.append(node);
  setTimeout(() => node.remove(), type === "error" ? 6500 : 3800);
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.method && options.method !== "GET" ? { "X-DevHub-Token": state.token } : {}), ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function bootstrap() {
  try {
    const data = await api("/api/bootstrap");
    Object.assign(state, { token: data.token, projects: data.projects, laragon: data.laragon, capabilities: data.capabilities });
    setWorkspaceRoot(data.root);
    elements.workspaceBrowse.hidden = !data.capabilities.folderPicker;
    elements.sort.value = state.sort;
    render(false);
    setTimeout(connectEvents, 1000);
    setInterval(refreshLaragon, 8000);
  } catch (error) {
    elements.scanStatus.textContent = "Verbindung fehlgeschlagen";
    toast(error.message, "error");
  }
}

async function rescan() {
  elements.rescan.classList.add("loading"); elements.rescan.disabled = true; elements.rescan.setAttribute("aria-busy", "true");
  elements.scanStatus.textContent = `${state.root} wird analysiert …`;
  try {
    const data = await api("/api/rescan", { method: "POST" });
    state.projects = data.projects;
    render(false);
    elements.scanStatus.textContent = `${state.projects.length} Projekte · gerade aktualisiert`;
    toast(`${state.projects.length} Projekte neu eingelesen.`);
  } catch (error) { elements.scanStatus.textContent = "Einlesen fehlgeschlagen"; toast(error.message, "error"); }
  finally { elements.rescan.classList.remove("loading"); elements.rescan.disabled = false; elements.rescan.removeAttribute("aria-busy"); }
}

function openWorkspaceSettings() {
  elements.workspaceInput.value = state.root;
  elements.workspaceDialog.showModal();
  setTimeout(() => { elements.workspaceInput.focus(); elements.workspaceInput.select(); }, 0);
}

async function pickWorkspace() {
  elements.workspaceBrowse.disabled = true;
  elements.workspaceBrowse.textContent = "Auswahl läuft …";
  try {
    const data = await api("/api/settings/workspace/pick", { method: "POST" });
    if (data.root) elements.workspaceInput.value = data.root;
  } catch (error) {
    toast(error.message, "error");
  } finally {
    elements.workspaceBrowse.disabled = false;
    elements.workspaceBrowse.textContent = "Ordner wählen";
  }
}

async function saveWorkspace(event) {
  event.preventDefault();
  const root = elements.workspaceInput.value.trim();
  if (!root || root === state.root) {
    elements.workspaceDialog.close();
    return;
  }
  elements.workspaceSave.disabled = true;
  elements.workspaceSave.textContent = "Workspace wird eingelesen …";
  try {
    const data = await api("/api/settings/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root })
    });
    setWorkspaceRoot(data.root);
    state.projects = data.projects;
    elements.workspaceDialog.close();
    render(false);
    elements.scanStatus.textContent = `${state.projects.length} Projekte · Workspace aktualisiert`;
    toast(`Workspace gewechselt: ${data.root}`);
  } catch (error) {
    toast(error.message, "error");
    elements.workspaceInput.focus();
  } finally {
    elements.workspaceSave.disabled = false;
    elements.workspaceSave.textContent = "Speichern & einlesen";
  }
}

async function refreshLaragon() {
  try { state.laragon = (await api("/api/laragon/status")).laragon; renderServiceDock(); } catch { /* next poll retries */ }
}

function webOnline() {
  return Boolean(state.laragon?.webServer);
}

async function laragonAction(action) {
  const pending = action === "start" || action === "stop";
  if (pending) elements.laragonToggle.disabled = true;
  try {
    const data = await api(`/api/laragon/${action}`, { method: "POST" });
    state.laragon = data.laragon;
    renderServiceDock();
    toast(data.message);
    if (action === "reload") setTimeout(rescan, 1100);
    if (pending) setTimeout(refreshLaragon, 2500);
  } catch (error) { toast(error.message, "error"); }
  finally { if (pending) elements.laragonToggle.disabled = false; }
}

async function runProjectAction(projectId, action) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  try {
    const data = await api(`/api/projects/${projectId}/${action}`, { method: "POST" });
    markRecent(projectId); renderStats(); toast(data.message);
  } catch (error) { toast(error.message, "error"); }
}

async function runGitProjectAction(projectId, action, payload = {}) {
  const projectIndex = state.projects.findIndex((item) => item.id === projectId);
  if (projectIndex < 0 || state.pendingGitAction) return;
  state.pendingGitAction = `${projectId}:${action}`;
  renderProjectDialog();
  try {
    const data = await api(`/api/projects/${projectId}/git/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    state.projects[projectIndex] = data.project;
    if (action === "commit") state.gitCommitMessages.delete(projectId);
    for (const key of state.gitDiffs.keys()) if (key.startsWith(`${projectId}\u0000`)) state.gitDiffs.delete(key);
    toast(data.message);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    state.pendingGitAction = null;
    render(false);
    const current = state.projects.find((item) => item.id === projectId);
    const file = current ? activeGitFile(current) : null;
    if (file && elements.projectDialog.open) loadGitDiff(projectId, file, true);
  }
}

async function runLauncher(id, action) {
  const found = findLauncher(id);
  if (!found) return;
  const oldStatus = found.launcher.runtime.status;
  found.launcher.runtime.status = action === "stop" ? "stopping" : "starting";
  markRecent(found.project.id); render();
  try {
    const data = await api(`/api/launchers/${id}/${action}`, { method: "POST" });
    found.launcher.runtime = data.runtime;
    toast(action === "stop" ? `${found.launcher.name} wird gestoppt.` : action === "restart" ? `${found.launcher.name} wurde neu gestartet.` : `${found.launcher.name} gestartet.`);
  } catch (error) { found.launcher.runtime.status = oldStatus === "running" ? "running" : "error"; found.launcher.runtime.message = error.message; toast(error.message, "error"); }
  render();
}

function updateRuntime(launcherId, runtime) {
  const found = findLauncher(launcherId);
  if (!found) return;
  found.launcher.runtime = runtime;
  render();
  if (state.activeLogId === launcherId) updateLogState(runtime);
}

function connectEvents() {
  const events = new EventSource("/api/events");
  events.addEventListener("runtime", (event) => { const data = JSON.parse(event.data); updateRuntime(data.launcherId, data.runtime); });
  events.addEventListener("log", (event) => { const data = JSON.parse(event.data); if (state.activeLogId === data.launcherId) appendLog(data.entry); });
  events.addEventListener("projects", (event) => { state.projects = JSON.parse(event.data).projects; render(false); });
  events.addEventListener("workspace", (event) => { const data = JSON.parse(event.data); setWorkspaceRoot(data.root); state.projects = data.projects; render(false); });
  events.onopen = () => { elements.scanStatus.textContent = `${state.projects.length} Projekte · live verbunden`; };
  events.onerror = () => { elements.scanStatus.textContent = "Live-Verbindung wird wiederhergestellt …"; };
}

function updateLogState(runtime) {
  elements.logState.textContent = statusLabels[runtime.status] || runtime.status;
  document.querySelector(".live-indicator").classList.toggle("running", runtime.status === "running");
  elements.restartLog.disabled = ["starting", "stopping"].includes(runtime.status);
}

function logLine(entry) {
  const time = new Date(entry.timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `<span class="log-line ${entry.stream}"><span class="log-time">${time}</span>${escapeHtml(entry.text)}</span>`;
}

function appendLog(entry) {
  elements.logOutput.querySelector(".log-placeholder")?.remove();
  elements.logOutput.insertAdjacentHTML("beforeend", logLine(entry));
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
}

async function loadLogs(id) {
  try {
    const data = await api(`/api/launchers/${id}/logs`);
    if (state.activeLogId !== id) return;
    elements.logOutput.innerHTML = data.logs.length ? data.logs.map(logLine).join("") : '<span class="log-placeholder">Noch keine Ausgabe. Starte den Prozess, um Logs zu sehen.</span>';
    elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
  } catch (error) { toast(error.message, "error"); }
}

function openLogs(id) {
  const found = findLauncher(id);
  if (!found) return;
  state.activeLogId = id;
  elements.logTitle.textContent = `${found.project.name} / ${found.launcher.name}`;
  elements.logCommand.textContent = `${found.launcher.relativeCwd} · ${found.launcher.command}`;
  updateLogState(found.launcher.runtime);
  elements.logDialog.showModal();
  loadLogs(id);
}

function resetFilters() {
  state.filter = "all"; state.technology = null; state.query = ""; elements.search.value = "";
  document.querySelectorAll(".side-link").forEach((button) => { const active = button.dataset.filter === "all"; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
  render(false);
}

function setViewFilter(filter) {
  state.filter = filter;
  document.querySelectorAll(".side-link").forEach((item) => { const active = item.dataset.filter === filter; item.classList.toggle("active", active); item.setAttribute("aria-pressed", String(active)); });
  render(false);
}

function copyToClipboard(value, successMessage) {
  navigator.clipboard.writeText(value).then(() => toast(successMessage)).catch(() => toast("Kopieren war nicht möglich.", "error"));
}

function handleProjectInteraction(event) {
  const details = event.target.closest("[data-open-details]");
  if (details) { openProjectDetails(details.dataset.openDetails); return; }
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) { const id = favorite.dataset.favorite; state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id); localStorage.setItem("devhub_favorites", JSON.stringify([...state.favorites])); render(); return; }
  const gitAction = event.target.closest("[data-git-action]");
  if (gitAction) {
    const action = gitAction.dataset.gitAction;
    const payload = action === "commit" ? { message: state.gitCommitMessages.get(gitAction.dataset.projectId) || "" }
      : gitAction.dataset.file ? { file: gitAction.dataset.file } : {};
    runGitProjectAction(gitAction.dataset.projectId, action, payload);
    return;
  }
  const reloadDiff = event.target.closest("[data-reload-diff]");
  if (reloadDiff) { loadGitDiff(reloadDiff.dataset.projectId, reloadDiff.dataset.file, true); return; }
  const gitFile = event.target.closest("[data-git-file]");
  if (gitFile) { loadGitDiff(gitFile.dataset.projectId, gitFile.dataset.gitFile); return; }
  const launcherAction = event.target.closest("[data-launcher-action]");
  if (launcherAction?.dataset.id) { runLauncher(launcherAction.dataset.id, launcherAction.dataset.launcherAction); return; }
  const projectAction = event.target.closest("[data-project-action]");
  if (projectAction) { runProjectAction(projectAction.dataset.projectId, projectAction.dataset.projectAction); return; }
  const log = event.target.closest("[data-log]"); if (log) { openLogs(log.dataset.log); return; }
  const expand = event.target.closest("[data-expand]"); if (expand) { state.expandedProjects.has(expand.dataset.expand) ? state.expandedProjects.delete(expand.dataset.expand) : state.expandedProjects.add(expand.dataset.expand); render(); return; }
  const copy = event.target.closest("[data-copy-path]");
  if (copy) { const project = state.projects.find((item) => item.id === copy.dataset.copyPath); if (project) copyToClipboard(projectPath(project), "Projektpfad kopiert."); return; }
  const copyValue = event.target.closest("[data-copy-value]");
  if (copyValue) { copyToClipboard(copyValue.dataset.copyValue, copyValue.dataset.copyLabel || "Kopiert."); return; }
  const opened = event.target.closest("[data-open-id]"); if (opened) { markRecent(opened.dataset.openId); renderStats(); return; }
  if (event.target.closest("a, button, input, select, textarea")) return;
  const card = event.target.closest("[data-project]");
  if (card) openProjectDetails(card.dataset.project);
}

elements.grid.addEventListener("click", handleProjectInteraction);
elements.runtimeTopology.addEventListener("click", handleProjectInteraction);
elements.grid.addEventListener("keydown", (event) => {
  const card = event.target.closest("[data-project]");
  if (card && event.target === card && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openProjectDetails(card.dataset.project);
  }
});
elements.projectDialogContent.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-project]")) { elements.projectDialog.close(); return; }
  handleProjectInteraction(event);
});
elements.projectDialogContent.addEventListener("input", (event) => {
  const input = event.target.closest("[data-commit-message]");
  if (!input) return;
  state.gitCommitMessages.set(input.dataset.commitMessage, input.value);
  const commitButton = elements.projectDialogContent.querySelector('[data-git-action="commit"]');
  const project = state.projects.find((item) => item.id === input.dataset.commitMessage);
  if (commitButton && project?.git) commitButton.disabled = !project.git.staged || input.value.trim().length < 3 || Boolean(state.pendingGitAction);
});
elements.projectDialogContent.addEventListener("keydown", (event) => {
  const file = event.target.closest("[data-git-file]");
  if (file && event.target === file && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault(); loadGitDiff(file.dataset.projectId, file.dataset.gitFile); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && event.target.matches("[data-commit-message]")) {
    const button = elements.projectDialogContent.querySelector('[data-git-action="commit"]');
    if (button && !button.disabled) { event.preventDefault(); button.click(); }
  }
});
elements.projectDialog.addEventListener("click", (event) => { if (event.target === elements.projectDialog) elements.projectDialog.close(); });
elements.projectDialog.addEventListener("close", () => { state.activeProjectId = null; });

document.querySelector("#view-filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]"); if (!button) return;
  setViewFilter(button.dataset.filter);
});
document.querySelector("#mobile-view-filters").addEventListener("click", (event) => { const button = event.target.closest("[data-mobile-filter]"); if (button) setViewFilter(button.dataset.mobileFilter); });
elements.mobileTech.addEventListener("change", () => { state.technology = elements.mobileTech.value || null; render(false); });
elements.techFilters.addEventListener("click", (event) => { const button = event.target.closest("[data-tech]"); if (!button) return; state.technology = state.technology === button.dataset.tech ? null : button.dataset.tech; render(false); });
elements.clearTech.addEventListener("click", () => { state.technology = null; render(false); });
elements.activeFilter.addEventListener("click", () => { state.technology = null; render(false); });
elements.search.addEventListener("input", () => { state.query = elements.search.value; render(false); });
elements.sort.addEventListener("change", () => { state.sort = elements.sort.value; localStorage.setItem("devhub_sort", state.sort); render(false); });
document.querySelector(".view-switch").addEventListener("click", (event) => { const button = event.target.closest("[data-view]"); if (!button) return; state.view = button.dataset.view; localStorage.setItem("devhub_view", state.view); render(false); });
elements.rescan.addEventListener("click", rescan); elements.emptyAction.addEventListener("click", () => state.projects.length ? resetFilters() : openWorkspaceSettings());
elements.workspaceSettings.addEventListener("click", openWorkspaceSettings);
elements.workspaceBrowse.addEventListener("click", pickWorkspace);
elements.workspaceForm.addEventListener("submit", saveWorkspace);
document.querySelector("#workspace-close").addEventListener("click", () => elements.workspaceDialog.close());
document.querySelector("#workspace-cancel").addEventListener("click", () => elements.workspaceDialog.close());
elements.workspaceDialog.addEventListener("click", (event) => { if (event.target === elements.workspaceDialog) elements.workspaceDialog.close(); });
elements.laragonToggle.addEventListener("click", () => laragonAction(webOnline() ? "stop" : "start"));
elements.laragonOpen.addEventListener("click", () => laragonAction("open")); elements.laragonReload.addEventListener("click", () => laragonAction("reload"));
elements.runtimeDetails.addEventListener("click", () => {
  state.runtimeExpanded = !state.runtimeExpanded;
  localStorage.setItem("devhub_runtime_expanded", String(state.runtimeExpanded));
  renderServiceDock();
});
document.querySelector("#mobile-search").addEventListener("click", () => { elements.search.scrollIntoView({ block: "center" }); elements.search.focus(); });
document.querySelector("#close-log").addEventListener("click", () => elements.logDialog.close());
document.querySelector("#clear-log").addEventListener("click", () => { elements.logOutput.innerHTML = '<span class="log-placeholder">Ansicht geleert. Neue Ausgaben erscheinen weiterhin live.</span>'; });
elements.restartLog.addEventListener("click", () => { if (state.activeLogId) runLauncher(state.activeLogId, "restart"); });
elements.logDialog.addEventListener("close", () => { state.activeLogId = null; }); elements.logDialog.addEventListener("click", (event) => { if (event.target === elements.logDialog) elements.logDialog.close(); });
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") { event.preventDefault(); elements.search.focus(); elements.search.select(); }
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) { event.preventDefault(); elements.search.focus(); }
});

bootstrap();
