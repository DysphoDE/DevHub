import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveScanRoot } from "../src/config.js";
import type { AppConfig } from "../src/types.js";

function testConfig(scanRoot: string): AppConfig {
  return {
    host: "127.0.0.1",
    publicHost: "devhub",
    autostartMode: "dev",
    port: 7331,
    scanRoot,
    maxDepth: 5,
    maxEntriesPerProject: 5000,
    ignore: [],
    laragonRoot: path.join(scanRoot, "laragon"),
    editor: "auto"
  };
}

test("saveScanRoot validates, persists, and applies an absolute workspace path", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "devhub-config-"));
  const workspace = path.join(temporaryDirectory, "workspace");
  const configPath = path.join(temporaryDirectory, "devhub.config.json");
  await mkdir(workspace);
  await writeFile(configPath, '{"port":7444}\n', "utf8");
  const config = testConfig(temporaryDirectory);

  try {
    const savedRoot = await saveScanRoot(config, `  ${workspace}  `, configPath);
    const savedConfig = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    assert.equal(savedRoot, path.resolve(workspace));
    assert.equal(config.scanRoot, path.resolve(workspace));
    assert.equal(savedConfig.scanRoot, path.resolve(workspace));
    assert.equal(savedConfig.port, 7444);
    await assert.rejects(() => saveScanRoot(config, "relative/path", configPath), /absoluten Workspace-Pfad/);
    await assert.rejects(() => saveScanRoot(config, path.join(temporaryDirectory, "missing"), configPath), /existiert nicht/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
