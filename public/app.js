const storedFavorites = JSON.parse(localStorage.getItem("devhub_favorites") || "[]");
const storedRecent = JSON.parse(localStorage.getItem("devhub_recent") || "[]");
const state = {
  token: "",
  root: "",
  projects: [],
  laragon: null,
  capabilities: null,
  page: location.hash === "#git" ? "git" : "projects",
  filter: "all",
  technology: null,
  query: "",
  gitQuery: "",
  gitFilter: localStorage.getItem("devhub_git_filter") || "all",
  activeGitProjectId: localStorage.getItem("devhub_git_project") || null,
  sort: localStorage.getItem("devhub_sort") || "smart",
  view: localStorage.getItem("devhub_view") || "grid",
  favorites: new Set(Array.isArray(storedFavorites) ? storedFavorites : []),
  recent: Array.isArray(storedRecent) ? storedRecent : [],
  expandedProjects: new Set(),
  activeProjectId: null,
  runtimeExpanded: localStorage.getItem("devhub_runtime_expanded") === "true",
  gitCommitMessages: new Map(),
  gitSuggestedMessages: new Set(),
  gitSuggestionLoading: new Set(),
  pendingGitAction: null,
  gitMode: localStorage.getItem("devhub_git_mode") === "history" ? "history" : "changes",
  activeGitFiles: new Map(),
  selectedGitFiles: new Map(),
  gitDiffs: new Map(),
  gitDiffLoading: null,
  gitHistories: new Map(),
  gitHistoryLoading: new Set(),
  activeGitCommits: new Map(),
  gitCommitDetails: new Map(),
  gitCommitLoading: null,
  pendingGitDiscard: null,
  activeLogId: null
};

const elements = {
  projectsPage: document.querySelector("#projects-page"), gitPage: document.querySelector("#git-page"),
  grid: document.querySelector("#project-grid"), empty: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"), emptyMessage: document.querySelector("#empty-message"), emptyAction: document.querySelector("#empty-action"),
  rootLabel: document.querySelector("#drive-label"), rootPath: document.querySelector("#workspace-path"), workspaceSettings: document.querySelector("#workspace-settings"),
  workspaceDialog: document.querySelector("#workspace-dialog"), workspaceForm: document.querySelector("#workspace-form"), workspaceInput: document.querySelector("#workspace-input"),
  workspaceBrowse: document.querySelector("#workspace-browse"), workspaceSave: document.querySelector("#workspace-save"),
  resultCount: document.querySelector("#result-count"), projectCount: document.querySelector("#project-count"),
  runningCount: document.querySelector("#running-count"), launcherCount: document.querySelector("#launcher-count"), allCount: document.querySelector("#all-count"),
  favoriteCount: document.querySelector("#favorite-count"), recentCount: document.querySelector("#recent-count"), runningFilterCount: document.querySelector("#running-filter-count"),
  attentionCount: document.querySelector("#attention-count"), gitRepositoryCount: document.querySelector("#git-repository-count"),
  scanStatus: document.querySelector("#scan-status"), search: document.querySelector("#search"), sort: document.querySelector("#sort"), rescan: document.querySelector("#rescan"),
  techFilters: document.querySelector("#tech-filters"), mobileTech: document.querySelector("#mobile-tech"), clearTech: document.querySelector("#clear-tech"), activeFilter: document.querySelector("#active-filter"),
  laragonState: document.querySelector("#laragon-state"), webState: document.querySelector("#web-state"), databaseState: document.querySelector("#database-state"),
  serviceSummary: document.querySelector("#service-summary"), runtimePorts: document.querySelector("#runtime-ports"), laragonToggle: document.querySelector("#laragon-toggle"), laragonToggleLabel: document.querySelector("#laragon-toggle-label"),
  laragonOpen: document.querySelector("#laragon-open"), laragonOpenLabel: document.querySelector("#laragon-open-label"), laragonReload: document.querySelector("#laragon-reload"),
  serviceDock: document.querySelector("#service-dock"), runtimeDetails: document.querySelector("#runtime-details"), runtimeTopology: document.querySelector("#runtime-topology"),
  projectDialog: document.querySelector("#project-dialog"), projectDialogContent: document.querySelector("#project-dialog-content"),
  discardDialog: document.querySelector("#git-discard-dialog"), discardCount: document.querySelector("#git-discard-count"), discardFiles: document.querySelector("#git-discard-files"),
  discardCancel: document.querySelector("#git-discard-cancel"), discardConfirm: document.querySelector("#git-discard-confirm"),
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
      ${runtime.url && runtime.status === "running" ? `<a class="mini-action" href="${escapeHtml(runtime.url)}" data-open-id="${launcher.projectId}" target="_blank" rel="noopener noreferrer" aria-label="Im Browser öffnen"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i><span class="mini-label">Browser</span></a>` : ""}
      <button class="mini-action" data-log="${launcher.id}" data-focus-key="log-${launcher.id}" aria-label="Logs anzeigen"><i class="fa-solid fa-terminal" aria-hidden="true"></i><span class="mini-label">Logs</span></button>
      <button class="mini-action ${action === "stop" ? "stop" : ""} ${busy ? "busy" : ""}" data-launcher-action="${action}" data-id="${launcher.id}" data-focus-key="run-${launcher.id}" ${busy ? "disabled" : ""} aria-label="${action === "stop" ? "Stoppen" : "Starten"}"><i class="fa-solid ${busy ? "fa-spinner fa-spin" : action === "stop" ? "fa-stop" : "fa-play"}" aria-hidden="true"></i><span class="mini-label">${action === "stop" ? "Stoppen" : "Starten"}</span></button>
    </div>
  </div>`;
}

function primaryAction(project, compact = false) {
  const url = browserUrl(project);
  if (url) return `<a class="primary-card-action running" href="${escapeHtml(url)}" data-open-id="${project.id}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>${compact ? "Browser" : "Browser öffnen"}</a>`;
  const launcher = preferredLauncher(project);
  if (launcher) {
    const running = launcher.runtime.status === "running";
    const busy = ["starting", "stopping"].includes(launcher.runtime.status);
    const label = busy ? (compact ? "Bitte warten …" : "Wird ausgeführt …") : running ? "Stoppen" : compact ? "Starten" : `Starten · ${escapeHtml(launcher.name)}`;
    return `<button class="primary-card-action ${running ? "running" : ""}" data-launcher-action="${running ? "stop" : "start"}" data-id="${launcher.id}" data-project-id="${project.id}" ${busy ? "disabled" : ""}><i class="fa-solid ${busy ? "fa-spinner fa-spin" : running ? "fa-stop" : "fa-play"}" aria-hidden="true"></i>${label}</button>`;
  }
  return `<button class="primary-card-action folder" data-project-action="folder" data-project-id="${project.id}"><i class="fa-regular fa-folder-open" aria-hidden="true"></i>${compact ? "Ordner" : "Ordner öffnen"}</button>`;
}

function gitConflictCount(git) {
  const conflictStates = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
  return git.files?.filter((file) => conflictStates.has(`${file.indexStatus}${file.worktreeStatus}`)).length || 0;
}

