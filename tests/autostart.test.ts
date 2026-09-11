import assert from "node:assert/strict";
import test from "node:test";
import { buildPlan, renderLaunchAgent, renderSystemdUnit, runtimeArguments } from "../src/autostart.js";
import { buildConfig, detectPlatform, suggestedStack, type SetupAnswers } from "../src/setup.js";

test("baut die Laufzeitargumente je Modus", () => {
  assert.deepEqual(runtimeArguments("/srv/devhub", "production"), ["/srv/devhub/dist/server.js".split("/").join(require_sep())]);
  assert.equal(runtimeArguments("/srv/devhub", "dev").length, 3);
});

function require_sep(): string {
  return process.platform === "win32" ? "\\" : "/";
}

test("rendert einen gültigen LaunchAgent mit PATH und Log", () => {
  const plan = buildPlan("/Users/jan/Herd/Dev Hub", "dev", "/opt/homebrew/bin/node", "/opt/homebrew/bin:/usr/bin");
  const plist = renderLaunchAgent(plan);
  assert.match(plist, /<string>de\.devhub\.node<\/string>/);
  assert.match(plist, /<string>\/opt\/homebrew\/bin\/node<\/string>/);
  assert.match(plist, /<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:\/usr\/bin<\/string>/);
  assert.match(plist, /<string>[^<]*Dev Hub[^<]*autostart\.log<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.doesNotMatch(plist, /<string>[^<]*<[^\/]/, "Werte müssen XML-sicher sein");
});

test("rendert eine systemd-Benutzereinheit mit maskierten Pfaden", () => {
  const plan = buildPlan("/home/jan/Dev Hub", "production", "/usr/bin/node", "/usr/local/bin:/usr/bin");
  const unit = renderSystemdUnit(plan);
  assert.match(unit, /^ExecStart="\/usr\/bin\/node" "\/home\/jan\/Dev Hub\/dist\/server\.js"$/m);
  assert.match(unit, /^Environment=PATH=\/usr\/local\/bin:\/usr\/bin$/m);
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^WantedBy=default\.target$/m);
});

test("führt Setup-Antworten mit einer bestehenden Konfiguration zusammen", () => {
  const answers: SetupAnswers = {
    platform: "darwin", scanRoot: "/Users/jan/Herd", stack: "herd", laragonRoot: null, herdRoot: null,
    editor: "auto", terminal: "iTerm", port: 7331, publicHost: "devhub.test", publicUrl: "http://devhub.test", autostartMode: "dev"
  };
  const result = buildConfig({ port: 7444, ignore: ["_old"], laragonRoot: "C:\\laragon", maxDepth: 7 }, answers);
  assert.equal(result.port, 7331);
  assert.equal(result.scanRoot, "/Users/jan/Herd");
  assert.equal(result.stack, "herd");
  assert.equal(result.maxDepth, 7);
  assert.deepEqual(result.ignore, ["_old"]);
  assert.equal(result.publicUrl, "http://devhub.test");
  assert.equal("laragonRoot" in result, false, "Ein Laragon-Pfad gehört nicht in eine macOS-Konfiguration");
  assert.equal(detectPlatform("win32"), "win32");
  assert.equal(detectPlatform("freebsd"), "linux");
  assert.equal(suggestedStack({ laragonRoot: "C:\\laragon", herdRoot: null, valet: false }), "laragon");
  assert.equal(suggestedStack({ laragonRoot: null, herdRoot: "/x", valet: true }), "herd");
  assert.equal(suggestedStack({ laragonRoot: null, herdRoot: null, valet: false }), "none");
});
