// The Git workspace owns its view state; project discovery and system actions stay in app.js.
export function createGitWorkspace({ root, state, api, renderApp, renderPatch, escapeHtml: esc, toast, projectAction, rescan }) {
  const rail = document.querySelector("#sidebar-git-repositories");
  const sessions = new Map();
  const cache = new Map();
  const pendingReads = new Map();
  const activity = [];
  let busy = null;
  let notice = null;
  let repoFilter = "all";
  let searchTimer;
  const icon = name => `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`;
  const selected = () => state.projects.find(p => p.id === state.activeGitProjectId);
  const session = id => {
    if (!sessions.has(id)) {
      let draft = {};
      try { draft = JSON.parse(sessionStorage.getItem(`devhub_git_draft_${id}`) || "{}"); } catch { /* invalid stored draft */ }
      sessions.set(id, { tab: "changes", file: null, scope: "working", fileQuery: "", branchQuery: "", historyQuery: "", historyAll: false, historyFile: "", commit: null, wrap: false, advanced: false, excluded: new Set(), ...draft, summary: draft.summary || "", description: draft.description || "", amend: false });
    }
    return sessions.get(id);
  };
  const saveDraft = id => { const s = session(id); sessionStorage.setItem(`devhub_git_draft_${id}`, JSON.stringify({ summary: s.summary, description: s.description })); };
  const key = (id, resource) => `${id}:${resource}`;
  const data = (id, resource) => cache.get(key(id, resource));
  const base = id => `/api/projects/${id}/git/`;
  const conflict = f => f.indexStatus === "U" || f.worktreeStatus === "U" || ["AA", "DD"].includes(f.indexStatus + f.worktreeStatus);
  const staged = f => !conflict(f) && ![".", "?"].includes(f.indexStatus);
  const working = f => conflict(f) || f.worktreeStatus !== ".";
  const includedFiles = p => p.git.files.filter(f => !session(p.id).excluded.has(f.path));
  const count = (p, filter) => p.git.files.filter(filter).length;
  const formatDate = date => date ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(date)) : "";
  const button = (label, action, attrs = "", disabled = false, style = "") => `<button type="button" class="gw-button ${style}" data-gw="${action}" ${attrs} ${disabled || busy ? "disabled" : ""}>${label}</button>`;
  const empty = (glyph, title, text, actions = "") => `<div class="gw-empty"><span class="gw-empty-icon">${icon(glyph)}</span><h3>${title}</h3><p>${text}</p>${actions}</div>`;
  const field = (label, name, value = "", options = "") => `<label class="gw-field"><span>${label}</span><input name="${name}" value="${esc(value)}" ${options}></label>`;
  const resourceError = value => value?.error ? `<div class="gw-resource-error" role="alert">${icon("triangle-exclamation")}<span>${esc(value.error)}</span>${button("Erneut laden", "refresh")}</div>` : "";

  async function read(id, resource, url, force = false) {
    const k = key(id, resource);
    if (!force && (cache.has(k) || pendingReads.has(k))) return;
    const ticket = {};
    pendingReads.set(k, ticket);
    try {
      const result = await api(base(id) + url);
      if (pendingReads.get(k) === ticket) cache.set(k, result);
    } catch (error) {
      if (pendingReads.get(k) === ticket) cache.set(k, { error: error.message });
    } finally {
      if (pendingReads.get(k) === ticket) pendingReads.delete(k);
      if (state.activeGitProjectId === id && state.page === "git") render();
    }
  }
  function invalidate(id) {
    for (const k of cache.keys()) if (k.startsWith(`${id}:`)) cache.delete(k);
    for (const k of pendingReads.keys()) if (k.startsWith(`${id}:`)) pendingReads.delete(k);
  }
  function ensure(id, force = false) {
    const p = state.projects.find(p => p.id === id);
    if (!p?.git) return;
    if (force) invalidate(id);
    const s = session(id);
    read(id, "workspace", "workspace");
    if (s.tab === "changes") {
      const available = p.git.files.filter(s.advanced ? (s.scope === "staged" ? staged : working) : () => true);
      if (!available.some(f => f.path === s.file)) s.file = available[0]?.path || null;
      if (s.file) read(id, `diff:${s.advanced ? "index" : "all"}:${s.file}`, `diff?file=${encodeURIComponent(s.file)}&combined=${!s.advanced}`);
    }
    if (s.tab === "history") {
      read(id, `history:${s.historyQuery}:${s.historyAll}`, `history?query=${encodeURIComponent(s.historyQuery)}&all=${s.historyAll}`);
      if (s.commit) read(id, `commit:${s.commit}:${s.historyFile}`, `commits/${s.commit}${s.historyFile ? `?file=${encodeURIComponent(s.historyFile)}` : ""}`);
    }
    if (s.tab === "stashes" && s.stash) {
      const stash = data(id, "workspace")?.stashes?.find(item => item.hash === s.stash);
      if (stash) read(id, `stash:${stash.hash}`, `stash-diff?stash=${encodeURIComponent(stash.ref)}&hash=${stash.hash}`);
    }
  }

  function repositoryRail(repositories) {
    const q = state.gitQuery.toLocaleLowerCase();
    const filtered = repositories.filter(p => `${p.name} ${p.relativePath} ${p.git.branch}`.toLocaleLowerCase().includes(q) && (repoFilter === "all" || (repoFilter === "changed" ? p.git.dirty : p.git.ahead || p.git.behind)));
    return `<aside class="gw-repositories" aria-label="Repositories"><header><span>REPOSITORIES <b>${repositories.length}</b></span>${button(icon("plus"), "add", 'aria-label="Repository hinzufügen" title="Repository klonen oder anlegen"', false, "gw-icon-button")}</header>
      <label class="gw-search">${icon("magnifying-glass")}<input type="search" data-gw-input="repoQuery" data-focus-key="gw-repo-search" aria-label="Repositories durchsuchen" placeholder="Repository suchen …" value="${esc(state.gitQuery)}"></label>
      <div class="gw-segments" aria-label="Repositories filtern">${[["all", "Alle"], ["changed", "Geändert"], ["sync", "Sync"]].map(([value, label]) => button(label, "filter", `data-value="${value}" aria-pressed="${repoFilter === value}"`, false, repoFilter === value ? "active" : "")).join("")}</div>
      <div class="gw-repo-list" data-gw-scroll="repositories">${filtered.map(p => `<button class="gw-repo ${p.id === state.activeGitProjectId ? "active" : ""}" data-gw="repository" data-id="${p.id}" aria-pressed="${p.id === state.activeGitProjectId}"><span class="gw-repo-icon">${icon("book-bookmark")}</span><span><strong>${esc(p.name)}</strong><small>${icon("code-branch")} ${esc(p.git.branch || "Detached HEAD")}</small></span><span class="gw-repo-count ${p.git.files.some(conflict) ? "conflict" : p.git.dirty ? "dirty" : "clean"}">${p.git.dirty ? p.git.changedFiles : icon("check")}</span></button>`).join("") || `<p class="gw-list-empty">Keine passenden Repositories.</p>`}</div>
      <footer><span class="gw-live-dot"></span><span>Lokaler Workspace</span><small>${repositories.filter(p => p.git.dirty).length} geändert</small></footer></aside>`;
  }
  function toolbar(p, w) {
    const g = p.git;
    return `<header class="gw-toolbar"><div class="gw-repo-title"><span class="gw-repo-icon">${icon("book-bookmark")}</span><div><h2>${esc(p.name)}</h2><code title="${esc(p.relativePath)}">${esc(p.relativePath)}</code></div></div>
      <button class="gw-current-branch" data-gw="tab" data-value="branches" title="Branches wechseln und verwalten">${icon("code-branch")}<span><small>Aktueller Branch</small><strong>${esc(g.branch || "Detached HEAD")}</strong></span>${icon("chevron-down")}</button>
      <div class="gw-sync-actions">${button(icon(busy?.action === "fetch" ? "spinner fa-spin" : "rotate") + " Fetch", "fetch", 'title="Remote-Stand abrufen"', !g.remoteName)}${button(icon("arrow-down") + ` Pull${g.behind ? ` <b>${g.behind}</b>` : ""}`, "pull", 'title="Remote-Commits per Fast-forward übernehmen"', !g.upstream || !g.behind || !!w?.operation)}${button(icon("arrow-up") + (g.upstream ? ` Push${g.ahead ? ` <b>${g.ahead}</b>` : ""}` : " Veröffentlichen"), "push", 'title="Commits zum Remote übertragen"', !g.remoteName || !g.lastCommit || !g.branch || (!!g.upstream && !g.ahead) || !!w?.operation, "gw-primary")}</div>
      <div class="gw-tools">${button(icon("code"), "editor", 'aria-label="Im Editor öffnen" title="Im Editor öffnen"', !state.capabilities?.editor.available, "gw-icon-button")}${button(icon("terminal"), "terminal", 'aria-label="Terminal öffnen" title="Terminal öffnen"', !state.capabilities?.terminal.available, "gw-icon-button")}${button(icon("rotate"), "refresh", 'aria-label="Git-Status aktualisieren" title="Aktualisieren · ⌘/Ctrl R"', false, "gw-icon-button")}</div></header>`;
  }
  function navigation(p, w) {
    const s = session(p.id);
    const tabs = [["changes", "code-branch", "Änderungen", p.git.changedFiles], ["history", "clock-rotate-left", "Verlauf"], ["branches", "diagram-project", "Branches"], ["stashes", "box-archive", "Stashes", w?.stashes?.length], ["tags", "tag", "Tags"], ["settings", "sliders", "Repository"]];
    return `<nav class="gw-tabs" aria-label="Git-Arbeitsbereich">${tabs.map(([value, glyph, label, total]) => button(`${icon(glyph)}<span>${label}</span>${total ? `<b>${total}</b>` : ""}`, "tab", `data-value="${value}" aria-pressed="${s.tab === value}"`, false, s.tab === value ? "active" : "")).join("")}<span class="gw-branch-status">${p.git.dirty ? '<i class="gw-dot dirty"></i> Änderungen vorhanden' : '<i class="gw-dot clean"></i> Arbeitsbaum sauber'}</span></nav>`;
  }
  function operationBanner(p, w) {
    const conflicts = count(p, conflict);
    if (!w?.operation && !conflicts) return "";
    return `<div class="gw-operation" role="status">${icon("triangle-exclamation")}<div><strong>${w?.operation ? `${esc(w.operation)} in Bearbeitung` : "Konflikte auflösen"}</strong><span>${conflicts ? `${conflicts} Datei${conflicts === 1 ? "" : "en"} mit Konflikten. Im Editor auflösen und anschließend vormerken.` : "Alle Konflikte sind vorgemerkt. Du kannst den Vorgang fortsetzen."}</span></div>${button("Änderungen zeigen", "tab", 'data-value="changes"')}${w?.operation ? button("Abbrechen …", "confirm-abort") + button("Fortsetzen", "continue", "", conflicts > 0, "gw-primary") : ""}</div>`;
  }
  function composer(p) {
    const s = session(p.id);
    const w = data(p.id, "workspace");
    const total = s.advanced ? count(p, staged) : includedFiles(p).length;
    const ready = s.summary.trim().length >= 3 && (total > 0 || (s.advanced && s.amend)) && !count(p, conflict) && !w?.operation;
    return `<form class="gw-composer" data-gw-form="commit"><div class="gw-composer-heading"><span>${icon("code-commit")} ${s.amend ? "Letzten Commit bearbeiten" : "Neuer Commit"}</span><small>${total} ${s.advanced ? "im Index" : "ausgewählt"}</small></div>
      <div class="gw-summary-field"><input name="summary" data-gw-input="summary" data-focus-key="gw-summary" aria-label="Commit-Zusammenfassung" placeholder="Zusammenfassung (erforderlich)" value="${esc(s.summary)}" maxlength="200" autocomplete="off">${button(icon("wand-magic-sparkles"), "suggest", 'aria-label="Commit-Nachricht vorschlagen" title="Nachricht aus vorgemerkten Dateien vorschlagen"', !total, "gw-icon-button")}</div>
      <textarea name="description" data-gw-input="description" data-focus-key="gw-description" aria-label="Commit-Beschreibung" placeholder="Beschreibung (optional)" maxlength="10000" rows="3">${esc(s.description)}</textarea>
      <div class="gw-composer-options"><label><input type="checkbox" data-gw-input="amend" ${s.amend ? "checked" : ""} ${!p.git.lastCommit || !p.git.branch || (p.git.upstream && !p.git.ahead) || busy || w?.operation ? "disabled" : ""}> Letzten Commit ändern</label><span title="Tastenkürzel zum Committen">⌘ / Ctrl ↵</span></div>
      <button type="submit" class="gw-button gw-primary gw-commit-submit" ${!ready || busy ? "disabled" : ""}>${icon(["commit", "amend", "commit-files", "amend-files"].includes(busy?.action) ? "spinner fa-spin" : "check")}<span>${s.amend ? "Commit aktualisieren" : `Commit auf ${esc(p.git.branch || "Detached HEAD")}`}</span></button>
      <small class="gw-identity">${icon("circle-user")} ${esc(w?.identity?.name || "Commit-Identität einrichten")} ${!w?.identity?.name ? button("Einrichten", "tab", 'data-value="settings"', false, "gw-link") : ""}</small></form>`;
  }
  function changeView(p) {
    const s = session(p.id);
    if (s.advanced) return `<div class="gw-advanced-view"><div class="gw-advanced-note"><span>Erweiterter Modus · einzelne Abschnitte im Git-Index vorbereiten</span>${button("Zur Dateiauswahl", "simple-mode")}</div>${indexView(p)}</div>`;
    const files = p.git.files;
    const visible = files.filter(f => f.path.toLocaleLowerCase().includes(s.fileQuery.toLocaleLowerCase()));
    const chosen = includedFiles(p).length;
    if (!files.some(f => f.path === s.file)) s.file = files[0]?.path || null;
    return `<div class="gw-changes"><section class="gw-change-list"><header class="gw-quick-heading"><strong>Änderungen <b>${files.length}</b></strong>${button(icon("sliders"), "advanced-mode", 'aria-label="Erweiterte Auswahl einzelner Diff-Abschnitte" title="Erweitert: einzelne Diff-Abschnitte"', false, "gw-icon-button")}</header>
      <label class="gw-search">${icon("magnifying-glass")}<input type="search" data-gw-input="fileQuery" data-focus-key="gw-file-search" aria-label="Dateien filtern" placeholder="Dateien filtern …" value="${esc(s.fileQuery)}"></label>
      <div class="gw-file-list-actions"><label class="gw-select-all"><input type="checkbox" data-gw-input="selectAll" data-focus-key="gw-check-all" aria-label="Alle Dateien für den Commit auswählen" ${chosen === files.length && files.length ? "checked" : ""} ${!files.length || busy ? "disabled" : ""}><span>${chosen} von ${files.length} ausgewählt</span></label></div>
      <div class="gw-files" data-gw-scroll="files" aria-label="Dateien für den Commit">${visible.map(f => {
        const name = f.path.split("/").pop(); const dir = f.path.slice(0, -name.length); const status = conflict(f) ? "U" : f.worktreeStatus === "?" ? "A" : f.worktreeStatus !== "." ? f.worktreeStatus : f.indexStatus;
        return `<div class="gw-file gw-check-file ${s.file === f.path ? "active" : ""} ${s.excluded.has(f.path) ? "excluded" : ""}"><input type="checkbox" data-gw-input="includeFile" data-focus-key="gw-check-${esc(f.path)}" data-path="${esc(f.path)}" aria-label="${esc(f.path)} in Commit aufnehmen" ${s.excluded.has(f.path) ? "" : "checked"} ${busy ? "disabled" : ""}><button data-gw="file" data-path="${esc(f.path)}" aria-pressed="${s.file === f.path}" title="${esc(f.path)}"><span class="gw-file-name"><strong>${esc(name)}</strong>${dir ? `<small>${esc(dir)}</small>` : ""}${f.originalPath ? `<small>← ${esc(f.originalPath)}</small>` : ""}</span><b class="gw-status status-${esc(status)}">${esc(status)}</b></button>${button(icon("ellipsis"), "file-menu", `data-path="${esc(f.path)}" aria-label="Aktionen für ${esc(f.path)}" title="Datei oder Ordner ignorieren"`, false, "gw-icon-button")}</div>`;
      }).join("") || `<div class="gw-list-empty">${files.length ? "Keine passenden Dateien." : "Keine Änderungen. Dein Arbeitsbaum ist sauber."}</div>`}${p.git.filesTruncated ? '<p class="gw-list-empty">Die ersten 500 Dateien werden angezeigt. Die Auswahl gilt für diese Dateien.</p>' : ""}</div>
      <div class="gw-stash-shortcut">${button(icon("box-archive") + " Änderungen im Stash sichern …", "stash-save-dialog", "", !p.git.dirty || !p.git.lastCommit || !!count(p, conflict), "gw-link")}</div>${composer(p)}</section>${diffView(p)}</div>`;
  }
  function indexView(p) {
    const s = session(p.id);
    const files = p.git.files.filter(s.advanced ? (s.scope === "staged" ? staged : working) : () => true);
    if (!files.some(f => f.path === s.file)) s.file = files[0]?.path || null;
    const visible = files.filter(f => f.path.toLocaleLowerCase().includes(s.fileQuery.toLocaleLowerCase()));
    const canStash = p.git.dirty && !!p.git.lastCommit && !count(p, conflict);
    return `<div class="gw-changes"><section class="gw-change-list"><div class="gw-change-switch" aria-label="Änderungen filtern">${button(`Arbeitsbaum <b>${count(p, working)}</b>`, "scope", 'data-value="working"', false, s.scope === "working" ? "active" : "")}${button(`Vorgemerkt <b>${count(p, staged)}</b>`, "scope", 'data-value="staged"', false, s.scope === "staged" ? "active" : "")}</div>
      <label class="gw-search">${icon("magnifying-glass")}<input type="search" data-gw-input="fileQuery" data-focus-key="gw-file-search" aria-label="Dateien filtern" placeholder="Dateien filtern …" value="${esc(s.fileQuery)}"></label>
      <div class="gw-file-list-actions"><span>${files.length} Datei${files.length === 1 ? "" : "en"}</span>${button(s.scope === "working" ? "Alle vormerken" : "Alle lösen", s.scope === "working" ? "stage-all" : "unstage-all", "", !files.length, "gw-link")}</div>
      <div class="gw-files" data-gw-scroll="files" aria-label="Geänderte Dateien">${visible.map(f => {
        const name = f.path.split("/").pop(); const dir = f.path.slice(0, -name.length); const status = conflict(f) ? "U" : s.scope === "staged" ? f.indexStatus : f.worktreeStatus;
        return `<div class="gw-file ${s.file === f.path ? "active" : ""}"><button data-gw="file" data-path="${esc(f.path)}" aria-pressed="${s.file === f.path}" title="${esc(f.path)}"><span class="gw-file-type ${status === "U" ? "conflict" : ""}">${icon(status === "U" ? "triangle-exclamation" : "file-lines")}</span><span class="gw-file-name"><strong>${esc(name)}</strong>${dir ? `<small>${esc(dir)}</small>` : ""}${f.originalPath ? `<small>← ${esc(f.originalPath)}</small>` : ""}</span><b class="gw-status status-${esc(status)}" title="${esc(({ M: "Geändert", A: "Neu", D: "Gelöscht", R: "Umbenannt", U: "Konflikt", "?": "Neue Datei" })[status] || status)}">${status === "?" ? "A" : esc(status)}</b></button>${button(icon(s.scope === "staged" ? "minus" : "plus"), s.scope === "staged" ? "unstage-file" : "stage-file", `data-path="${esc(f.path)}" title="${s.scope === "staged" ? "Vormerkung lösen" : "Datei vormerken"}" aria-label="${s.scope === "staged" ? "Vormerkung lösen" : "Datei vormerken"}: ${esc(f.path)}"`, false, "gw-icon-button")}</div>`;
      }).join("") || `<div class="gw-list-empty">${icon(files.length ? "magnifying-glass" : "check")}<strong>${files.length ? "Keine passenden Dateien" : s.scope === "staged" ? "Noch nichts vorgemerkt" : "Keine lokalen Änderungen"}</strong><span>${s.scope === "staged" ? "Mit + Dateien für den nächsten Commit vormerken." : "Hier erscheinen deine Änderungen."}</span></div>`}${p.git.filesTruncated ? '<p class="gw-list-empty">Die ersten 500 Dateien werden angezeigt. „Alle vormerken“ erfasst auch weitere Dateien.</p>' : ""}</div>
      <div class="gw-stash-shortcut">${button(icon("box-archive") + " Änderungen im Stash sichern …", "stash-save-dialog", "", !canStash, "gw-link")}</div>${composer(p)}</section>${diffView(p)}</div>`;
  }
  function patchView(patch, wrap = false) { return `<div class="gw-patch ${wrap ? "wrap" : ""}">${renderPatch(patch)}</div>`; }
  function diffView(p) {
    const s = session(p.id);
    const f = p.git.files.find(f => f.path === s.file);
    if (!f) return `<section class="gw-diff">${empty(s.scope === "staged" ? "layer-group" : "check", s.scope === "staged" ? "Bereit für deinen nächsten Commit" : "Alles auf dem aktuellen Stand", s.scope === "staged" ? "Merke Dateien oder einzelne Abschnitte im Arbeitsbaum vor. Hier prüfst du genau das, was dein Commit enthalten wird." : "Dein Arbeitsbaum ist sauber. Starte eine neue Änderung, wechsle den Branch oder sieh dir den Verlauf an.", button(icon("clock-rotate-left") + " Verlauf ansehen", "tab", 'data-value="history"'))}</section>`;
    const result = data(p.id, `diff:${s.advanced ? "index" : "all"}:${f.path}`);
    const section = result?.sections?.find(section => section.scope === (s.advanced ? s.scope : "working"));
    const patch = section?.patch || "";
    const additions = patch.split("\n").filter(l => /^\+(?!\+\+)/.test(l)).length;
    const deletions = patch.split("\n").filter(l => /^-(?!--)/.test(l)).length;
    const title = `<header class="gw-diff-header"><div>${icon("file-code")}<strong title="${esc(f.path)}">${esc(f.path)}</strong><span class="gw-diff-stats"><b>+${additions}</b><b>−${deletions}</b></span></div><div>${button(icon("text-width"), "wrap", `aria-label="Zeilenumbruch umschalten" title="Lange Zeilen umbrechen" aria-pressed="${s.wrap}"`, false, "gw-icon-button")}${button(icon("copy"), "copy-file", 'aria-label="Dateipfad kopieren" title="Dateipfad kopieren"', false, "gw-icon-button")}${button(icon("ban") + " Ignorieren …", "file-menu", `data-path="${esc(f.path)}"`, false, "gw-link")}${button(icon("rotate-left") + " Verwerfen …", "discard", `data-path="${esc(f.path)}"`, false, "gw-danger-link")}</div></header>`;
    let content;
    if (result?.error) content = resourceError(result);
    else if (!result) content = empty("spinner fa-spin", "Diff wird geladen", "Änderungen werden eingelesen …");
    else if (/^Binary files |^GIT binary patch/m.test(patch)) content = empty("file-image", "Binärdatei geändert", "Für diese Datei ist kein Textvergleich verfügbar. Du kannst sie als Ganzes vormerken oder im Editor öffnen.", button("Im Editor öffnen", "editor"));
    else if (!patch) content = empty("file-lines", "Kein Text-Diff vorhanden", "Die Änderung betrifft Dateimetadaten, einen Submodul-Verweis oder eine leere Datei.");
    else {
      const start = patch.indexOf("\n@@ ");
      const hunks = start < 0 ? [] : patch.slice(start + 1).split(/(?=^@@ )/m);
      const canHunk = s.advanced && !section.truncated && !/^(old|new) mode /m.test(patch) && !f.originalPath && !conflict(f) && ["M", "."].includes(f.indexStatus) && ["M", "."].includes(f.worktreeStatus) && hunks.length;
      content = canHunk ? hunks.map((hunk, index) => `<section class="gw-hunk"><header><span>Abschnitt ${index + 1} von ${hunks.length}</span>${button(icon(s.scope === "staged" ? "minus" : "plus") + (s.scope === "staged" ? " Abschnitt lösen" : " Abschnitt vormerken"), "hunk", `data-index="${index}"`, false, "gw-link")}</header>${patchView(hunk, s.wrap)}</section>`).join("") : patchView(patch, s.wrap);
    }
    return `<section class="gw-diff">${title}${conflict(f) ? `<div class="gw-conflict-guide">${icon("triangle-exclamation")}<span>Konflikt im Editor bearbeiten, Konfliktmarkierungen entfernen und die Datei als gelöst markieren.</span>${button("Editor öffnen", "editor")}</div>` : ""}<div class="gw-diff-content" data-gw-scroll="diff">${content}${section?.truncated ? '<p class="gw-limit">Großer Diff gekürzt. Für den vollständigen Inhalt den Editor öffnen.</p>' : ""}</div><footer class="gw-diff-footer"><span>${s.advanced ? (s.scope === "staged" ? "Index · Inhalt des nächsten Commits" : "Arbeitsbaum") : s.excluded.has(f.path) ? "Vom nächsten Commit ausgeschlossen" : "Im nächsten Commit enthalten"}</span>${conflict(f) ? button("Als gelöst markieren", "stage-file", `data-path="${esc(f.path)}"`) : s.advanced ? button(s.scope === "staged" ? "Datei aus Index lösen" : "Datei in Index aufnehmen", s.scope === "staged" ? "unstage-file" : "stage-file", `data-path="${esc(f.path)}"`, false, "gw-link") : button(s.excluded.has(f.path) ? "In Commit aufnehmen" : "Von Commit ausschließen", "toggle-include", `data-path="${esc(f.path)}"`, false, "gw-link")}</footer></section>`;
  }

  function historyView(p) {
    const s = session(p.id);
    const history = data(p.id, `history:${s.historyQuery}:${s.historyAll}`);
    if (!s.commit && history?.commits?.length) { s.commit = history.commits[0].hash; queueMicrotask(() => ensure(p.id)); }
    const detail = s.commit ? data(p.id, `commit:${s.commit}:${s.historyFile}`) : null;
    const current = history?.commits?.find(c => c.hash === s.commit);
    const detailPatch = detail?.patch;
    return `<div class="gw-history"><aside class="gw-history-list"><label class="gw-search">${icon("magnifying-glass")}<input type="search" data-gw-input="historyQuery" data-focus-key="gw-history-search" aria-label="Commits durchsuchen" placeholder="Commit-Nachricht suchen …" value="${esc(s.historyQuery)}"></label><label class="gw-history-all"><input type="checkbox" data-gw-input="historyAll" ${s.historyAll ? "checked" : ""}> Alle Branches anzeigen</label><div class="gw-commits" data-gw-scroll="commits">${resourceError(history)}${history?.commits?.map(c => `<button data-gw="commit-detail" data-hash="${c.hash}" class="gw-history-row ${s.commit === c.hash ? "active" : ""}" aria-pressed="${s.commit === c.hash}"><span class="gw-graph-node ${c.parents.length > 1 ? "merge" : ""}">${icon(c.parents.length > 1 ? "code-merge" : "code-commit")}</span><span><strong>${esc(c.subject)}</strong><small>${esc(c.author)} · ${formatDate(c.date)}</small><code>${esc(c.shortHash)}</code></span></button>`).join("") || (!history ? '<p class="gw-list-empty">Verlauf wird geladen …</p>' : '<p class="gw-list-empty">Keine Commits gefunden.</p>')}</div>${history?.hasMore ? button("Weitere Commits laden", "history-more", "", pendingReads.has(key(p.id, "history-more")), "gw-history-more") : ""}</aside>
      <section class="gw-history-detail">${detail?.error ? resourceError(detail) : detail ? `<header class="gw-commit-detail-header"><div class="gw-commit-caption">${icon("code-commit")} COMMIT <button class="gw-hash" data-gw="copy-hash" title="Vollständigen Commit-Hash kopieren">${esc(detail.shortHash)} ${icon("copy")}</button>${detail.parents.length > 1 ? '<span class="gw-badge">Merge</span>' : ""}</div><h3>${esc(detail.subject)}</h3><p>${esc(detail.author)} <span>· ${formatDate(detail.date)} · ${detail.files.length} Dateien</span></p>${detail.body ? `<pre class="gw-commit-body">${esc(detail.body)}</pre>` : ""}<div class="gw-inline-actions">${button(icon("rotate-left") + " Revert …", "revert-dialog", `data-hash="${detail.hash}"`, p.git.dirty || detail.parents.length > 1)}${button(icon("code-commit") + " Cherry-pick …", "cherry-pick-dialog", `data-hash="${detail.hash}"`, p.git.dirty || detail.parents.length > 1)}${button(icon("tag") + " Tag erstellen …", "create-tag-dialog", `data-hash="${detail.hash}"`)}</div></header>
      <label class="gw-commit-file-select"><span>${icon("file-lines")} Änderungen</span><select data-gw-input="historyFile" aria-label="Datei im Commit auswählen"><option value="">Alle ${detail.files.length} Dateien</option>${detail.files.map(f => `<option value="${esc(f.path)}" ${s.historyFile === f.path ? "selected" : ""}>${esc(f.status)} · ${esc(f.path)}</option>`).join("")}</select></label><div class="gw-diff-content" data-gw-scroll="history-diff">${detailPatch ? patchView(detailPatch, s.wrap) : empty("file-lines", "Kein Text-Diff", "Für diese Auswahl ist kein Textvergleich verfügbar.")}${detail.truncated ? '<p class="gw-limit">Großer Commit-Diff wurde gekürzt.</p>' : ""}</div>` : empty(current ? "spinner fa-spin" : "clock-rotate-left", current ? "Commit wird geladen" : "Deine Projektgeschichte", "Wähle einen Commit, um Nachricht, Dateien und Änderungen zu prüfen.")}</section></div>`;
  }
  function branchView(p, w) {
    const s = session(p.id);
    const branches = (w?.branches || []).filter(b => b.name.toLocaleLowerCase().includes(s.branchQuery.toLocaleLowerCase()));
    const row = b => `<article class="gw-branch-row"><span class="gw-branch-glyph ${b.current ? "current" : ""}">${icon(b.remote ? "cloud" : "code-branch")}</span><div class="gw-row-copy"><strong>${esc(b.name)} ${b.current ? '<span class="gw-badge">Aktuell</span>' : ""}</strong><small>${b.upstream ? `Verfolgt ${esc(b.upstream)} · ` : ""}${formatDate(b.lastCommitDate)}</small></div><div class="gw-row-actions">${!b.current ? button(b.remote ? "Lokal auschecken" : "Wechseln", b.remote ? "checkout-remote" : "checkout", `data-branch="${esc(b.name)}"`) + button("Vergleichen", "compare", `data-branch="${esc(b.name)}"`) : ""}${!b.current && p.git.branch ? button("Integrieren …", "integrate-dialog", `data-branch="${esc(b.name)}"`, p.git.dirty || !!w?.operation) : ""}${!b.remote ? button(icon("pen"), "rename-branch-dialog", `data-branch="${esc(b.name)}" aria-label="Branch ${esc(b.name)} umbenennen" title="Branch umbenennen"`, false, "gw-icon-button") : ""}${!b.current && !b.remote ? button(icon("trash-can"), "delete-branch-dialog", `data-branch="${esc(b.name)}" aria-label="Branch ${esc(b.name)} löschen" title="Zusammengeführten Branch löschen"`, false, "gw-icon-button gw-danger-link") : ""}</div></article>`;
    return `<section class="gw-management"><header class="gw-section-heading"><div><h3>Branches</h3><p>Arbeitsstände wechseln, vergleichen und zusammenführen.</p></div>${button(icon("plus") + " Neuer Branch", "create-branch-dialog", "", false, "gw-primary")}</header><label class="gw-search gw-management-search">${icon("magnifying-glass")}<input type="search" data-gw-input="branchQuery" data-focus-key="gw-branch-search" aria-label="Branches durchsuchen" placeholder="Branch suchen …" value="${esc(s.branchQuery)}"></label>${resourceError(w)}
      ${[false, true].map(remote => `<section class="gw-card"><header><h4>${remote ? "Remote-Branches" : "Lokale Branches"}</h4><span>${branches.filter(b => !!b.remote === remote).length}</span></header>${branches.filter(b => !!b.remote === remote).map(row).join("") || `<p class="gw-card-note">${remote ? "Keine Remote-Branches. Mit Fetch den aktuellen Stand abrufen." : "Keine passenden lokalen Branches."}</p>`}</section>`).join("")}
      ${s.comparison ? `<section class="gw-card gw-comparison"><header><div><h4>Änderungen aus ${esc(s.comparison)}</h4><p>Vergleich seit dem gemeinsamen Ausgangscommit mit ${esc(p.git.branch || "HEAD")}.</p></div>${button("Schließen", "close-comparison")}</header>${resourceError(data(p.id, `compare:${s.comparison}`))}${data(p.id, `compare:${s.comparison}`)?.patch ? patchView(data(p.id, `compare:${s.comparison}`).patch) : '<p class="gw-card-note">Keine Textänderungen oder Vergleich wird geladen …</p>'}</section>` : ""}</section>`;
  }
  function stashView(p, w) {
    const s = session(p.id);
    const current = w?.stashes?.find(stash => stash.hash === s.stash);
    const patch = current ? data(p.id, `stash:${current.hash}`) : null;
    return `<section class="gw-management"><header class="gw-section-heading"><div><h3>Stashes</h3><p>Änderungen zwischenspeichern und später weiterarbeiten.</p></div>${button(icon("plus") + " Änderungen sichern", "stash-save-dialog", "", !p.git.dirty || !p.git.lastCommit || !!count(p, conflict), "gw-primary")}</header>${resourceError(w)}${w?.stashes?.length ? `<div class="gw-card">${w.stashes.map(stash => `<article class="gw-stash-row"><span class="gw-branch-glyph">${icon("box-archive")}</span><div class="gw-row-copy"><strong>${esc(stash.subject)}</strong><small>${esc(stash.ref)} · ${formatDate(stash.date)}</small></div><div class="gw-row-actions">${button("Ansehen", "stash-detail", `data-hash="${stash.hash}"`)}${button("Anwenden …", "stash-apply-dialog", `data-hash="${stash.hash}"`, p.git.dirty)}${button(icon("trash-can"), "stash-drop-dialog", `data-hash="${stash.hash}" aria-label="Stash löschen: ${esc(stash.subject)}" title="Stash löschen"`, false, "gw-icon-button gw-danger-link")}</div></article>`).join("")}</div>` : empty("box-archive", "Platz für deinen Zwischenstand", "Sichere offene Änderungen inklusive neuer Dateien, um mit einem sauberen Arbeitsbaum auf einem anderen Branch weiterzuarbeiten.")}${current ? `<section class="gw-card gw-comparison"><header><h4>${esc(current.subject)}</h4></header>${resourceError(patch)}${patch?.patch ? patchView(patch.patch) : '<p class="gw-card-note">Diff wird geladen oder enthält keine Textänderungen.</p>'}${patch?.truncated ? '<p class="gw-limit">Großer Stash-Diff gekürzt.</p>' : ""}</section>` : ""}</section>`;
  }
  function tagsView(p, w) {
    return `<section class="gw-management"><header class="gw-section-heading"><div><h3>Tags & Releases</h3><p>Versionen markieren und einzelne Tags veröffentlichen.</p></div>${button(icon("plus") + " Neues Tag", "create-tag-dialog", "", !p.git.lastCommit, "gw-primary")}</header>${resourceError(w)}${w?.tags?.length ? `<section class="gw-card">${w.tags.map(tag => `<article class="gw-tag-row"><span class="gw-branch-glyph">${icon("tag")}</span><div class="gw-row-copy"><strong>${esc(tag.name)}</strong><small>${esc(tag.subject)} · ${formatDate(tag.date)}</small></div><div class="gw-row-actions">${button(icon("arrow-up") + " Veröffentlichen …", "push-tag-dialog", `data-name="${esc(tag.name)}"`, !w.remotes.length)}${button(icon("trash-can"), "delete-tag-dialog", `data-name="${esc(tag.name)}" aria-label="Lokales Tag ${esc(tag.name)} löschen" title="Lokales Tag löschen"`, false, "gw-icon-button gw-danger-link")}</div></article>`).join("")}</section>` : empty("tags", "Meilensteine festhalten", "Erstelle ein Tag auf dem aktuellen Commit oder wähle einen Commit im Verlauf.")}</section>`;
  }
  function settingsView(p, w) {
    return `<section class="gw-management"><header class="gw-section-heading"><div><h3>Repository</h3><p>Remotes, Commit-Identität und Werkzeuge für ${esc(p.name)}.</p></div>${button(icon("folder-open") + " Ordner öffnen", "folder")}</header>${resourceError(w)}<div class="gw-settings-grid"><section class="gw-card"><header><h4>${icon("cloud")} Remotes</h4>${button(icon("plus") + " Hinzufügen", "remote-add-dialog")}</header>${w?.remotes?.map(remote => `<article class="gw-remote-row"><div class="gw-row-copy"><strong>${esc(remote.name)}</strong><code title="${esc(remote.url)}">${esc(remote.url)}</code></div><div class="gw-row-actions">${button(icon("pen"), "remote-edit-dialog", `data-name="${esc(remote.name)}" aria-label="Remote ${esc(remote.name)} bearbeiten"`, false, "gw-icon-button")}${button(icon("trash-can"), "remote-remove-dialog", `data-name="${esc(remote.name)}" aria-label="Remote ${esc(remote.name)} entfernen"`, false, "gw-icon-button gw-danger-link")}</div></article>`).join("") || '<p class="gw-card-note">Noch kein Remote eingerichtet. Verbinde ein Repository, um Commits zu synchronisieren.</p>'}</section>
      <section class="gw-card"><header><h4>${icon("circle-user")} Commit-Identität</h4><span>Nur dieses Repository</span></header><form class="gw-settings-form" data-gw-form="identity">${field("Name", "name", w?.identity?.name, 'required maxlength="200" autocomplete="name"')}${field("E-Mail-Adresse", "email", w?.identity?.email, 'type="email" required maxlength="200" autocomplete="email"')}<p>Diese Identität erscheint in neu erstellten Commits.</p><button class="gw-button" ${busy || !w || w.error ? "disabled" : ""}>Identität speichern</button></form></section>
      <section class="gw-card"><header><h4>${icon("rotate-left")} Letzter Commit</h4></header><div class="gw-settings-form"><strong>${esc(p.git.lastCommit?.subject || "Noch keine Commits")}</strong><p>Den letzten lokalen Commit zurücknehmen. Seine Änderungen bleiben im Index vorgemerkt.</p>${button("Letzten Commit zurücknehmen …", "undo-dialog", "", !p.git.lastCommit || !p.git.branch || (!!p.git.upstream && !p.git.ahead) || !!w?.operation)}</div></section>
      <section class="gw-card"><header><h4>${icon("list-check")} Aktivität dieser Sitzung</h4></header><div class="gw-activity">${activity.filter(a => a.id === p.id).slice(0, 12).map(a => `<div class="${a.error ? "error" : ""}">${icon(a.error ? "circle-exclamation" : "circle-check")}<span>${esc(a.message)}</span><time>${a.time}</time></div>`).join("") || '<p class="gw-card-note">Git-Aktionen und ihre Ergebnisse erscheinen hier.</p>'}</div></section></div></section>`;
  }
  function render() {
    if (state.page !== "git") return;
    document.querySelector("#workspace-primary-action").disabled = Boolean(busy);
    const repositories = state.projects.filter(p => p.git).sort((a, b) => Number(Boolean(b.git.dirty)) - Number(Boolean(a.git.dirty)) || a.name.localeCompare(b.name, "de"));
    if (!repositories.some(p => p.id === state.activeGitProjectId)) state.activeGitProjectId = repositories[0]?.id || null;
    const p = selected();
    const s = p ? session(p.id) : null;
    if (p && s.gitFingerprint !== JSON.stringify(p.git)) {
      s.gitFingerprint = JSON.stringify(p.git);
      invalidate(p.id);
      queueMicrotask(() => ensure(p.id));
    }
    const w = p ? data(p.id, "workspace") : null;
    const currentElement = (root.contains(document.activeElement) || rail.contains(document.activeElement)) ? document.activeElement : null;
    const focusKey = currentElement?.dataset?.focusKey;
    const selection = currentElement && typeof currentElement.selectionStart === "number" ? [currentElement.selectionStart, currentElement.selectionEnd] : null;
    const scrolls = [...root.querySelectorAll("[data-gw-scroll]"), ...rail.querySelectorAll("[data-gw-scroll]")].map(el => [el.dataset.gwScroll, el.scrollTop, el.scrollLeft]);
    const railHtml = repositoryRail(repositories);
    if (rail.__gwHtml !== railHtml) { rail.__gwHtml = railHtml; rail.innerHTML = railHtml; }
    const html = `<div class="gw-shell"><main class="gw-main" aria-label="Git-Repository">${p ? toolbar(p, w) + navigation(p, w) + operationBanner(p, w) + (notice?.id === p.id ? `<div class="gw-notice ${notice.error ? "error" : "success"}" role="${notice.error ? "alert" : "status"}">${icon(notice.error ? "circle-exclamation" : "circle-check")}<span>${esc(notice.message)}</span>${button(icon("xmark"), "dismiss-notice", 'aria-label="Meldung schließen"', false, "gw-icon-button")}</div>` : "") + `<div class="gw-view" data-gw-scroll="view">${s.tab === "changes" ? changeView(p) : s.tab === "history" ? historyView(p) : s.tab === "branches" ? branchView(p, w) : s.tab === "stashes" ? stashView(p, w) : s.tab === "tags" ? tagsView(p, w) : settingsView(p, w)}</div>` : empty("code-branch", "Dein Git-Arbeitsbereich", "Klone ein Repository oder aktiviere Git in einem vorhandenen Projekt.", button("Repository hinzufügen", "add", "", false, "gw-primary"))}<footer class="gw-statusbar"><span>${busy ? icon("spinner fa-spin") + " Git-Aktion läuft …" : icon("circle-check") + " Bereit"}</span>${p ? `<span>${esc(p.git.upstream || (p.git.remoteName ? "Noch kein Upstream" : "Lokales Repository"))}</span><span>${icon("arrow-up")} ${p.git.ahead} voraus <i class="gw-footer-divider"></i>${icon("arrow-down")} ${p.git.behind} zurück</span>` : ""}</footer></main></div>`;
    if (root.__gwHtml !== html) {
      root.__gwHtml = html;
      root.innerHTML = html;
      for (const [id, top, left] of scrolls) { const el = document.querySelector(`[data-gw-scroll="${id}"]`); if (el) { el.scrollTop = top; el.scrollLeft = left; } }
      if (focusKey) { const el = document.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`); el?.focus({ preventScroll: true }); if (selection && el?.setSelectionRange) { try { el.setSelectionRange(...selection); } catch { /* search fields */ } } }
    }
    if (focusKey === "gw-repo-search") { const input = rail.querySelector("input"); input?.focus({ preventScroll: true }); if (selection) { try { input.setSelectionRange(...selection); } catch {} } }
    if (p && !data(p.id, "workspace") && !pendingReads.has(key(p.id, "workspace"))) queueMicrotask(() => ensure(p.id));
  }

  async function run(action, payload = {}, id = selected()?.id) {
    if (busy || (!id && action !== "clone")) return false;
    busy = { id, action }; notice = null; render();
    let success = false;
    try {
      const result = await api(action === "clone" ? "/api/git/clone" : base(id) + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (result.project) { const i = state.projects.findIndex(p => p.id === result.project.id); if (i >= 0) state.projects[i] = result.project; }
      if (result.projects) state.projects = result.projects;
      if (["commit", "amend", "commit-files", "amend-files"].includes(action)) { Object.assign(session(id), { summary: "", description: "", amend: false, commit: null }); saveDraft(id); }
      if (["checkout", "checkout-remote", "create-branch"].includes(action)) Object.assign(session(id), { commit: null, file: null, comparison: null, amend: false });
      if (action === "init") { state.activeGitProjectId = id; }
      if (action === "clone") { const p = state.projects.find(p => p.relativePath === payload.name); if (p) state.activeGitProjectId = p.id; }
      notice = { id: id || state.activeGitProjectId, message: result.message, error: false };
      success = true;
    } catch (error) {
      notice = { id: id || state.activeGitProjectId, message: error.message, error: true };
      // Failed merges/rebases may have created conflicts; refresh before presenting recovery actions.
      if (id && action !== "init") {
        try { const result = await api(base(id) + "refresh", { method: "POST" }); const i = state.projects.findIndex(p => p.id === id); if (i >= 0) state.projects[i] = result.project; } catch { /* retain original action error */ }
      }
    } finally {
      if (notice) activity.unshift({ ...notice, time: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) });
      if (activity.length > 100) activity.length = 100;
      busy = null;
      if (id) invalidate(id);
      renderApp();
      ensure(state.activeGitProjectId);
    }
    return success;
  }

  const dialog = document.createElement("dialog");
  dialog.className = "gw-dialog";
  document.body.append(dialog);
  let dialogAction = null;
  let dialogOrigin = null;
  function modal(title, description, body, submit, execute, danger = false) {
    dialogOrigin = document.activeElement;
    dialogAction = execute;
    dialog.innerHTML = `<form><header><span class="gw-modal-glyph ${danger ? "danger" : ""}">${icon(danger ? "triangle-exclamation" : "code-branch")}</span><div><h2 id="gw-dialog-title">${esc(title)}</h2><p>${esc(description)}</p></div><button type="button" class="gw-button gw-icon-button" data-dialog-close aria-label="Dialog schließen">${icon("xmark")}</button></header><div class="gw-dialog-body">${body}<p class="gw-dialog-error" role="alert" hidden></p></div><footer><button type="button" class="gw-button" data-dialog-close>Abbrechen</button><button type="submit" class="gw-button ${danger ? "gw-danger" : "gw-primary"}">${esc(submit)}</button></footer></form>`;
    dialog.setAttribute("aria-labelledby", "gw-dialog-title");
    if (!dialog.open) dialog.showModal();
    const input = dialog.querySelector("input"); if (input) input.focus();
  }
  dialog.addEventListener("click", event => { if (event.target === dialog || event.target.closest("[data-dialog-close]")) { if (!busy) dialog.close(); } });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { dialogAction = null; if (dialogOrigin?.isConnected) dialogOrigin.focus(); });
  dialog.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !dialogAction) return;
    const payload = Object.fromEntries(new FormData(event.target));
    const controls = [...dialog.querySelectorAll("button, input, select, textarea")];
    controls.forEach(el => { el.disabled = true; });
    try {
      if (await dialogAction(payload)) { dialog.close(); return; }
      const error = dialog.querySelector(".gw-dialog-error"); error.hidden = false; error.textContent = notice?.message || "Die Aktion konnte nicht ausgeführt werden.";
    } catch (error) { const el = dialog.querySelector(".gw-dialog-error"); el.hidden = false; el.textContent = error.message; }
    finally { controls.forEach(el => { el.disabled = false; }); }
  });
  const confirm = (title, description, action, payload, label = "Bestätigen", danger = false, extra = "") => {
    const id = selected()?.id;
    modal(title, description, extra, label, form => run(action, { ...payload, ...form }, id), danger);
  };
  function addRepository() {
    const options = state.projects.filter(p => !p.git);
    modal("Repository hinzufügen", "Klone ein Repository in den aktuellen Workspace.", field("Repository-URL", "url", "", 'placeholder="https://github.com/name/repository.git" required') + field("Neuer Ordnername", "name", "", 'placeholder="mein-projekt" required pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*"') + (options.length ? `<div class="gw-dialog-divider">Oder Git in einem vorhandenen Projekt aktivieren</div><div class="gw-init-list">${options.map(p => button(esc(p.name) + " · Git anlegen", "init-dialog", `data-id="${p.id}"`)).join("")}</div>` : ""), "Repository klonen", payload => run("clone", payload));
  }
  async function interact(target) {
    const action = target.dataset.gw;
    const p = selected();
    const s = p ? session(p.id) : null;
    const w = p ? data(p.id, "workspace") : null;
    if (action === "add") { addRepository(); return; }
    if (action === "init-dialog") {
      const project = state.projects.find(p => p.id === target.dataset.id);
      modal("Git-Repository anlegen", `Git im Projekt „${project.name}“ initialisieren. Dateien werden anschließend als neue Änderungen angezeigt.`, "", "Git anlegen", () => run("init", {}, project.id)); return;
    }
    if (action === "filter") { repoFilter = target.dataset.value; render(); return; }
    if (action === "repository") { state.activeGitProjectId = target.dataset.id; localStorage.setItem("devhub_git_project", state.activeGitProjectId); render(); ensure(state.activeGitProjectId); return; }
    if (!p) return;
    if (action === "tab") { s.tab = target.dataset.value; render(); ensure(p.id); return; }
    if (action === "advanced-mode" || action === "simple-mode") { s.advanced = action === "advanced-mode"; s.scope = "working"; s.file = null; render(); ensure(p.id); return; }
    if (action === "toggle-include") { const path = target.dataset.path; s.excluded.has(path) ? s.excluded.delete(path) : s.excluded.add(path); render(); return; }
    if (action === "scope") { s.scope = target.dataset.value; s.file = null; render(); ensure(p.id); return; }
    if (action === "file") { s.file = target.dataset.path; render(); ensure(p.id); return; }
    if (action === "wrap") { s.wrap = !s.wrap; render(); return; }
    if (action === "dismiss-notice") { notice = null; render(); return; }
    if (["editor", "terminal", "folder"].includes(action)) { projectAction(p.id, action); return; }
    if (action === "copy-file" || action === "copy-hash") { await navigator.clipboard.writeText(action === "copy-file" ? s.file : s.commit); toast("Kopiert."); return; }
    if (action === "commit-detail") { s.commit = target.dataset.hash; s.historyFile = ""; render(); ensure(p.id); return; }
    if (action === "stage-file" || action === "unstage-file") { await run(action === "stage-file" ? "stage-files" : "unstage-files", { files: [target.dataset.path] }); return; }
    if (action === "hunk") {
      const section = data(p.id, `diff:${s.advanced ? "index" : "all"}:${s.file}`)?.sections?.find(section => section.scope === s.scope);
      if (section) await run(s.scope === "staged" ? "unstage-hunk" : "stage-hunk", { file: s.file, fingerprint: section.fingerprint, hunk: Number(target.dataset.index) }); return;
    }
    if (["refresh", "fetch", "pull", "push", "stage-all", "unstage-all", "continue"].includes(action)) { await run(action); return; }
    if (["checkout", "checkout-remote"].includes(action)) { await run(action, { branch: target.dataset.branch }); return; }
    if (action === "suggest") {
      const original = s.summary; target.disabled = true;
      try { const result = await api(base(p.id) + (s.advanced ? "commit-message" : "suggest-files"), s.advanced ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: includedFiles(p).map(f => f.path) }) }); if (s.summary === original) { s.summary = result.message; saveDraft(p.id); render(); } } finally { target.disabled = false; } return;
    }
    if (action === "file-menu") {
      const file = target.dataset.path;
      const parts = file.split("/"); const folders = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
      modal("Zu .gitignore hinzufügen", "Dateien oder Ordner von zukünftigen Änderungen ausschließen.", `<label class="gw-field"><span>Ignorieren</span><select name="folder"><option value="">Datei: ${esc(file)}</option>${folders.reverse().map(folder => `<option value="${esc(folder)}">Ordner: ${esc(folder)}/</option>`).join("")}</select></label><label class="gw-choice"><input type="checkbox" name="untrack"><span><strong>Bereits versionierte Dateien aus Git entfernen</strong><small>Lokale Dateien bleiben erhalten. Ohne diese Option wirkt .gitignore nur auf noch nicht versionierte Dateien.</small></span></label>`, "Ignorieren", form => run("ignore", { file, folder: form.folder, untrack: form.untrack === "on" }, p.id)); return;
    }
    if (action === "discard") {
      const path = target.dataset.path;
      const trash = state.capabilities?.trash;
      const support = trash?.available !== false;
      confirm("Änderungen verwerfen?", "Die Datei wird auf den letzten Commit zurückgesetzt. Auch ihre Vormerkung wird entfernt.", "discard-files", { files: [path] }, "Änderungen verwerfen", true, `<code class="gw-confirm-target">${esc(path)}</code><p class="gw-warning">Änderungen an versionierten Dateien gehen verloren. Neue Dateien werden ${support ? "in den Papierkorb verschoben" : "endgültig gelöscht"}.</p>`); return;
    }
    if (action === "create-branch-dialog") { confirm("Neuer Branch", `Erstellt einen Branch vom aktuellen Stand (${p.git.branch || "HEAD"}) und wechselt zu ihm.`, "create-branch", {}, "Branch erstellen", false, field("Branch-Name", "branch", "", 'required placeholder="feature/meine-aenderung" maxlength="100"')); return; }
    if (action === "rename-branch-dialog") { confirm("Branch umbenennen", `Lokalen Branch „${target.dataset.branch}“ umbenennen.`, "rename-branch", { branch: target.dataset.branch }, "Umbenennen", false, field("Neuer Name", "name", target.dataset.branch, 'required maxlength="100"')); return; }
    if (action === "delete-branch-dialog") { confirm("Branch löschen?", `„${target.dataset.branch}“ lokal löschen. Git schützt Branches mit noch nicht integrierten Commits.`, "delete-branch", { branch: target.dataset.branch }, "Branch löschen", true); return; }
    if (action === "integrate-dialog") {
      const branch = target.dataset.branch;
      modal("Branch integrieren", `Änderungen aus „${branch}“ in „${p.git.branch}“ übernehmen.`, `<label class="gw-choice"><input type="radio" name="method" value="merge" checked><span><strong>Merge</strong><small>Verläufe zusammenführen. Bestehende Commits bleiben erhalten.</small></span></label><label class="gw-choice"><input type="radio" name="method" value="rebase"><span><strong>Rebase</strong><small>Eigene Commits auf den Quellbranch setzen. Nur für unveröffentlichte Arbeit verwenden.</small></span></label>`, "Integrieren", form => run(form.method, { branch }, p.id)); return;
    }
    if (action === "compare") { s.comparison = target.dataset.branch; await read(p.id, `compare:${s.comparison}`, `compare?branch=${encodeURIComponent(s.comparison)}`, true); render(); return; }
    if (action === "close-comparison") { s.comparison = null; render(); return; }
    if (action === "confirm-abort") { confirm("Vorgang abbrechen?", `Den laufenden ${w?.operation || "Git-Vorgang"} abbrechen. Bisherige Konfliktauflösungen werden zurückgesetzt.`, "abort", {}, "Vorgang abbrechen", true); return; }
    if (action === "stash-save-dialog") { confirm("Änderungen zwischenspeichern", "Sichert versionierte Änderungen und neue Dateien. Ignorierte Dateien bleiben unberührt.", "stash-save", {}, "Im Stash sichern", false, field("Beschreibung", "message", "", 'placeholder="Woran arbeitest du gerade?" maxlength="200"')); return; }
    if (action.startsWith("stash-")) {
      const stash = w?.stashes?.find(stash => stash.hash === target.dataset.hash); if (!stash) return;
      if (action === "stash-detail") { s.stash = stash.hash; render(); ensure(p.id); return; }
      if (action === "stash-drop-dialog") { confirm("Stash löschen?", "Dieser gespeicherte Zwischenstand wird aus der Stash-Liste entfernt und kann in DevHub nicht wiederhergestellt werden.", "stash-drop", { stash: stash.ref, hash: stash.hash }, "Stash löschen", true, `<code class="gw-confirm-target">${esc(stash.subject)}</code>`); return; }
      modal("Stash anwenden", stash.subject, `<label class="gw-choice"><input type="radio" name="method" value="stash-apply" checked><span><strong>Anwenden & behalten</strong><small>Änderungen wiederherstellen und die Sicherung behalten.</small></span></label><label class="gw-choice"><input type="radio" name="method" value="stash-pop"><span><strong>Anwenden & entfernen</strong><small>Die Sicherung wird nach erfolgreicher Anwendung entfernt.</small></span></label>`, "Stash anwenden", form => run(form.method, { stash: stash.ref, hash: stash.hash }, p.id)); return;
    }
    if (action === "create-tag-dialog") { confirm("Tag erstellen", `Annotiertes Tag auf ${target.dataset.hash?.slice(0, 7) || "dem aktuellen Commit"} anlegen.`, "create-tag", { ...(target.dataset.hash ? { hash: target.dataset.hash } : {}) }, "Tag erstellen", false, field("Tag-Name", "name", "", 'required placeholder="v1.0.0" maxlength="100"') + field("Beschreibung", "message", "", 'placeholder="Release-Beschreibung" maxlength="2000"')); return; }
    if (action === "delete-tag-dialog") { confirm("Lokales Tag löschen?", `„${target.dataset.name}“ lokal entfernen. Ein bereits veröffentlichtes Remote-Tag bleibt bestehen.`, "delete-tag", { name: target.dataset.name }, "Tag löschen", true); return; }
    if (action === "push-tag-dialog") { confirm("Tag veröffentlichen", `„${target.dataset.name}“ zum gewählten Remote übertragen.`, "push-tag", { name: target.dataset.name }, "Veröffentlichen", false, `<label class="gw-field"><span>Remote</span><select name="remote">${w.remotes.map(r => `<option>${esc(r.name)}</option>`).join("")}</select></label>`); return; }
    if (action === "remote-add-dialog" || action === "remote-edit-dialog") {
      const remote = w?.remotes?.find(r => r.name === target.dataset.name);
      confirm(remote ? "Remote bearbeiten" : "Remote hinzufügen", "HTTPS, SSH und absolute lokale Repository-Pfade werden unterstützt.", remote ? "remote-set-url" : "remote-add", {}, "Speichern", false, field("Remote-Name", "remote", remote?.name || "origin", `required maxlength="100" ${remote ? "readonly" : ""}`) + field("Repository-URL", "url", remote?.url || "", 'required placeholder="https://github.com/name/repository.git" maxlength="2000"')); return;
    }
    if (action === "remote-remove-dialog") { confirm("Remote entfernen?", `Die lokale Verbindung zu „${target.dataset.name}“ und ihre Tracking-Referenzen entfernen. Das Repository auf dem Server bleibt bestehen.`, "remote-remove", { remote: target.dataset.name }, "Remote entfernen", true); return; }
    if (action === "undo-dialog") { confirm("Letzten Commit zurücknehmen?", "Der Commit wird lokal zurückgenommen. Seine Änderungen bleiben für einen neuen Commit vorgemerkt. Veröffentlichte Commits werden geschützt.", "undo-commit", {}, "Commit zurücknehmen", false, `<code class="gw-confirm-target">${esc(p.git.lastCommit.subject)}</code>`); return; }
    if (action === "revert-dialog" || action === "cherry-pick-dialog") { const revert = action === "revert-dialog"; confirm(revert ? "Commit rückgängig machen" : "Commit übernehmen", revert ? "Erstellt einen neuen Commit, der die Änderungen des gewählten Commits rückgängig macht. Der bestehende Verlauf bleibt erhalten." : `Übernimmt die Änderungen dieses Commits als neuen Commit auf „${p.git.branch || "HEAD"}“.`, revert ? "revert" : "cherry-pick", { hash: target.dataset.hash }, revert ? "Revert erstellen" : "Cherry-pick ausführen", false, `<code class="gw-confirm-target">${esc(target.dataset.hash)}</code>`); return; }
    if (action === "history-more") {
      const resource = `history:${s.historyQuery}:${s.historyAll}`;
      const previous = data(p.id, resource);
      if (!previous?.hasMore || pendingReads.has(key(p.id, "history-more"))) return;
      pendingReads.set(key(p.id, "history-more"), true); render();
      try { const next = await api(base(p.id) + `history?offset=${previous.commits.length}&query=${encodeURIComponent(s.historyQuery)}&all=${s.historyAll}`); if (data(p.id, resource) === previous) cache.set(key(p.id, resource), { commits: [...previous.commits, ...next.commits], hasMore: next.hasMore }); }
      finally { pendingReads.delete(key(p.id, "history-more")); render(); } return;
    }
  }
  for (const surface of [root, rail]) surface.addEventListener("click", event => { const target = event.target.closest("[data-gw]"); if (target && !target.disabled) { event.stopPropagation(); interact(target).catch(error => toast(error.message, "error")); } });
  dialog.addEventListener("click", event => { const target = event.target.closest("[data-gw]"); if (target && !target.disabled) interact(target).catch(error => toast(error.message, "error")); });
  for (const surface of [root, rail]) surface.addEventListener("input", event => {
    const kind = event.target.dataset.gwInput;
    const p = selected(); if (!kind) return;
    if (kind === "repoQuery") { state.gitQuery = event.target.value; render(); return; }
    if (!p) return;
    const s = session(p.id);
    if (kind === "includeFile") { event.target.checked ? s.excluded.delete(event.target.dataset.path) : s.excluded.add(event.target.dataset.path); render(); return; }
    if (kind === "selectAll") { s.excluded = new Set(event.target.checked ? [] : p.git.files.map(f => f.path)); render(); return; }
    if (["summary", "description"].includes(kind)) {
      s[kind] = event.target.value; saveDraft(p.id);
      const commit = root.querySelector(".gw-commit-submit");
      if (commit) commit.disabled = !!busy || s.summary.trim().length < 3 || (s.advanced ? (!p.git.staged && !s.amend) : !includedFiles(p).length) || !!count(p, conflict) || !!data(p.id, "workspace")?.operation;
      return;
    }
    if (["amend", "historyAll"].includes(kind)) {
      s[kind] = event.target.checked;
      if (kind === "amend" && s.amend && !s.summary) { s.summary = p.git.lastCommit?.subject || ""; saveDraft(p.id); }
      if (kind === "historyAll") s.commit = null;
      render(); ensure(p.id); return;
    }
    s[kind] = event.target.value;
    if (kind === "historyQuery") { clearTimeout(searchTimer); searchTimer = setTimeout(() => { s.commit = null; render(); ensure(p.id); }, 250); }
    else { render(); ensure(p.id); }
  });
  root.addEventListener("submit", event => {
    const form = event.target.closest("[data-gw-form]"); if (!form) return;
    event.preventDefault(); event.stopPropagation();
    const p = selected(); if (!p) return;
    if (form.dataset.gwForm === "commit") { const s = session(p.id); if (!form.querySelector('[type="submit"]').disabled) run(s.advanced ? (s.amend ? "amend" : "commit") : (s.amend ? "amend-files" : "commit-files"), { message: s.summary, description: s.description, ...(!s.advanced ? { files: includedFiles(p).map(f => f.path) } : {}) }); }
    else if (form.dataset.gwForm === "identity") run("identity", Object.fromEntries(new FormData(form)));
  });
  root.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && event.target.closest(".gw-composer")) { event.preventDefault(); root.querySelector(".gw-commit-submit")?.click(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") { event.preventDefault(); if (!busy) run("refresh"); }
    const file = event.target.closest('.gw-file > button[data-gw="file"]');
    if (file && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); const files = [...root.querySelectorAll('.gw-file > button[data-gw="file"]')]; const next = files[files.indexOf(file) + (event.key === "ArrowDown" ? 1 : -1)]; if (next) { const path = next.dataset.path; interact(next).then(() => root.querySelector(`.gw-file > button[data-path="${CSS.escape(path)}"]`)?.focus()); } }
  });
  return { render, load: ensure, openAddRepository: () => { if (!busy) addRepository(); } };
}