function favoriteIcon(active) {
  return `<i class="${active ? "fa-solid" : "fa-regular"} fa-star favorite-icon" aria-hidden="true"></i>`;
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
    <i class="fa-solid fa-code-branch git-branch-icon" aria-hidden="true"></i>
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
        <button class="favorite-button ${favorite ? "active" : ""}" data-favorite="${project.id}" data-focus-key="fav-${project.id}" aria-label="${favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}" aria-pressed="${favorite}">${favoriteIcon(favorite)}</button>
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
      <button class="card-icon-action" data-project-action="editor" data-project-id="${project.id}" aria-label="In ${escapeHtml(editorName)} öffnen" ${state.capabilities?.editor.available ? "" : "disabled"}><i class="fa-solid fa-code" aria-hidden="true"></i><b>Editor</b></button>
      <button class="card-icon-action" data-project-action="terminal" data-project-id="${project.id}" aria-label="Terminal hier öffnen" ${state.capabilities?.terminal.available ? "" : "disabled"}><i class="fa-solid fa-terminal" aria-hidden="true"></i><b>Terminal</b></button>
      <button class="card-icon-action" data-project-action="folder" data-project-id="${project.id}" aria-label="Ordner öffnen"><i class="fa-regular fa-folder-open" aria-hidden="true"></i><b>Ordner</b></button>
      <button class="card-icon-action" data-copy-path="${project.id}" aria-label="Pfad kopieren"><i class="fa-regular fa-copy" aria-hidden="true"></i><b>Pfad</b></button>
    </div>
  </article>`;
}

function projectListItem(project) {
  const running = projectIsRunning(project);
  const status = projectState(project);
  const [symbol, className] = techClass(project);
  const favorite = state.favorites.has(project.id);
  const editorName = state.capabilities?.editor.name || "Editor";
  const hasDirectLaunchAction = Boolean(browserUrl(project) || preferredLauncher(project));
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
      <button class="favorite-button ${favorite ? "active" : ""}" data-favorite="${project.id}" data-focus-key="fav-${project.id}" aria-label="${favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}" aria-pressed="${favorite}">${favoriteIcon(favorite)}</button>
    </section>
    <section class="launcher-panel list-launchers" aria-label="Starter für ${escapeHtml(project.name)}">
      <div class="list-launcher-head">
        <span>Alle Starter</span><b>${project.launchers.length}</b>
      </div>
      ${project.launchers.length ? project.launchers.map(launcherRow).join("") : '<p class="list-no-launcher">Kein automatischer Starter erkannt</p>'}
    </section>
    <div class="card-actions list-actions">
      <span class="list-actions-label">Projekt steuern</span>
      <div class="list-action-grid">
        ${primaryAction(project, true)}
        <div class="list-utility-actions" aria-label="Projektaktionen">
          <button class="card-icon-action" data-project-action="editor" data-project-id="${project.id}" aria-label="In ${escapeHtml(editorName)} öffnen" title="In ${escapeHtml(editorName)} öffnen" ${state.capabilities?.editor.available ? "" : "disabled"}><i class="fa-solid fa-code" aria-hidden="true"></i><b>Editor</b></button>
          <button class="card-icon-action" data-project-action="terminal" data-project-id="${project.id}" aria-label="Terminal hier öffnen" title="Terminal hier öffnen" ${state.capabilities?.terminal.available ? "" : "disabled"}><i class="fa-solid fa-terminal" aria-hidden="true"></i><b>Terminal</b></button>
          ${hasDirectLaunchAction ? `<button class="card-icon-action" data-project-action="folder" data-project-id="${project.id}" aria-label="Ordner öffnen" title="Ordner öffnen"><i class="fa-regular fa-folder-open" aria-hidden="true"></i><b>Ordner</b></button>` : ""}
          <button class="card-icon-action" data-copy-path="${project.id}" aria-label="Pfad kopieren" title="Pfad kopieren"><i class="fa-regular fa-copy" aria-hidden="true"></i><b>Pfad</b></button>
        </div>
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

function selectedGitFileSet(project) {
  const available = new Set(project.git?.files.map((file) => file.path) || []);
  const current = state.selectedGitFiles.get(project.id) || new Set();
  const selected = new Set([...current].filter((file) => available.has(file)));
  if (selected.size) state.selectedGitFiles.set(project.id, selected);
  else state.selectedGitFiles.delete(project.id);
  return selected;
}

function selectGitFile(projectId, file, additive = false) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project?.git?.files.some((item) => item.path === file)) return;
  const selected = new Set(additive ? selectedGitFileSet(project) : []);
  if (additive && selected.has(file)) selected.delete(file);
  else selected.add(file);
  if (selected.size) state.selectedGitFiles.set(projectId, selected);
  else state.selectedGitFiles.delete(projectId);
  if (selected.has(file) || !additive) loadGitDiff(projectId, file);
  else renderGitSurfaces();
}

function selectAllGitFiles(projectId, selected) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project?.git) return;
  if (selected) state.selectedGitFiles.set(projectId, new Set(project.git.files.map((file) => file.path)));
  else state.selectedGitFiles.delete(projectId);
  renderGitSurfaces();
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
    <div class="git-diff-head"><strong title="${escapeHtml(file)}">${escapeHtml(file)}</strong><div><span class="diff-additions">+${additions}</span><span class="diff-deletions">−${deletions}</span><button data-reload-diff data-project-id="${project.id}" data-file="${escapeHtml(file)}" title="Diff neu laden"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button></div></div>
    <div class="git-diff-scroll">
      ${data.sections.map((section) => `<section class="diff-section ${section.scope}"><header><i></i>${escapeHtml(section.label)}</header><div class="diff-code">${renderPatch(section.patch)}</div>${section.truncated ? '<div class="diff-limit-note">Sehr großer Diff wurde gekürzt.</div>' : ""}</section>`).join("") || '<div class="diff-empty">Keine darstellbaren Textänderungen.</div>'}
    </div>
  </section>`;
}

async function loadGitDiff(projectId, file, force = false) {
  const key = diffKey(projectId, file);
  state.activeGitFiles.set(projectId, file);
  if (!force && state.gitDiffs.has(key)) {
    if (elements.projectDialog.open) renderProjectDialog();
    if (state.page === "git") renderGitPage();
    return;
  }
  state.gitDiffLoading = key;
  if (elements.projectDialog.open) renderProjectDialog();
  if (state.page === "git") renderGitPage();
  try {
    const data = await api(`/api/projects/${projectId}/git/diff?file=${encodeURIComponent(file)}`);
    state.gitDiffs.set(key, data);
  } catch (error) {
    state.gitDiffs.set(key, { error: error.message });
  } finally {
    if (state.gitDiffLoading === key) state.gitDiffLoading = null;
    if (state.activeProjectId === projectId && elements.projectDialog.open) renderProjectDialog();
    if (state.page === "git" && state.activeGitProjectId === projectId) renderGitPage();
  }
}

function renderGitSurfaces() {
  if (elements.projectDialog.open) renderProjectDialog();
  if (state.page === "git") renderGitPage();
}

function gitCommitKey(projectId, hash) {
  return `${projectId}\u0000${hash}`;
}

function gitHistoryDate(isoDate) {
  if (!isoDate) return "unbekannt";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(isoDate));
}

function gitHistoryCommitRow(project, commit) {
  const active = state.activeGitCommits.get(project.id) === commit.hash;
  return `<button class="git-history-commit ${active ? "active" : ""}" data-git-commit="${commit.hash}" data-project-id="${project.id}" aria-pressed="${active}">
    <span class="git-history-node"><i></i></span>
    <span class="git-history-copy"><strong title="${escapeHtml(commit.subject)}">${escapeHtml(commit.subject)}</strong><small>${escapeHtml(commit.author)} · ${gitHistoryDate(commit.date)}</small></span>
    <code>${escapeHtml(commit.shortHash)}</code>
  </button>`;
}

