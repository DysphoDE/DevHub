import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { readGitDiff, runGitAction } from "../src/git-actions.js";
import { readGitInfo, scanWorkspace } from "../src/scanner.js";
import type { AppConfig } from "../src/types.js";

const execFileAsync = promisify(execFile);

function testConfig(root: string): AppConfig {
  return {
    host: "127.0.0.1", publicHost: "devhub", autostartMode: "dev", port: 7331,
    scanRoot: root, maxDepth: 5, maxEntriesPerProject: 5000,
    ignore: ["node_modules", ".git", "dist", "build"], laragonRoot: path.join(root, "no-laragon"), editor: "auto"
  };
}

async function git(repository: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", repository, ...args], { windowsHide: true });
}

test("listet Git-Dateien und committet nur vorgemerkte Änderungen", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "devhub-git-"));
  try {
    const projectPath = path.join(root, "git-project");
    await mkdir(projectPath);
    await git(projectPath, "init", "-b", "main");
    await git(projectPath, "config", "user.name", "DevHub Test");
    await git(projectPath, "config", "user.email", "devhub@example.test");
    await writeFile(path.join(projectPath, "tracked.txt"), "initial\n");
    await git(projectPath, "add", "tracked.txt");
    await git(projectPath, "commit", "-m", "Initial commit");
    await writeFile(path.join(projectPath, "tracked.txt"), "changed\n");
    await writeFile(path.join(projectPath, "new file.txt"), "new\n");

    const [project] = await scanWorkspace(testConfig(root), path.join(root, "devhub-node"));
    assert.ok(project.git);
    assert.equal(project.git.unstaged, 1);
    assert.equal(project.git.untracked, 1);
    assert.deepEqual(project.git.files.map((file) => file.path).sort(), ["new file.txt", "tracked.txt"]);
    const workingDiff = await readGitDiff(project, "tracked.txt");
    assert.equal(workingDiff[0].scope, "working");
    assert.match(workingDiff[0].patch, /-initial/);
    assert.match(workingDiff[0].patch, /\+changed/);
    const newFileDiff = await readGitDiff(project, "new file.txt");
    assert.match(newFileDiff[0].patch, /\+new/);

    await runGitAction(project, "stage", { file: "tracked.txt" });
    project.git = await readGitInfo(projectPath, projectPath);
    assert.equal(project.git?.staged, 1);
    assert.equal(project.git?.untracked, 1);
    const stagedDiff = await readGitDiff(project, "tracked.txt");
    assert.equal(stagedDiff[0].scope, "staged");

    await runGitAction(project, "commit", { message: "Update tracked file" });
    project.git = await readGitInfo(projectPath, projectPath);
    assert.equal(project.git?.lastCommit?.subject, "Update tracked file");
    assert.equal(project.git?.staged, 0);
    assert.equal(project.git?.untracked, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
