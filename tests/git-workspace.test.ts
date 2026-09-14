import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { cloneGitRepository, initializeGitRepository, readGitBranches, readGitCommit, readGitComparison, readGitDiff, readGitHistory, readGitStash, readGitStats, readGitWorkspace, runGitAction } from "../src/git-actions.js";
import { readGitInfo } from "../src/scanner.js";
import type { ProjectDefinition } from "../src/types.js";

const exec = promisify(execFile);
async function git(root: string, ...args: string[]): Promise<string> {
  return (await exec("git", ["-C", root, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();
}
async function fixture(run: (p: ProjectDefinition, root: string, refresh: () => Promise<void>) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "devhub-workspace-"));
  const repository = path.join(root, "project");
  await mkdir(repository);
  const project = { id: "abc123", name: "Test", absolutePath: repository, relativePath: "project", git: null } as ProjectDefinition;
  try {
    await initializeGitRepository(project);
    await git(repository, "config", "core.autocrlf", "false");
    await git(repository, "config", "user.name", "Test Author");
    await git(repository, "config", "user.email", "test@example.test");
    await writeFile(path.join(repository, "file.txt"), Array.from({ length: 30 }, (_, i) => `line ${i + 1}\n`).join(""));
    await git(repository, "add", ".");
    await git(repository, "commit", "-m", "Initial commit");
    const refresh = async () => { project.git = await readGitInfo(repository, repository); };
    await refresh();
    await run(project, root, refresh);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("stages and unstages individual hunks, rejecting stale patches", async () => fixture(async (p, root, refresh) => {
  const file = path.join(p.absolutePath, "file.txt");
  await writeFile(file, (await readFile(file, "utf8")).replace("line 2\n", "first change\n").replace("line 28\n", "second change\n"));
  await refresh();
  let diff = (await readGitDiff(p, "file.txt"))[0];
  assert.equal(diff.patch.match(/^@@ /gm)?.length, 2);
  await runGitAction(p, "stage-hunk", { file: "file.txt", hunk: 1, fingerprint: diff.fingerprint });
  assert.match(await git(p.absolutePath, "diff", "--cached"), /second change/);
  assert.doesNotMatch(await git(p.absolutePath, "diff", "--cached"), /first change/);
  await refresh();
  await assert.rejects(runGitAction(p, "stage-hunk", { file: "file.txt", hunk: 0, fingerprint: diff.fingerprint }), /geändert/);
  diff = (await readGitDiff(p, "file.txt")).find(d => d.scope === "staged")!;
  await runGitAction(p, "unstage-hunk", { file: "file.txt", hunk: 0, fingerprint: diff.fingerprint });
  assert.equal(await git(p.absolutePath, "diff", "--cached"), "");
  assert.match(await git(p.absolutePath, "diff"), /first change/);
  assert.match(await git(p.absolutePath, "diff"), /second change/);
}));

test("treats file paths literally and reads renamed and unusual commit paths", async () => fixture(async (p, root, refresh) => {
  await writeFile(path.join(p.absolutePath, "[ab].txt"), "literal\n");
  await writeFile(path.join(p.absolutePath, "a.txt"), "must stay untracked\n");
  await refresh();
  await runGitAction(p, "stage-files", { files: ["[ab].txt"] });
  assert.equal(await git(p.absolutePath, "diff", "--cached", "--name-only"), "[ab].txt");
  await refresh();
  await runGitAction(p, "unstage-files", { files: ["[ab].txt"] });
  await git(p.absolutePath, "mv", "file.txt", "umbenannt\tü.txt");
  await refresh();
  await runGitAction(p, "unstage", { file: "umbenannt\tü.txt" });
  assert.equal(await git(p.absolutePath, "diff", "--cached"), "");
  await refresh();
  await runGitAction(p, "stage-all", {});
  await refresh();
  await runGitAction(p, "commit", { message: "Rename and add files", description: "First paragraph.\n\nSecond paragraph." });
  await refresh();
  const commit = await readGitCommit(p, await git(p.absolutePath, "rev-parse", "HEAD"));
  assert.equal(commit.body, "First paragraph.\n\nSecond paragraph.");
  assert.ok(commit.files.some(f => f.path === "umbenannt\tü.txt" && f.originalPath === "file.txt"));
}));

test("saves, previews and applies stashes including untracked files; protects stale references", async () => fixture(async (p, root, refresh) => {
  await writeFile(path.join(p.absolutePath, "file.txt"), "work in progress\n");
  await writeFile(path.join(p.absolutePath, "new.txt"), "new content\n");
  await refresh();
  await runGitAction(p, "stash-save", { message: "First draft" });
  await refresh();
  assert.equal(p.git?.dirty, false, JSON.stringify(p.git?.files));
  const stash = (await readGitWorkspace(p)).stashes[0];
  assert.match((await readGitStash(p, { stash: stash.ref, hash: stash.hash })).patch, /new content/);
  await assert.rejects(runGitAction(p, "stash-drop", { stash: stash.ref, hash: "bad" }), /geändert/);
  await runGitAction(p, "stash-apply", { stash: stash.ref, hash: stash.hash });
  assert.equal(await readFile(path.join(p.absolutePath, "new.txt"), "utf8"), "new content\n");
  assert.equal((await readGitWorkspace(p)).stashes.length, 1);
  await refresh();
  await assert.rejects(runGitAction(p, "stash-pop", { stash: stash.ref, hash: stash.hash }), /Stash/);
  await runGitAction(p, "stash-drop", { stash: stash.ref, hash: stash.hash });
  assert.equal((await readGitWorkspace(p)).stashes.length, 0);
}));

test("manages branches, comparison, merging and branch deletion", async () => fixture(async (p, root, refresh) => {
  await runGitAction(p, "create-branch", { branch: "feature/example" });
  await writeFile(path.join(p.absolutePath, "feature.txt"), "feature work\n");
  await git(p.absolutePath, "add", "."); await git(p.absolutePath, "commit", "-m", "Feature commit"); await refresh();
  await runGitAction(p, "checkout", { branch: "main" }); await refresh();
  assert.match((await readGitComparison(p, "feature/example")).patch, /feature work/);
  assert.equal((await readGitHistory(p, 0, 20, "Feature", true)).commits.length, 1);
  assert.equal((await readGitHistory(p, 0, 20, "Feature", false)).commits.length, 0);
  await assert.rejects(runGitAction(p, "delete-branch", { branch: "feature/example" }));
  await runGitAction(p, "merge", { branch: "feature/example" }); await refresh();
  assert.equal(p.git?.lastCommit?.subject, "Feature commit");
  await runGitAction(p, "rename-branch", { branch: "feature/example", name: "feature/done" });
  await runGitAction(p, "delete-branch", { branch: "feature/done" });
  assert.deepEqual((await readGitBranches(p)).map(b => b.name), ["main"]);
  await assert.rejects(runGitAction(p, "create-branch", { branch: "--force" }));
}));

test("exposes merge conflicts and supports both abort and continuation", async () => fixture(async (p, root, refresh) => {
  await runGitAction(p, "create-branch", { branch: "feature/conflict" });
  await writeFile(path.join(p.absolutePath, "file.txt"), "feature side\n");
  await git(p.absolutePath, "commit", "-am", "Feature version"); await refresh();
  await runGitAction(p, "checkout", { branch: "main" });
  await writeFile(path.join(p.absolutePath, "file.txt"), "main side\n");
  await git(p.absolutePath, "commit", "-am", "Main version"); await refresh();
  await assert.rejects(runGitAction(p, "merge", { branch: "feature/conflict" })); await refresh();
  assert.equal((await readGitWorkspace(p)).operation, "merge");
  assert.ok(p.git?.files.some(f => f.indexStatus === "U"));
  await runGitAction(p, "abort", {}); await refresh();
  assert.equal((await readGitWorkspace(p)).operation, null);
  assert.equal(await readFile(path.join(p.absolutePath, "file.txt"), "utf8"), "main side\n");
  await assert.rejects(runGitAction(p, "merge", { branch: "feature/conflict" })); await refresh();
  await writeFile(path.join(p.absolutePath, "file.txt"), "resolved version\n");
  await runGitAction(p, "stage", { file: "file.txt" }); await refresh();
  await runGitAction(p, "continue", {}); await refresh();
  assert.equal((await readGitWorkspace(p)).operation, null);
  const merge = await readGitCommit(p, p.git!.lastCommit!.hash);
  assert.equal(merge.parents.length, 2);
  assert.ok(merge.files.some(f => f.path === "file.txt"));
  assert.match(merge.patch, /resolved version/);
}));

test("rebases unpublished work and supports cherry-pick and revert", async () => fixture(async (p, root, refresh) => {
  await runGitAction(p, "create-branch", { branch: "feature" });
  await writeFile(path.join(p.absolutePath, "feature.txt"), "feature\n"); await git(p.absolutePath, "add", "."); await git(p.absolutePath, "commit", "-m", "Feature");
  const hash = await git(p.absolutePath, "rev-parse", "HEAD"); await refresh();
  await runGitAction(p, "checkout", { branch: "main" });
  await writeFile(path.join(p.absolutePath, "main.txt"), "main\n"); await git(p.absolutePath, "add", "."); await git(p.absolutePath, "commit", "-m", "Main"); await refresh();
  await runGitAction(p, "checkout", { branch: "feature" }); await refresh();
  await runGitAction(p, "rebase", { branch: "main" }); await refresh();
  assert.equal(await readFile(path.join(p.absolutePath, "main.txt"), "utf8"), "main\n");
  await runGitAction(p, "checkout", { branch: "main" }); await refresh();
  await runGitAction(p, "cherry-pick", { hash }); await refresh();
  assert.equal(p.git?.lastCommit?.subject, "Feature");
  await runGitAction(p, "revert", { hash: p.git?.lastCommit?.hash }); await refresh();
  await assert.rejects(readFile(path.join(p.absolutePath, "feature.txt")));
  assert.match(p.git!.lastCommit!.subject, /Revert/);
}));

test("manages remote, tags and repository identity and protects published commits", async () => fixture(async (p, root, refresh) => {
  const remote = path.join(root, "remote.git");
  await exec("git", ["init", "--bare", remote]);
  await runGitAction(p, "identity", { name: "Repository Author", email: "author@example.test" });
  assert.deepEqual((await readGitWorkspace(p)).identity, { name: "Repository Author", email: "author@example.test" });
  await runGitAction(p, "amend", { message: "Updated initial commit", description: "Detailed body" }); await refresh();
  assert.equal((await readGitCommit(p, p.git!.lastCommit!.hash)).body, "Detailed body");
  await runGitAction(p, "remote-add", { remote: "upstream", url: remote }); await refresh();
  assert.equal(p.git?.remoteName, "upstream");
  await runGitAction(p, "push", {}); await refresh();
  await assert.rejects(runGitAction(p, "amend", { message: "Must fail" }), /Remote-Branch/);
  await assert.rejects(runGitAction(p, "undo-commit", {}), /Remote-Branch/);
  await runGitAction(p, "create-tag", { name: "v1.0.0", message: "First release" });
  assert.equal((await readGitWorkspace(p)).tags[0].name, "v1.0.0");
  await runGitAction(p, "push-tag", { name: "v1.0.0", remote: "upstream" });
  assert.match(await git(remote, "tag"), /v1.0.0/);
  await runGitAction(p, "delete-tag", { name: "v1.0.0" });
  assert.equal((await readGitWorkspace(p)).tags.length, 0);
  await git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
  await cloneGitRepository(root, { url: remote, name: "cloned" });
  assert.ok(await readFile(path.join(root, "cloned", "file.txt")));
  await assert.rejects(cloneGitRepository(root, { url: remote, name: "../escape" }));
  await assert.rejects(cloneGitRepository(root, { url: remote, name: "cloned" }));
  await assert.rejects(runGitAction(p, "remote-add", { remote: "unsafe", url: "ext::sh -c echo" }));
  await runGitAction(p, "remote-remove", { remote: "upstream" }); await refresh();
  assert.equal(p.git?.remoteName, null);
}));

test("quick commits include checked files and preserve excluded staged changes", async () => fixture(async (p, root, refresh) => {
  await writeFile(path.join(p.absolutePath, "file.txt"), "index version\n");
  await git(p.absolutePath, "add", "file.txt");
  await writeFile(path.join(p.absolutePath, "file.txt"), "working version\n");
  await writeFile(path.join(p.absolutePath, "checked.txt"), "include me\n");
  await refresh();
  const combined = await readGitDiff(p, "file.txt", true);
  assert.match(combined[0].patch, /working version/);
  assert.doesNotMatch(combined[0].patch, /index version/);
  await runGitAction(p, "commit-files", { files: ["checked.txt"], message: "Commit selection", description: "Only the checked file." });
  assert.equal(await git(p.absolutePath, "show", "--format=", "--name-only", "HEAD"), "checked.txt");
  assert.match(await git(p.absolutePath, "diff", "--cached"), /index version/);
  assert.match(await git(p.absolutePath, "diff"), /working version/);
  await refresh();
  await runGitAction(p, "commit-files", { files: ["file.txt"], message: "Commit final working version" });
  assert.equal(await git(p.absolutePath, "show", "HEAD:file.txt"), "working version");
  assert.equal(await git(p.absolutePath, "status", "--porcelain"), "");
  // The checkbox flow also works before the first commit.
  const unborn = path.join(root, "unborn"); await mkdir(unborn);
  const first = { ...p, absolutePath: unborn, git: null };
  await initializeGitRepository(first);
  await git(unborn, "config", "user.name", "First author"); await git(unborn, "config", "user.email", "first@example.test");
  await writeFile(path.join(unborn, "first.txt"), "first\n"); await writeFile(path.join(unborn, "excluded.txt"), "excluded\n");
  first.git = await readGitInfo(unborn, unborn);
  await runGitAction(first, "commit-files", { files: ["first.txt"], message: "First commit" });
  assert.equal(await git(unborn, "ls-tree", "--name-only", "HEAD"), "first.txt");
}));

test("gitignore actions escape filenames and ignore folders while retaining local files", async () => fixture(async (p, root, refresh) => {
  await writeFile(path.join(p.absolutePath, "[draft].txt"), "draft\n");
  await mkdir(path.join(p.absolutePath, "cache"));
  await writeFile(path.join(p.absolutePath, "cache", "tracked.txt"), "keep locally\n");
  await git(p.absolutePath, "add", "cache"); await git(p.absolutePath, "commit", "-m", "Track cache");
  await writeFile(path.join(p.absolutePath, "cache", "tracked.txt"), "local change\n");
  await refresh();
  await runGitAction(p, "ignore", { file: "[draft].txt" });
  assert.equal(await git(p.absolutePath, "check-ignore", "[draft].txt"), "[draft].txt");
  await runGitAction(p, "ignore", { file: "[draft].txt" });
  assert.equal((await readFile(path.join(p.absolutePath, ".gitignore"), "utf8")).split("\n").filter(Boolean).length, 1);
  await runGitAction(p, "ignore", { file: "cache/tracked.txt", folder: "cache", untrack: true });
  assert.equal(await readFile(path.join(p.absolutePath, "cache", "tracked.txt"), "utf8"), "local change\n");
  assert.equal(await git(p.absolutePath, "ls-files", "cache"), "");
  assert.equal(await git(p.absolutePath, "check-ignore", "cache/tracked.txt"), "cache/tracked.txt");
  await assert.rejects(runGitAction(p, "ignore", { file: "cache/tracked.txt", folder: ".." }), /übergeordneten/);
}));

test("liefert Zeilenzahlen pro Datei und löst Konflikte pro Datei mit einer Seite auf", async () => fixture(async (p, root, refresh) => {
  await writeFile(path.join(p.absolutePath, "file.txt"), "line 1\nchanged\n");
  await writeFile(path.join(p.absolutePath, "fresh.txt"), "a\nb\nc\n");
  await writeFile(path.join(p.absolutePath, "blob.bin"), Buffer.from([0, 1, 2, 3]));
  await refresh();
  const stats = await readGitStats(p);
  assert.deepEqual(stats["fresh.txt"], { additions: 3, deletions: 0, binary: false });
  assert.equal(stats["blob.bin"].binary, true);
  assert.equal(stats["file.txt"].additions, 1);
  assert.equal(stats["file.txt"].deletions, 29);
  await git(p.absolutePath, "checkout", "--", "file.txt");
  await rm(path.join(p.absolutePath, "fresh.txt")); await rm(path.join(p.absolutePath, "blob.bin"));
  await runGitAction(p, "create-branch", { branch: "feature/conflict" });
  await writeFile(path.join(p.absolutePath, "file.txt"), "feature side\n");
  await git(p.absolutePath, "commit", "-am", "Feature version"); await refresh();
  await runGitAction(p, "checkout", { branch: "main" });
  await writeFile(path.join(p.absolutePath, "file.txt"), "main side\n");
  await git(p.absolutePath, "commit", "-am", "Main version"); await refresh();
  await assert.rejects(runGitAction(p, "merge", { branch: "feature/conflict" })); await refresh();
  await assert.rejects(runGitAction(p, "resolve-file", { file: "file.txt", side: "both" }), /Version/);
  await runGitAction(p, "resolve-file", { file: "file.txt", side: "theirs" });
  assert.equal(await readFile(path.join(p.absolutePath, "file.txt"), "utf8"), "feature side\n");
  assert.equal(await git(p.absolutePath, "ls-files", "--unmerged"), "");
  await refresh();
  await assert.rejects(runGitAction(p, "resolve-file", { file: "file.txt", side: "ours" }), /keinen offenen Konflikt/);
  await runGitAction(p, "continue", {}); await refresh();
  assert.equal((await readGitWorkspace(p)).operation, null);
  assert.equal((await readGitCommit(p, p.git!.lastCommit!.hash)).parents.length, 2);
}));

test("merkt sich den Fetch-Zeitpunkt und zieht auseinandergelaufene Branches per Rebase oder Merge zusammen", async () => fixture(async (p, root, refresh) => {
  const remote = path.join(root, "remote.git");
  await exec("git", ["init", "--bare", remote]);
  await git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
  await runGitAction(p, "remote-add", { remote: "origin", url: remote }); await refresh();
  assert.equal(p.git?.lastFetchAt, null);
  await runGitAction(p, "push", {}); await refresh();
  await runGitAction(p, "fetch", {}); await refresh();
  assert.ok(p.git?.lastFetchAt, "FETCH_HEAD liefert den Zeitpunkt");
  assert.ok(Date.now() - new Date(p.git!.lastFetchAt!).getTime() < 60_000);
  // Ein zweiter Klon schiebt einen Commit, lokal entsteht ein anderer: beide Branches laufen auseinander.
  await cloneGitRepository(root, { url: remote, name: "other" });
  const other = path.join(root, "other");
  await git(other, "config", "user.name", "Other"); await git(other, "config", "user.email", "other@example.test");
  await writeFile(path.join(other, "remote.txt"), "remote work\n");
  await git(other, "add", "."); await git(other, "commit", "-m", "Remote commit"); await git(other, "push");
  await writeFile(path.join(p.absolutePath, "local.txt"), "local work\n");
  await git(p.absolutePath, "add", "."); await git(p.absolutePath, "commit", "-m", "Local commit");
  await runGitAction(p, "fetch", {}); await refresh();
  assert.equal(p.git?.ahead, 1); assert.equal(p.git?.behind, 1);
  await assert.rejects(runGitAction(p, "pull", {}));
  await writeFile(path.join(p.absolutePath, "dirty.txt"), "uncommitted\n"); await refresh();
  await assert.rejects(runGitAction(p, "pull", { method: "rebase" }), /Committe oder sichere/);
  await rm(path.join(p.absolutePath, "dirty.txt")); await refresh();
  await runGitAction(p, "pull", { method: "rebase" }); await refresh();
  assert.equal(p.git?.behind, 0); assert.equal(p.git?.ahead, 1);
  assert.equal((await readGitCommit(p, p.git!.lastCommit!.hash)).parents.length, 1);
  await runGitAction(p, "push", {}); await refresh();
  await writeFile(path.join(other, "remote2.txt"), "more remote work\n");
  await git(other, "pull", "--rebase"); await git(other, "add", "."); await git(other, "commit", "-m", "Second remote commit"); await git(other, "push");
  await writeFile(path.join(p.absolutePath, "local2.txt"), "more local work\n");
  await git(p.absolutePath, "add", "."); await git(p.absolutePath, "commit", "-m", "Second local commit");
  await runGitAction(p, "fetch", {}); await refresh();
  await runGitAction(p, "pull", { method: "merge" }); await refresh();
  assert.equal(p.git?.behind, 0);
  assert.equal((await readGitCommit(p, p.git!.lastCommit!.hash)).parents.length, 2);
}));