function gitCommitViewer(project) {
  const hash = state.activeGitCommits.get(project.id);
  if (!hash) return `<section class="git-history-detail empty"><span><i class="fa-solid fa-code-commit" aria-hidden="true"></i></span><strong>Commit auswählen</strong><p>Wähle links einen Commit, um Dateien und Diff zu sehen.</p></section>`;
  const key = gitCommitKey(project.id, hash);
  if (state.gitCommitLoading === key) return `<section class="git-history-detail"><div class="git-history-detail-loading"><i></i>Commit wird geladen …</div></section>`;
  const detail = state.gitCommitDetails.get(key);
  if (detail?.error) return `<section class="git-history-detail"><div class="diff-error">${escapeHtml(detail.error)}</div></section>`;
  if (!detail) return `<section class="git-history-detail empty"><span><i class="fa-solid fa-code-commit" aria-hidden="true"></i></span><strong>Commit auswählen</strong></section>`;
  let additions = 0;
  let deletions = 0;
  detail.patch.split(/\r?\n/).forEach((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  });
  return `<section class="git-history-detail">
    <header class="git-commit-head">
      <div><p class="eyebrow">Ausgewählter Commit</p><h4>${escapeHtml(detail.subject)}</h4><span>${escapeHtml(detail.author)} · ${dateTime(detail.date)}</span></div>
      <div class="git-commit-head-meta"><code>${escapeHtml(detail.shortHash)}</code><span class="diff-additions">+${additions}</span><span class="diff-deletions">−${deletions}</span></div>
    </header>
    <div class="git-commit-files" aria-label="Dateien im Commit">
      ${detail.files.slice(0, 16).map((file) => `<span title="${escapeHtml(file.path)}"><b class="status-${escapeHtml(file.status)}">${escapeHtml(file.status)}</b>${escapeHtml(file.path)}</span>`).join("") || '<span class="empty">Keine geänderten Dateien erkannt</span>'}
      ${detail.files.length > 16 ? `<span class="more">+${detail.files.length - 16} weitere</span>` : ""}
    </div>
    <div class="git-history-diff"><div class="diff-code">${detail.patch ? renderPatch(detail.patch) : '<div class="diff-empty">Dieser Commit enthält keinen darstellbaren Text-Diff.</div>'}</div>${detail.truncated ? '<div class="diff-limit-note">Sehr großer Commit-Diff wurde gekürzt.</div>' : ""}</div>
  </section>`;
}

function gitHistoryView(project) {
  const history = state.gitHistories.get(project.id);
  const loading = state.gitHistoryLoading.has(project.id);
  if (!history && loading) return `<div class="git-history-loading"><i></i><strong>Verlauf wird geladen</strong><span>Commits und Metadaten werden eingelesen …</span></div>`;
  if (history?.error) return `<div class="git-history-loading error"><strong>Verlauf konnte nicht geladen werden</strong><span>${escapeHtml(history.error)}</span><button data-git-history-retry="${project.id}">Erneut laden</button></div>`;
  const commits = history?.commits || [];
  if (!commits.length) return `<div class="git-history-loading"><span class="history-empty-icon"><i class="fa-solid fa-code-commit" aria-hidden="true"></i></span><strong>Noch keine Commits</strong><span>Der Verlauf beginnt mit dem ersten Commit dieses Repositorys.</span></div>`;
  if (!state.activeGitCommits.has(project.id)) state.activeGitCommits.set(project.id, commits[0].hash);
  return `<div class="git-history-workbench">
    <section class="git-history-list-panel">
      <header><div><strong>Commit-Verlauf</strong><span>${commits.length}${history.hasMore ? "+" : ""} geladen</span></div><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i></header>
      <div class="git-history-list">${commits.map((commit) => gitHistoryCommitRow(project, commit)).join("")}</div>
      ${history.hasMore ? `<button class="git-history-more" data-git-history-more="${project.id}" ${loading ? "disabled" : ""}>${loading ? "Weitere Commits werden geladen …" : "Weitere Commits laden"}</button>` : `<p class="git-history-end"><i></i>Beginn des Repositorys</p>`}
    </section>
    ${gitCommitViewer(project)}
  </div>`;
}

async function loadGitCommit(projectId, hash, force = false) {
  if (!hash) return;
  const key = gitCommitKey(projectId, hash);
  state.activeGitCommits.set(projectId, hash);
  if (!force && state.gitCommitDetails.has(key)) { renderGitSurfaces(); return; }
  state.gitCommitLoading = key;
  renderGitSurfaces();
  try {
    state.gitCommitDetails.set(key, await api(`/api/projects/${projectId}/git/commits/${hash}`));
  } catch (error) {
    state.gitCommitDetails.set(key, { error: error.message });
  } finally {
    if (state.gitCommitLoading === key) state.gitCommitLoading = null;
    renderGitSurfaces();
  }
}

