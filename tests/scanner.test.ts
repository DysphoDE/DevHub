import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { scanWorkspace } from "../src/scanner.js";
import type { AppConfig } from "../src/types.js";

function testConfig(root: string): AppConfig {
  return {
    host: "127.0.0.1", port: 7331, scanRoot: root, maxDepth: 5, maxEntriesPerProject: 5000,
    ignore: ["node_modules", ".git", "dist", "build"], laragonRoot: path.join(root, "no-laragon"), editor: "auto"
  };
}

test("findet Package-Scripts und Windows-Starter rekursiv", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "devhub-scan-"));
  try {
    const project = path.join(root, "Kundenportal");
    const frontend = path.join(project, "apps", "frontend");
    await mkdir(frontend, { recursive: true });
    await writeFile(path.join(project, "project.ini"), 'title = "Kundenportal Next"\ndescription = "Testprojekt"\n');
    await writeFile(path.join(frontend, "package.json"), JSON.stringify({
      packageManager: "pnpm@10.0.0",
      scripts: { dev: "vite", build: "vite build", "dev:mock": "vite --mode mock" }
    }));
    await writeFile(path.join(project, "start.bat"), "@echo off\r\n");
    await mkdir(path.join(project, "node_modules", "ignored"), { recursive: true });
    await writeFile(path.join(project, "node_modules", "ignored", "package.json"), JSON.stringify({ scripts: { dev: "ignored" } }));

    const config = testConfig(root);
    const projects = await scanWorkspace(config, path.join(root, "devhub-node"));

    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, "Kundenportal Next");
    assert.equal(projects[0].description, "Testprojekt");
    assert.deepEqual(projects[0].launchers.map((launcher) => launcher.command), [
      "pnpm run dev",
      "pnpm run dev:mock",
      '"start.bat"'
    ]);
    assert.equal(projects[0].launchers.filter((launcher) => launcher.kind === "package-script").length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ignoriert versteckte und unterstrichene Projektordner", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "devhub-ignore-"));
  try {
    for (const name of [".cache", "_intern", "$system"]) {
      await mkdir(path.join(root, name), { recursive: true });
      await writeFile(path.join(root, name, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
    }
    const config = { ...testConfig(root), ignore: [] };
    assert.deepEqual(await scanWorkspace(config, path.join(root, "devhub-node")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listet DevHub selbst ohne konkurrierende Startaktionen", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "devhub-self-"));
  try {
    const appPath = path.join(root, "DevHub");
    const projectPath = path.join(root, "Kundenportal");
    await mkdir(appPath, { recursive: true });
    await mkdir(projectPath, { recursive: true });
    await writeFile(path.join(appPath, "package.json"), JSON.stringify({ scripts: { dev: "tsx watch src/server.ts" } }));
    await writeFile(path.join(projectPath, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));

    const projects = await scanWorkspace(testConfig(root), appPath);
    assert.deepEqual(projects.map((project) => project.relativePath), ["DevHub", "Kundenportal"]);
    assert.deepEqual(projects.find((project) => project.relativePath === "DevHub")?.launchers, []);
    assert.equal(projects.find((project) => project.relativePath === "Kundenportal")?.launchers.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("erkennt reine HTML- und PHP-Projekte mit abgeleiteten Metadaten", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "devhub-web-"));
  try {
    const htmlProject = path.join(root, "landing-page");
    const phpProject = path.join(root, "kunden-api");
    await mkdir(htmlProject, { recursive: true });
    await mkdir(path.join(phpProject, "public"), { recursive: true });
    await writeFile(path.join(htmlProject, "README.md"), "# Nordlicht Studio\n\nEine handgefertigte Portfolio-Website für ein kleines Designstudio.\n");
    await writeFile(path.join(htmlProject, "index.html"), '<!doctype html><title>Nordlicht Studio</title><meta name="description" content="Portfolio und Projekte aus Hamburg.">');
    await writeFile(path.join(phpProject, "composer.json"), JSON.stringify({ name: "acme/kunden-api", description: "API für das Kundenportal", require: { "laravel/framework": "^12" } }));
    await writeFile(path.join(phpProject, "public", "index.php"), "<?php echo 'ok';");

    const projects = await scanWorkspace(testConfig(root), path.join(root, "devhub-node"));
    assert.equal(projects.length, 2);
    const html = projects.find((project) => project.relativePath === "landing-page")!;
    const php = projects.find((project) => project.relativePath === "kunden-api")!;
    assert.equal(html.name, "Nordlicht Studio");
    assert.equal(html.description, "Portfolio und Projekte aus Hamburg.");
    assert.ok(html.technologies.includes("HTML"));
    assert.equal(html.launchers[0].kind, "static-server");
    assert.equal(php.description, "API für das Kundenportal");
    assert.ok(php.technologies.includes("Laravel"));
    assert.equal(php.launchers.at(-1)?.kind, "php-server");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zeigt auch Projektordner ohne Manifest oder Starter", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "devhub-folder-"));
  try {
    await mkdir(path.join(root, "Konzeptentwürfe"), { recursive: true });
    const projects = await scanWorkspace(testConfig(root), path.join(root, "devhub-node"));
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, "Konzeptentwürfe");
    assert.deepEqual(projects[0].technologies, ["Projektordner"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