async function loadGitHistory(projectId, more = false, force = false) {
  if (state.gitHistoryLoading.has(projectId)) return;
  const existing = state.gitHistories.get(projectId);
  if (!more && !force && existing?.commits?.length) {
    const hash = state.activeGitCommits.get(projectId) || existing.commits[0].hash;
    if (!state.gitCommitDetails.has(gitCommitKey(projectId, hash))) loadGitCommit(projectId, hash);
    else renderGitSurfaces();
    return;
  }
  state.gitHistoryLoading.add(projectId);
  if (!more) state.gitHistories.delete(projectId);
  renderGitSurfaces();
  try {
    const offset = more && existing?.commits ? existing.commits.length : 0;
    const data = await api(`/api/projects/${projectId}/git/history?offset=${offset}&limit=60`);
    const commits = more && existing?.commits ? [...existing.commits, ...data.commits] : data.commits;
    state.gitHistories.set(projectId, { commits, hasMore: data.hasMore });
    if (commits.length) {
      const active = state.activeGitCommits.get(projectId);
      const hash = commits.some((commit) => commit.hash === active) ? active : commits[0].hash;
      state.activeGitCommits.set(projectId, hash);
      if (!state.gitCommitDetails.has(gitCommitKey(projectId, hash))) loadGitCommit(projectId, hash);
    }
  } catch (error) {
    state.gitHistories.set(projectId, { error: error.message, commits: [], hasMore: false });
  } finally {
    state.gitHistoryLoading.delete(projectId);
    renderGitSurfaces();
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
  const selected = selectedGitFileSet(project).has(file.path);
  return `<div class="git-file-row ${activeGitFile(project) === file.path ? "active" : ""} ${selected ? "selected" : ""}" data-git-file="${escapeHtml(file.path)}" data-project-id="${project.id}" tabindex="0" aria-selected="${selected}">
    <label class="git-file-check" title="Datei auswählen"><input type="checkbox" data-git-select-file="${escapeHtml(file.path)}" data-project-id="${project.id}" ${selected ? "checked" : ""} ${pending ? "disabled" : ""}><span aria-hidden="true"><i class="fa-solid fa-check"></i></span><span class="sr-only">${escapeHtml(file.path)} auswählen</span></label>
    <span class="git-file-status status-${escapeHtml(primaryStatus)}" title="${escapeHtml(gitStatusLabel(primaryStatus))}">${escapeHtml(primaryStatus)}</span>
    <div class="git-file-path" title="${escapeHtml(file.path)}"><span>${escapeHtml(directory)}</span><strong>${escapeHtml(name)}</strong>${file.originalPath ? `<small>von ${escapeHtml(file.originalPath)}</small>` : ""}</div>
    <div class="git-file-flags">
      ${staged ? '<span class="file-flag staged">vorgemerkt</span>' : ""}
      ${working && file.worktreeStatus !== "?" ? '<span class="file-flag working">lokal</span>' : ""}
      ${file.worktreeStatus === "?" ? '<span class="file-flag untracked">neu</span>' : ""}
    </div>
    <button class="git-file-action ${staged ? "unstage" : "stage"}" data-git-action="${staged ? "unstage" : "stage"}" data-project-id="${project.id}" data-file="${escapeHtml(file.path)}" aria-label="${staged ? "Vormerkung lösen" : "Datei vormerken"}: ${escapeHtml(file.path)}" title="${staged ? "Vormerkung lösen" : "Datei vormerken"}" ${pending ? "disabled" : ""}><i class="fa-solid ${staged ? "fa-minus" : "fa-plus"}" aria-hidden="true"></i><span>${staged ? "Lösen" : "Vormerken"}</span></button>
  </div>`;
}

function gitLastCommit(project) {
  const commit = project.git?.lastCommit;
  return commit ? `<div class="last-commit"><span class="commit-hash">${escapeHtml(commit.hash)}</span><div><strong>${escapeHtml(commit.subject)}</strong><small>${escapeHtml(commit.author)} · ${dateTime(commit.date)}</small></div></div>` : '<p class="git-empty-note">Noch kein Commit vorhanden.</p>';
}

function gitRemotePanel(project) {
  const git = project.git;
  const pending = state.pendingGitAction?.startsWith(`${project.id}:`);
  const canPush = Boolean(git.remoteName && git.branch && (!git.upstream || git.ahead > 0));
  const canFetch = Boolean(git.remoteName);
  const canPull = Boolean(git.upstream && git.branch && git.behind > 0);
  return `<div class="push-panel">
    <div><strong>${git.upstream ? escapeHtml(git.upstream) : "Branch veröffentlichen"}</strong><span>${git.upstream ? `${git.ahead} voraus · ${git.behind} zurück` : `auf ${escapeHtml(git.remoteName || "Remote")}`}</span></div>
    <div class="push-actions">
      <button class="fetch-button" data-git-action="fetch" data-project-id="${project.id}" ${pending || !canFetch ? "disabled" : ""}>${state.pendingGitAction === `${project.id}:fetch` ? "Abrufen …" : "Fetch"}</button>
      <button class="pull-button" data-git-action="pull" data-project-id="${project.id}" ${pending || !canPull ? "disabled" : ""}>${state.pendingGitAction === `${project.id}:pull` ? "Pull läuft …" : `Pull · ↓${git.behind}`}</button>
      <button data-git-action="push" data-project-id="${project.id}" ${pending || !canPush ? "disabled" : ""}>${state.pendingGitAction === `${project.id}:push` ? "Push läuft …" : git.upstream ? `Push · ↑${git.ahead}` : "Push & Upstream"}</button>
    </div>
  </div>`;
}

function gitInlineActions(project, surface) {
  const branch = project.git?.branch || "detached HEAD";
  return `<div class="detail-inline-actions">
    ${surface === "drawer" ? `<button class="detail-secondary-action open-git-page-action" data-open-git-workspace="${project.id}"><i class="fa-solid fa-code-branch" aria-hidden="true"></i>In Git-Zentrale öffnen</button>` : ""}
    ${project.git?.remoteUrl ? `<a class="detail-secondary-action" href="${escapeHtml(project.git.remoteUrl)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>Remote öffnen</a>` : ""}
    <button class="detail-secondary-action" data-copy-value="${escapeHtml(branch)}" data-copy-label="Branch kopiert.">Branch kopieren</button>
    <button class="detail-secondary-action" data-project-action="terminal" data-project-id="${project.id}" ${state.capabilities?.terminal.available ? "" : "disabled"}><i class="fa-solid fa-terminal" aria-hidden="true"></i>Terminal</button>
  </div>`;
}

function gitSelectionToolbar(project) {
  const git = project.git;
  const selected = selectedGitFileSet(project);
  const files = git.files.filter((file) => selected.has(file.path));
  const pending = state.pendingGitAction?.startsWith(`${project.id}:`);
  const canStage = files.some((file) => file.worktreeStatus !== "." || file.indexStatus === "?");
  const canUnstage = files.some((file) => file.indexStatus !== "." && file.indexStatus !== "?");
  const allSelected = git.files.length > 0 && selected.size === git.files.length;
  return `<div class="git-selection-bar ${selected.size ? "has-selection" : ""}">
    <label class="git-select-all ${selected.size && !allSelected ? "partial" : ""}" title="Alle angezeigten Dateien auswählen">
      <input type="checkbox" data-git-select-all="${project.id}" ${allSelected ? "checked" : ""} ${pending ? "disabled" : ""}>
      <span aria-hidden="true"><i class="fa-solid ${selected.size && !allSelected ? "fa-minus" : "fa-check"}"></i></span>
      <span class="sr-only">Alle angezeigten Dateien auswählen</span>
    </label>
    <div class="git-selection-copy"><strong>${selected.size ? `${selected.size} ausgewählt` : "Dateien auswählen"}</strong><small>${selected.size ? "Aktionen gelten für die Auswahl" : "Checkbox oder Strg/Cmd für Mehrfachauswahl"}</small></div>
    <div class="git-selection-actions">
      <button class="stage" data-git-selection-action="stage-files" data-project-id="${project.id}" ${pending || !canStage ? "disabled" : ""}><i class="fa-solid fa-plus" aria-hidden="true"></i>Vormerken</button>
      <button data-git-selection-action="unstage-files" data-project-id="${project.id}" ${pending || !canUnstage ? "disabled" : ""}><i class="fa-solid fa-minus" aria-hidden="true"></i>Lösen</button>
      <button class="discard" data-git-selection-action="discard-files" data-project-id="${project.id}" ${pending || !selected.size ? "disabled" : ""}><i class="fa-solid fa-rotate-left" aria-hidden="true"></i>Verwerfen</button>
    </div>
  </div>`;
}

function gitChangesView(project, surface) {
  const git = project.git;
  const changes = git.changedFiles ?? git.files.length;
  const pending = state.pendingGitAction?.startsWith(`${project.id}:`);
  if (!changes) return `<div class="git-clean-layout">
    <section class="git-clean-summary">
      <span><i class="fa-solid fa-check" aria-hidden="true"></i></span>
      <div><p class="eyebrow">Arbeitsbaum</p><h4>Alles committed</h4><p>Keine lokalen Änderungen. Der Verlauf und Remote-Stand sind bereit.</p></div>
      <button data-git-mode="history" data-project-id="${project.id}"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>Verlauf öffnen</button>
    </section>
    <aside class="git-clean-side"><div><p class="eyebrow">Letzter Commit</p>${gitLastCommit(project)}</div>${gitRemotePanel(project)}${gitInlineActions(project, surface)}</aside>
  </div>`;
  const draft = state.gitCommitMessages.get(project.id) || "";
  const suggested = state.gitSuggestedMessages.has(project.id);
  const suggestionLoading = state.gitSuggestionLoading.has(project.id);
  const commitInputId = surface === "page" ? "git-page-commit-message" : "git-commit-message";
  return `<div class="git-workbench">
    <div class="git-files-panel">
      <div class="git-files-head"><div><strong>Geänderte Dateien</strong><span>${changes}${git.filesTruncated ? "+" : ""} im Arbeitsbaum</span></div><div>
        <button data-git-action="refresh" data-project-id="${project.id}" ${pending ? "disabled" : ""} title="Git-Status aktualisieren"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button>
        <button data-git-action="${git.staged ? "unstage-all" : "stage-all"}" data-project-id="${project.id}" ${pending ? "disabled" : ""}>${git.staged ? "Vormerkungen lösen" : "Alle vormerken"}</button>
      </div></div>
      ${gitSelectionToolbar(project)}
      <div class="git-file-list">${git.files.map((file) => gitFileRow(project, file)).join("")}${git.filesTruncated ? '<p class="git-files-truncated">Weitere Dateien werden aus Performancegründen nicht einzeln angezeigt. „Alle vormerken“ erfasst sie trotzdem.</p>' : ""}</div>
    </div>
    ${gitDiffViewer(project)}
    <aside class="git-commit-panel">
      <div><p class="eyebrow">Letzter Commit</p>${gitLastCommit(project)}</div>
      <div class="commit-composer ${suggested ? "suggested" : ""}"><label for="${commitInputId}">Commit-Nachricht <span class="commit-suggestion-status">${suggestionLoading ? "wird erstellt …" : suggested ? "Vorschlag" : `${git.staged} vorgemerkt`}</span></label><div class="commit-message-field"><input id="${commitInputId}" data-commit-message="${project.id}" data-focus-key="git-commit-${project.id}" value="${escapeHtml(draft)}" maxlength="200" placeholder="${suggestionLoading ? "Vorschlag wird erstellt …" : "Was wurde geändert?"}" autocomplete="off"><button type="button" class="commit-suggest-button" data-git-suggest-message="${project.id}" title="Commit-Vorschlag aktualisieren" aria-label="Commit-Vorschlag aktualisieren" ${pending || !git.staged || suggestionLoading ? "disabled" : ""}><i class="fa-solid ${suggestionLoading ? "fa-spinner fa-spin" : "fa-wand-magic-sparkles"}" aria-hidden="true"></i></button></div><button class="git-commit-button" data-git-action="commit" data-project-id="${project.id}" ${pending || !git.staged || draft.trim().length < 3 ? "disabled" : ""}>${state.pendingGitAction === `${project.id}:commit` ? "Commit läuft …" : "Commit erstellen"}</button><small class="commit-composer-note">${suggested ? '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Automatisch vorgeschlagen · frei bearbeitbar' : "Der Commit enthält nur vorgemerkte Dateien."}</small></div>
      ${gitRemotePanel(project)}${gitInlineActions(project, surface)}
    </aside>
  </div>`;
}

function gitDetail(project, surface = "drawer") {
  const git = project.git;
  if (!git) return `<section class="detail-panel git-detail empty-git"><div class="detail-section-head"><div><p class="eyebrow">Versionskontrolle</p><h3>Kein Git-Repository</h3></div></div><p>In diesem Projektordner wurde kein Repository erkannt. Du kannst direkt ein Terminal öffnen, um eines anzulegen.</p><button class="detail-secondary-action" data-project-action="terminal" data-project-id="${project.id}" ${state.capabilities?.terminal.available ? "" : "disabled"}>&gt;_ Terminal öffnen</button></section>`;
  const changes = git.changedFiles ?? git.files.length;
  const branch = git.branch || "detached HEAD";
  const repoHint = git.repositoryRoot === "." ? "Projektstamm" : git.repositoryRoot;
  return `<section class="detail-panel git-detail ${surface === "page" ? "git-page-detail" : ""}">
    <div class="git-detail-toolbar">
      <nav class="git-mode-tabs" aria-label="Git-Arbeitsmodus">
        <button class="${state.gitMode === "changes" ? "active" : ""}" data-git-mode="changes" data-project-id="${project.id}" aria-pressed="${state.gitMode === "changes"}"><i class="fa-solid fa-code-branch" aria-hidden="true"></i>Änderungen <b>${changes}</b></button>
        <button class="${state.gitMode === "history" ? "active" : ""}" data-git-mode="history" data-project-id="${project.id}" aria-pressed="${state.gitMode === "history"}"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>Verlauf</button>
      </nav>
      <span>Git · ${escapeHtml(repoHint)}</span>
    </div>
    <div class="git-status-strip" aria-label="Git-Status">
      <div class="git-status-branch"><span class="git-node"></span><code>${escapeHtml(branch)}</code></div>
      <span class="git-health ${git.dirty ? "dirty" : "clean"}"><i></i>${git.dirty ? `${changes} offen` : "sauber"}</span>
      <div class="git-status-changes"><span><b>${git.staged}</b> vorgemerkt</span><span><b>${git.unstaged}</b> lokal</span><span><b>${git.untracked}</b> neu</span></div>
      <div class="git-status-sync"><small>${escapeHtml(git.upstream || git.remoteName || "kein Remote")}</small><span>↑ ${git.ahead}</span><span>↓ ${git.behind}</span></div>
    </div>
    ${state.gitMode === "history" ? gitHistoryView(project) : gitChangesView(project, surface)}
  </section>`;
}

function gitOverview(project) {
  return `<section class="detail-panel git-overview empty-git-overview"><div><p class="eyebrow">Versionskontrolle</p><h3>Kein Git-Repository</h3></div><p>Für dieses Projekt wurde kein Repository erkannt.</p></section>`;
}

function gitRepositoryTone(project) {
  const git = project.git;
  if (!git) return "clean";
  if (gitConflictCount(git)) return "conflict";
  if (git.dirty) return "changes";
  if (git.behind) return "behind";
  if (git.ahead) return "ahead";
  return "clean";
}

function gitRepositoryMatches(project, filter) {
  const git = project.git;
  if (!git) return false;
  if (filter === "changed") return git.dirty;
  if (filter === "staged") return git.staged > 0;
  if (filter === "sync") return git.ahead > 0 || git.behind > 0;
  if (filter === "conflicts") return gitConflictCount(git) > 0;
  if (filter === "clean") return !git.dirty && git.ahead === 0 && git.behind === 0;
  return true;
}

function gitRepositoryItem(project) {
  const git = project.git;
  const status = gitStatusPresentation(git);
  const selected = project.id === state.activeGitProjectId;
  const changes = git.changedFiles ?? git.files.length;
  const conflicts = gitConflictCount(git);
  return `<button class="git-repository-item ${gitRepositoryTone(project)} ${selected ? "active" : ""}" data-git-repository="${project.id}" aria-pressed="${selected}">
    <span class="git-repository-node"><i class="fa-solid fa-code-branch" aria-hidden="true"></i></span>
    <span class="git-repository-copy">
      <strong>${escapeHtml(project.name)}</strong>
      <code title="${escapeHtml(project.relativePath)}">${escapeHtml(project.relativePath)}</code>
      <span><b>${escapeHtml(git.branch || "detached")}</b><em>${escapeHtml(status.label)}</em></span>
    </span>
    <span class="git-repository-signals">
      ${conflicts ? `<b class="conflict"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>${conflicts}</b>` : ""}
      ${changes ? `<b class="changes" title="Offene Änderungen">${changes}</b>` : ""}
      ${git.ahead ? `<b class="ahead" title="Commits voraus">↑${git.ahead}</b>` : ""}
      ${git.behind ? `<b class="behind" title="Commits zurück">↓${git.behind}</b>` : ""}
    </span>
  </button>`;
}

function renderGitPage() {
  const repositories = state.projects.filter((project) => project.git).sort((a, b) => {
    const priority = (project) => gitConflictCount(project.git) * 1000 + Number(project.git.dirty) * 100 + (project.git.ahead + project.git.behind) * 10;
    return priority(b) - priority(a) || a.name.localeCompare(b.name, "de");
  });
  const query = state.gitQuery.trim().toLocaleLowerCase("de");
  const visible = repositories.filter((project) => gitRepositoryMatches(project, state.gitFilter) && (!query || [project.name, project.relativePath, project.git.branch, project.git.remoteName, project.git.lastCommit?.subject]
    .join(" ").toLocaleLowerCase("de").includes(query)));
  if (!repositories.some((project) => project.id === state.activeGitProjectId)) state.activeGitProjectId = repositories[0]?.id || null;
  if (visible.length && !visible.some((project) => project.id === state.activeGitProjectId)) state.activeGitProjectId = visible[0].id;
  const selected = repositories.find((project) => project.id === state.activeGitProjectId) || null;
  const changedRepositories = repositories.filter((project) => project.git.dirty).length;
  const changedFiles = repositories.reduce((sum, project) => sum + (project.git.changedFiles ?? project.git.files.length), 0);
  const syncRepositories = repositories.filter((project) => project.git.ahead || project.git.behind).length;
  const conflicts = repositories.reduce((sum, project) => sum + gitConflictCount(project.git), 0);
  const filterLabels = { all: "Alle", changed: "Geändert", staged: "Vorgemerkt", sync: "Synchronisieren", conflicts: "Konflikte", clean: "Sauber" };
  const filters = Object.entries(filterLabels).map(([filter, label]) => `<button class="${state.gitFilter === filter ? "active" : ""}" data-git-filter="${filter}" aria-pressed="${state.gitFilter === filter}">${label}</button>`).join("");

  elements.gitPage.innerHTML = `<header class="git-command-deck">
    <div class="git-command-title">
      <span class="git-command-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <div><p class="eyebrow">Repository control</p><h1>Git-Zentrale</h1><span>${repositories.length} Repositories · ein Arbeitsstand</span></div>
    </div>
    <div class="git-command-metrics" aria-label="Git-Status im Workspace">
      <button data-git-filter="all"><i class="metric-dot repositories"></i><span><strong>${repositories.length}</strong><small>Repositories</small></span></button>
      <button data-git-filter="changed"><i class="metric-dot changes"></i><span><strong>${changedFiles}</strong><small>offene Dateien</small></span></button>
      <button data-git-filter="sync"><i class="metric-dot sync"></i><span><strong>${syncRepositories}</strong><small>zu synchronisieren</small></span></button>
      <button data-git-filter="conflicts"><i class="metric-dot ${conflicts ? "conflicts" : "clean"}"></i><span><strong>${conflicts}</strong><small>Konflikte</small></span></button>
    </div>
    <button class="git-command-refresh" data-rescan-workspace title="Alle Repositories neu einlesen"><i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Status aktualisieren</span></button>
  </header>
  <div class="git-page-toolbar">
    <div class="git-filter-tabs" aria-label="Repositories filtern">${filters}</div>
    <span><b>${visible.length}</b> von ${repositories.length} Repositories</span>
  </div>
  ${repositories.length ? `<div class="git-console">
    <aside class="git-repository-rail" aria-label="Repositories">
      <header><div><p class="eyebrow">Workspace inbox</p><strong>Repositories</strong></div><span>${changedRepositories} aktiv</span></header>
      <div class="git-repository-list">
        ${visible.map(gitRepositoryItem).join("") || `<div class="git-repository-empty"><i class="fa-solid fa-filter-circle-xmark" aria-hidden="true"></i><strong>Kein Treffer</strong><span>Ändere Filter oder Suche.</span></div>`}
      </div>
    </aside>
    <section class="git-page-workbench" aria-live="polite">
      ${selected && visible.length ? `<header class="git-selected-header">
        <div class="git-selected-identity">
          <span class="git-selected-symbol"><i class="fa-solid fa-code-branch" aria-hidden="true"></i></span>
          <div><p class="eyebrow">Ausgewähltes Repository</p><h2>${escapeHtml(selected.name)}</h2><code>${escapeHtml(selected.relativePath)}</code></div>
        </div>
        <div class="git-selected-actions">
          <button data-open-details="${selected.id}"><i class="fa-regular fa-window-restore" aria-hidden="true"></i><span>Projekt</span></button>
          <button data-project-action="editor" data-project-id="${selected.id}" ${state.capabilities?.editor.available ? "" : "disabled"}><i class="fa-solid fa-code" aria-hidden="true"></i><span>${escapeHtml(state.capabilities?.editor.name || "Editor")}</span></button>
          <button data-project-action="terminal" data-project-id="${selected.id}" ${state.capabilities?.terminal.available ? "" : "disabled"}><i class="fa-solid fa-terminal" aria-hidden="true"></i><span>Terminal</span></button>
        </div>
      </header>${gitDetail(selected, "page")}` : `<div class="git-workbench-empty"><span><i class="fa-solid fa-code-branch" aria-hidden="true"></i></span><strong>Kein Repository ausgewählt</strong><p>Wähle links ein Repository oder passe den Filter an.</p></div>`}
    </section>
  </div>` : `<section class="git-page-empty"><span><i class="fa-solid fa-code-branch" aria-hidden="true"></i></span><h2>Noch keine Repositories</h2><p>DevHub zeigt hier jedes Git-Repository, das im gewählten Workspace erkannt wird.</p><button data-rescan-workspace>Workspace neu einlesen</button></section>`}`;
}

function renderWorkspaceNavigation() {
  const gitActive = state.page === "git";
  document.body.classList.toggle("git-page-active", gitActive);
  elements.projectsPage.hidden = gitActive;
  elements.gitPage.hidden = !gitActive;
  document.querySelectorAll("[data-page]").forEach((button) => {
    const active = button.dataset.page === "git" ? gitActive : !gitActive && (!button.dataset.filter || button.dataset.filter === state.filter);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.search.placeholder = gitActive ? "Repositories oder Branches durchsuchen …" : "Projekte durchsuchen …";
}

async function loadGitCommitSuggestion(projectId, force = false) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project?.git?.staged || state.gitSuggestionLoading.has(projectId)) return;
  if (!force && state.gitCommitMessages.has(projectId)) return;
  state.gitSuggestionLoading.add(projectId);
  renderGitSurfaces();
  try {
    const data = await api(`/api/projects/${projectId}/git/commit-message`);
    if (force || !state.gitCommitMessages.has(projectId)) {
      state.gitCommitMessages.set(projectId, data.message);
      state.gitSuggestedMessages.add(projectId);
    }
  } catch (error) {
    if (force) toast(error.message, "error");
  } finally {
    state.gitSuggestionLoading.delete(projectId);
    renderGitSurfaces();
  }
}

function loadGitSurfaceForProject(projectId, force = false) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project?.git) return;
  if (state.gitMode === "history") loadGitHistory(projectId, false, force);
  else {
    loadGitCommitSuggestion(projectId);
    const file = activeGitFile(project);
    if (file) loadGitDiff(project.id, file, force);
  }
}

function loadActiveGitSurface(force = false) {
  if (state.page === "git" && state.activeGitProjectId) loadGitSurfaceForProject(state.activeGitProjectId, force);
}

function setWorkspacePage(page, projectId = null) {
  const nextPage = page === "git" ? "git" : "projects";
  if (projectId) {
    state.activeGitProjectId = projectId;
    localStorage.setItem("devhub_git_project", projectId);
  }
  state.page = nextPage;
  elements.search.value = nextPage === "git" ? state.gitQuery : state.query;
  history.replaceState(null, "", nextPage === "git" ? "#git" : location.pathname + location.search);
  render(false);
  loadActiveGitSurface();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openGitWorkspace(projectId) {
  if (elements.projectDialog.open) elements.projectDialog.close();
  setWorkspacePage("git", projectId);
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
        <button class="favorite-button detail-favorite ${favorite ? "active" : ""}" data-favorite="${project.id}" aria-label="${favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}" aria-pressed="${favorite}">${favoriteIcon(favorite)}</button>
        <button class="project-dialog-close" data-close-project aria-label="Projektdetails schließen">×</button>
      </div>
      <p class="detail-description">${escapeHtml(project.description)}</p>
      <div class="detail-tech-list">${project.technologies.map((technology) => `<span class="tech-chip">${escapeHtml(technology)}</span>`).join("")}</div>
      <div class="detail-primary-actions">
        ${primaryAction(project)}
        <button class="detail-action-button" data-project-action="editor" data-project-id="${project.id}" ${state.capabilities?.editor.available ? "" : "disabled"}><i class="fa-solid fa-code" aria-hidden="true"></i><span>${escapeHtml(editorName)}</span></button>
        <button class="detail-action-button" data-project-action="terminal" data-project-id="${project.id}" ${state.capabilities?.terminal.available ? "" : "disabled"}><i class="fa-solid fa-terminal" aria-hidden="true"></i><span>Terminal</span></button>
        <button class="detail-action-button" data-project-action="folder" data-project-id="${project.id}"><i class="fa-regular fa-folder-open" aria-hidden="true"></i><span>Ordner</span></button>
        <button class="detail-action-button" data-copy-path="${project.id}"><i class="fa-regular fa-copy" aria-hidden="true"></i><span>Pfad</span></button>
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
  renderProjectDialog();
  if (!elements.projectDialog.open) elements.projectDialog.showModal();
  if (project.git) loadGitSurfaceForProject(projectId);
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
  elements.gitRepositoryCount.textContent = state.projects.filter((project) => project.git).length;
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
  elements.laragonToggle.classList.toggle("online", webRunning);
  elements.laragonToggle.classList.toggle("offline", !webRunning);
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
  renderGitPage();
  renderWorkspaceNavigation();
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
    loadActiveGitSurface();
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
    state.selectedGitFiles.clear();
    state.gitDiffs.clear();
    state.gitHistories.clear();
    for (const projectId of state.gitSuggestedMessages) state.gitCommitMessages.delete(projectId);
    state.gitSuggestedMessages.clear();
    state.gitSuggestionLoading.clear();
    render(false);
    loadActiveGitSurface(true);
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
    state.activeGitProjectId = null;
    state.activeGitFiles.clear();
    state.selectedGitFiles.clear();
    state.gitDiffs.clear();
    state.gitHistories.clear();
    state.gitCommitMessages.clear();
    state.gitSuggestedMessages.clear();
    state.gitSuggestionLoading.clear();
    state.activeGitCommits.clear();
    state.gitCommitDetails.clear();
    elements.workspaceDialog.close();
    render(false);
    loadActiveGitSurface();
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

function selectedGitFilePaths(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  return project?.git ? [...selectedGitFileSet(project)] : [];
}

function openGitDiscardDialog(projectId, files) {
  if (!files.length) return;
  state.pendingGitDiscard = { projectId, files };
  elements.discardCount.textContent = `${files.length} ${files.length === 1 ? "Datei ausgewählt" : "Dateien ausgewählt"}`;
  const shown = files.slice(0, 6);
  elements.discardFiles.innerHTML = shown.map((file) => `<code title="${escapeHtml(file)}">${escapeHtml(file)}</code>`).join("")
    + (files.length > shown.length ? `<span>+${files.length - shown.length} weitere</span>` : "");
  elements.discardDialog.showModal();
}

function runGitSelectionAction(projectId, action) {
  const files = selectedGitFilePaths(projectId);
  if (!files.length) return;
  if (action === "discard-files") openGitDiscardDialog(projectId, files);
  else runGitProjectAction(projectId, action, { files });
}

async function runGitProjectAction(projectId, action, payload = {}) {
  const projectIndex = state.projects.findIndex((item) => item.id === projectId);
  if (projectIndex < 0 || state.pendingGitAction) return false;
  state.pendingGitAction = `${projectId}:${action}`;
  if (elements.projectDialog.open) renderProjectDialog();
  if (state.page === "git") renderGitPage();
  try {
    const data = await api(`/api/projects/${projectId}/git/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    state.projects[projectIndex] = data.project;
    if (action === "commit") {
      state.gitCommitMessages.delete(projectId);
      state.gitSuggestedMessages.delete(projectId);
      state.activeGitCommits.delete(projectId);
    }
    if (["refresh", "stage", "unstage", "stage-files", "unstage-files", "stage-all", "unstage-all", "discard-files"].includes(action) && state.gitSuggestedMessages.has(projectId)) {
      state.gitCommitMessages.delete(projectId);
      state.gitSuggestedMessages.delete(projectId);
    }
    if (action === "discard-files") state.selectedGitFiles.delete(projectId);
    for (const key of state.gitDiffs.keys()) if (key.startsWith(`${projectId}\u0000`)) state.gitDiffs.delete(key);
    state.gitHistories.delete(projectId);
    toast(data.message);
    return true;
  } catch (error) {
    toast(error.message, "error");
    return false;
  } finally {
    state.pendingGitAction = null;
    render(false);
    if (elements.projectDialog.open || (state.page === "git" && state.activeGitProjectId === projectId)) loadGitSurfaceForProject(projectId, true);
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
  state.page = "projects";
  elements.search.value = state.query;
  history.replaceState(null, "", location.pathname + location.search);
  render(false);
}

function copyToClipboard(value, successMessage) {
  navigator.clipboard.writeText(value).then(() => toast(successMessage)).catch(() => toast("Kopieren war nicht möglich.", "error"));
}

function handleProjectInteraction(event) {
  const repository = event.target.closest("[data-git-repository]");
  if (repository) {
    state.activeGitProjectId = repository.dataset.gitRepository;
    localStorage.setItem("devhub_git_project", state.activeGitProjectId);
    renderGitPage();
    loadGitSurfaceForProject(state.activeGitProjectId);
    return;
  }
  const mode = event.target.closest("[data-git-mode]");
  if (mode) {
    state.gitMode = mode.dataset.gitMode === "history" ? "history" : "changes";
    localStorage.setItem("devhub_git_mode", state.gitMode);
    renderGitSurfaces();
    loadGitSurfaceForProject(mode.dataset.projectId);
    return;
  }
  const historyRetry = event.target.closest("[data-git-history-retry]");
  if (historyRetry) { loadGitHistory(historyRetry.dataset.gitHistoryRetry, false, true); return; }
  const historyMore = event.target.closest("[data-git-history-more]");
  if (historyMore) { loadGitHistory(historyMore.dataset.gitHistoryMore, true); return; }
  const historyCommit = event.target.closest("[data-git-commit]");
  if (historyCommit) { loadGitCommit(historyCommit.dataset.projectId, historyCommit.dataset.gitCommit); return; }
  const gitWorkspace = event.target.closest("[data-open-git-workspace]");
  if (gitWorkspace) { openGitWorkspace(gitWorkspace.dataset.openGitWorkspace); return; }
  const details = event.target.closest("[data-open-details]");
  if (details) { openProjectDetails(details.dataset.openDetails); return; }
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) { const id = favorite.dataset.favorite; state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id); localStorage.setItem("devhub_favorites", JSON.stringify([...state.favorites])); render(); return; }
  const selectAll = event.target.closest("[data-git-select-all]");
  if (selectAll) { selectAllGitFiles(selectAll.dataset.gitSelectAll, selectAll.checked); return; }
  const selectFile = event.target.closest("[data-git-select-file]");
  if (selectFile) { selectGitFile(selectFile.dataset.projectId, selectFile.dataset.gitSelectFile, true); return; }
  const selectionAction = event.target.closest("[data-git-selection-action]");
  if (selectionAction) { runGitSelectionAction(selectionAction.dataset.projectId, selectionAction.dataset.gitSelectionAction); return; }
  const suggestMessage = event.target.closest("[data-git-suggest-message]");
  if (suggestMessage) { loadGitCommitSuggestion(suggestMessage.dataset.gitSuggestMessage, true); return; }
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
  if (gitFile) { selectGitFile(gitFile.dataset.projectId, gitFile.dataset.gitFile, event.ctrlKey || event.metaKey); return; }
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
elements.gitPage.addEventListener("click", (event) => {
  const filter = event.target.closest("[data-git-filter]");
  if (filter) {
    state.gitFilter = filter.dataset.gitFilter;
    localStorage.setItem("devhub_git_filter", state.gitFilter);
    renderGitPage();
    return;
  }
  if (event.target.closest("[data-rescan-workspace]")) { rescan(); return; }
  handleProjectInteraction(event);
});
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
function handleGitComposerInput(event) {
  const input = event.target.closest("[data-commit-message]");
  if (!input) return;
  const projectId = input.dataset.commitMessage;
  const project = state.projects.find((item) => item.id === projectId);
  state.gitCommitMessages.set(projectId, input.value);
  state.gitSuggestedMessages.delete(projectId);
  const composer = input.closest(".commit-composer");
  composer?.classList.remove("suggested");
  const note = composer?.querySelector(".commit-composer-note");
  if (note) note.textContent = "Der Commit enthält nur vorgemerkte Dateien.";
  const status = composer?.querySelector(".commit-suggestion-status");
  if (status && project?.git) status.textContent = `${project.git.staged} vorgemerkt`;
  const commitButton = input.closest(".git-detail")?.querySelector('[data-git-action="commit"]');
  if (commitButton && project?.git) commitButton.disabled = !project.git.staged || input.value.trim().length < 3 || Boolean(state.pendingGitAction);
}

function handleGitKeyboard(event) {
  const fileList = event.target.closest(".git-file-list");
  if (fileList && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
    const row = fileList.querySelector("[data-git-file]");
    if (row) { event.preventDefault(); selectAllGitFiles(row.dataset.projectId, true); }
    return;
  }
  if (fileList && event.key === "Escape") {
    const row = fileList.querySelector("[data-git-file]");
    if (row) { event.preventDefault(); selectAllGitFiles(row.dataset.projectId, false); }
    return;
  }
  const commit = event.target.closest("[data-git-commit]");
  if (commit && event.target === commit && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault(); loadGitCommit(commit.dataset.projectId, commit.dataset.gitCommit); return;
  }
  const file = event.target.closest("[data-git-file]");
  if (file && event.target === file && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault(); selectGitFile(file.dataset.projectId, file.dataset.gitFile, event.ctrlKey || event.metaKey); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && event.target.matches("[data-commit-message]")) {
    const button = event.target.closest(".git-detail")?.querySelector('[data-git-action="commit"]');
    if (button && !button.disabled) { event.preventDefault(); button.click(); }
  }
}

elements.projectDialogContent.addEventListener("input", handleGitComposerInput);
elements.projectDialogContent.addEventListener("keydown", handleGitKeyboard);
elements.gitPage.addEventListener("input", handleGitComposerInput);
elements.gitPage.addEventListener("keydown", handleGitKeyboard);
elements.projectDialog.addEventListener("click", (event) => { if (event.target === elements.projectDialog) elements.projectDialog.close(); });
elements.projectDialog.addEventListener("close", () => { state.activeProjectId = null; });

document.querySelector("#view-filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]"); if (!button) return;
  if (button.dataset.filter) setViewFilter(button.dataset.filter);
  else setWorkspacePage(button.dataset.page);
});
document.querySelector("#mobile-workspace-tabs").addEventListener("click", (event) => { const button = event.target.closest("[data-page]"); if (button) setWorkspacePage(button.dataset.page); });
document.querySelector("#mobile-view-filters").addEventListener("click", (event) => { const button = event.target.closest("[data-mobile-filter]"); if (button) setViewFilter(button.dataset.mobileFilter); });
elements.mobileTech.addEventListener("change", () => { state.technology = elements.mobileTech.value || null; render(false); });
elements.techFilters.addEventListener("click", (event) => { const button = event.target.closest("[data-tech]"); if (!button) return; state.technology = state.technology === button.dataset.tech ? null : button.dataset.tech; render(false); });
elements.clearTech.addEventListener("click", () => { state.technology = null; render(false); });
elements.activeFilter.addEventListener("click", () => { state.technology = null; render(false); });
elements.search.addEventListener("input", () => {
  if (state.page === "git") state.gitQuery = elements.search.value;
  else state.query = elements.search.value;
  render(false);
});
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
elements.discardCancel.addEventListener("click", () => elements.discardDialog.close());
elements.discardConfirm.addEventListener("click", async () => {
  const pending = state.pendingGitDiscard;
  if (!pending || elements.discardConfirm.disabled) return;
  elements.discardConfirm.disabled = true;
  elements.discardConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Wird verworfen …';
  const success = await runGitProjectAction(pending.projectId, "discard-files", { files: pending.files });
  if (success && elements.discardDialog.open) elements.discardDialog.close();
  else {
    elements.discardConfirm.disabled = false;
    elements.discardConfirm.textContent = "Änderungen verwerfen";
  }
});
elements.discardDialog.addEventListener("click", (event) => { if (event.target === elements.discardDialog) elements.discardDialog.close(); });
elements.discardDialog.addEventListener("close", () => {
  state.pendingGitDiscard = null;
  elements.discardConfirm.disabled = false;
  elements.discardConfirm.textContent = "Änderungen verwerfen";
});
document.querySelector("#clear-log").addEventListener("click", () => { elements.logOutput.innerHTML = '<span class="log-placeholder">Ansicht geleert. Neue Ausgaben erscheinen weiterhin live.</span>'; });
elements.restartLog.addEventListener("click", () => { if (state.activeLogId) runLauncher(state.activeLogId, "restart"); });
elements.logDialog.addEventListener("close", () => { state.activeLogId = null; }); elements.logDialog.addEventListener("click", (event) => { if (event.target === elements.logDialog) elements.logDialog.close(); });
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") { event.preventDefault(); elements.search.focus(); elements.search.select(); }
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) { event.preventDefault(); elements.search.focus(); }
});

bootstrap();
