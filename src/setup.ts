import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { autostartDescription, installAutostart } from "./autostart.js";
import { defaults, getAppDirectory, isValidPublicHost, readConfigFile, resolveConfiguredPath, writeConfigFile } from "./config.js";
import { defaultHerdRoot } from "./herd.js";
import { commandPath, expandHome, fileExists, platformName } from "./platform.js";
import { getSystemCapabilities } from "./system-actions.js";
import type { AppConfig, AutostartMode, StackSelection } from "./types.js";

/**
 * Interaktive Einrichtung: erkennt Betriebssystem, lokalen Stack, Editor und Terminal, fragt
 * den Workspace ab und schreibt devhub.config.json. Optional richtet sie den Autostart und
 * unter Herd eine lokale Domain (devhub.test) ein. Mit --yes werden alle Vorschläge übernommen
 * (--no-autostart und --herd-proxy steuern die optionalen Schritte).
 */
export type SetupPlatform = "win32" | "darwin" | "linux";

export interface SetupAnswers {
  platform: SetupPlatform;
  scanRoot: string;
  stack: StackSelection;
  laragonRoot: string | null;
  herdRoot: string | null;
  editor: string;
  terminal: string;
  port: number;
  publicHost: string;
  publicUrl: string | null;
  autostartMode: AutostartMode;
}

export interface DetectedStacks {
  laragonRoot: string | null;
  herdRoot: string | null;
  valet: boolean;
}

export function detectPlatform(platform: NodeJS.Platform = process.platform): SetupPlatform {
  return platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux";
}

/** Reine Zusammenführung: bestehende Datei bleibt erhalten, Antworten überschreiben nur ihre Felder. */
export function buildConfig(existing: Record<string, unknown>, answers: SetupAnswers): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...existing,
    platform: answers.platform,
    host: typeof existing.host === "string" ? existing.host : defaults.host,
    publicHost: answers.publicHost,
    publicUrl: answers.publicUrl,
    autostartMode: answers.autostartMode,
    port: answers.port,
    scanRoot: answers.scanRoot,
    categoryDepth: existing.categoryDepth ?? defaults.categoryDepth,
    maxDepth: existing.maxDepth ?? defaults.maxDepth,
    maxEntriesPerProject: existing.maxEntriesPerProject ?? defaults.maxEntriesPerProject,
    stack: answers.stack,
    editor: answers.editor,
    terminal: answers.terminal,
    ignore: Array.isArray(existing.ignore) ? existing.ignore : []
  };
  if (answers.laragonRoot) next.laragonRoot = answers.laragonRoot; else delete next.laragonRoot;
  if (answers.herdRoot) next.herdRoot = answers.herdRoot; else delete next.herdRoot;
  return next;
}

export async function detectStacks(platform: SetupPlatform, home = os.homedir()): Promise<DetectedStacks> {
  const laragonCandidates = platform === "win32" ? ["C:\\laragon", "D:\\laragon", path.join(process.env.LOCALAPPDATA ?? "", "laragon")] : [];
  let laragonRoot: string | null = null;
  for (const candidate of laragonCandidates) {
    if (candidate && await fileExists(path.join(candidate, "laragon.exe"))) { laragonRoot = candidate; break; }
  }
  const herdRootCandidate = defaultHerdRoot(platform, home);
  const herdRoot = await fileExists(path.join(herdRootCandidate, "config", "valet", "config.json")) ? herdRootCandidate : null;
  const valet = await fileExists(path.join(home, ".config", "valet", "config.json"));
  return { laragonRoot, herdRoot, valet };
}

export function suggestedStack(detected: DetectedStacks): StackSelection {
  if (detected.laragonRoot) return "laragon";
  if (detected.herdRoot) return "herd";
  if (detected.valet) return "valet";
  return "none";
}

interface Prompter {
  ask(question: string, fallback: string): Promise<string>;
  choose<T extends string>(question: string, options: Array<{ value: T; label: string }>, fallback: T): Promise<T>;
  confirm(question: string, fallback: boolean): Promise<boolean>;
  close(): void;
}

function createPrompter(acceptDefaults: boolean): Prompter {
  const rl = acceptDefaults ? null : createInterface({ input: process.stdin, output: process.stdout });
  return {
    async ask(question, fallback) {
      if (!rl) { console.log(`${question} ${fallback}`); return fallback; }
      const answer = (await rl.question(`${question} [${fallback}] `)).trim();
      return answer || fallback;
    },
    async choose(question, options, fallback) {
      const fallbackIndex = Math.max(0, options.findIndex((option) => option.value === fallback));
      console.log(question);
      options.forEach((option, index) => console.log(`  ${index + 1}) ${option.label}${index === fallbackIndex ? "  (Vorschlag)" : ""}`));
      if (!rl) return options[fallbackIndex].value;
      for (;;) {
        const answer = (await rl.question(`Auswahl [${fallbackIndex + 1}]: `)).trim();
        if (!answer) return options[fallbackIndex].value;
        const index = Number(answer) - 1;
        if (Number.isInteger(index) && options[index]) return options[index].value;
        const byValue = options.find((option) => option.value === answer);
        if (byValue) return byValue.value;
        console.log("Bitte eine der angebotenen Nummern eingeben.");
      }
    },
    async confirm(question, fallback) {
      if (!rl) { console.log(`${question} ${fallback ? "ja" : "nein"}`); return fallback; }
      const answer = (await rl.question(`${question} [${fallback ? "J/n" : "j/N"}] `)).trim().toLowerCase();
      if (!answer) return fallback;
      return ["j", "ja", "y", "yes"].includes(answer);
    },
    close() { rl?.close(); }
  };
}

async function askDirectory(prompter: Prompter, question: string, fallback: string): Promise<string> {
  for (;;) {
    const answer = resolveConfiguredPath(expandHome(await prompter.ask(question, fallback)), process.cwd());
    const info = await stat(answer).catch(() => null);
    if (info?.isDirectory()) return answer;
    console.log(`Der Ordner ${answer} existiert nicht. Bitte erneut eingeben.`);
    if (answer === fallback) throw new Error("Der Workspace-Ordner wurde nicht gefunden.");
  }
}

function runInherit(executable: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: "inherit", windowsHide: true, shell: process.platform === "win32" });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${executable} ${args.join(" ")} endete mit Code ${code}.`)));
  });
}

async function herdCli(herdRoot: string): Promise<string | null> {
  const bundled = path.join(herdRoot, "bin", process.platform === "win32" ? "herd.bat" : "herd");
  if (await fileExists(bundled)) return bundled;
  return commandPath("herd");
}

export async function runSetup(argv: string[] = process.argv.slice(2)): Promise<void> {
  const acceptDefaults = argv.includes("--yes") || argv.includes("-y");
  const skipAutostart = argv.includes("--no-autostart");
  const appRoot = getAppDirectory();
  const configPath = path.join(appRoot, "devhub.config.json");
  const existing = await readConfigFile(configPath);
  const prompter = createPrompter(acceptDefaults);

  try {
    console.log("");
    console.log("DevHub-Einrichtung");
    console.log("==================");
    const detectedPlatform = detectPlatform();
    console.log(`Erkanntes System: ${platformName()} (${process.platform}, Node ${process.version})`);
    const platform = await prompter.choose("Für welches Betriebssystem soll DevHub eingerichtet werden?", [
      { value: "win32" as SetupPlatform, label: "Windows (Laragon oder Herd)" },
      { value: "darwin" as SetupPlatform, label: "macOS (Herd oder Valet)" },
      { value: "linux" as SetupPlatform, label: "Linux (Valet oder ohne Stack)" }
    ], detectedPlatform);
    if (platform !== detectedPlatform) {
      console.log(`Hinweis: Du richtest ${platformName(platform)} ein, dieser Rechner läuft aber unter ${platformName()}. Systemaktionen folgen immer dem tatsächlichen System.`);
    }

    console.log("");
    const existingRoot = typeof existing.scanRoot === "string" ? resolveConfiguredPath(existing.scanRoot, appRoot) : null;
    const existingRootUsable = existingRoot ? (await stat(existingRoot).catch(() => null))?.isDirectory() ?? false : false;
    const scanRoot = await askDirectory(prompter, "Welcher Ordner enthält deine Projekte?", existingRootUsable && existingRoot ? existingRoot : path.dirname(appRoot));

    console.log("");
    const detected = await detectStacks(platform);
    const stackOptions: Array<{ value: StackSelection; label: string }> = [
      { value: "auto", label: "Automatisch erkennen (empfohlen, wenn sich dein Setup ändert)" },
      ...(platform === "win32" ? [{ value: "laragon" as StackSelection, label: `Laragon${detected.laragonRoot ? ` · gefunden unter ${detected.laragonRoot}` : " · nicht gefunden"}` }] : []),
      ...(platform !== "linux" ? [{ value: "herd" as StackSelection, label: `Herd${detected.herdRoot ? ` · gefunden unter ${detected.herdRoot}` : " · nicht gefunden"}` }] : []),
      ...(platform !== "win32" ? [{ value: "valet" as StackSelection, label: `Laravel Valet${detected.valet ? " · gefunden" : " · nicht gefunden"}` }] : []),
      { value: "none", label: "Kein lokaler Stack (nur Starter und Git)" }
    ];
    const suggestion = suggestedStack(detected);
    const stack = await prompter.choose("Welcher lokale Webserver-Stack läuft auf diesem System?", stackOptions, suggestion === "none" ? "none" : suggestion);
    let laragonRoot: string | null = null;
    let herdRoot: string | null = null;
    if (stack === "laragon" || (stack === "auto" && platform === "win32")) {
      laragonRoot = await prompter.ask("Laragon-Installationsordner:", detected.laragonRoot ?? (typeof existing.laragonRoot === "string" ? existing.laragonRoot : "C:\\laragon"));
    }
    if (stack === "herd" || (stack === "auto" && detected.herdRoot)) {
      const proposed = detected.herdRoot ?? (typeof existing.herdRoot === "string" ? existing.herdRoot : defaultHerdRoot(platform));
      const answer = await prompter.ask("Herd-Datenordner:", proposed);
      herdRoot = answer === defaultHerdRoot(platform) ? null : answer;
    }

    console.log("");
    const probeConfig: AppConfig = {
      ...defaults, scanRoot, stack, laragonRoot: laragonRoot ?? defaults.laragonRoot, herdRoot: herdRoot ?? defaultHerdRoot(),
      editor: typeof existing.editor === "string" ? existing.editor : "auto", terminal: typeof existing.terminal === "string" ? existing.terminal : "auto"
    };
    const capabilities = await getSystemCapabilities(probeConfig);
    console.log(`Editor: ${capabilities.editor.name ?? "keiner erkannt"} · Terminal: ${capabilities.terminal.name ?? "keines erkannt"} · Papierkorb: ${capabilities.trash.available ? "ja" : "nein"}`);
    const editor = await prompter.ask("Editor (auto, Kommando, Pfad oder macOS-App-Name):", probeConfig.editor);
    const terminal = await prompter.ask("Terminal (auto, Kommando, Pfad oder macOS-App-Name):", probeConfig.terminal);

    console.log("");
    let port = defaults.port;
    for (;;) {
      port = Number(await prompter.ask("Port für DevHub:", String(existing.port ?? defaults.port)));
      if (Number.isInteger(port) && port > 0 && port < 65536) break;
      console.log("Bitte einen Port zwischen 1 und 65535 angeben.");
    }
    let publicHost = typeof existing.publicHost === "string" ? existing.publicHost : defaults.publicHost;
    let publicUrl: string | null = typeof existing.publicUrl === "string" ? existing.publicUrl : null;
    const autostartMode = await prompter.choose("Wie soll DevHub laufen?", [
      { value: "dev" as AutostartMode, label: "dev · Quellcode mit Watcher (npm run dev)" },
      { value: "production" as AutostartMode, label: "production · kompilierter Server (npm run build && npm start)" }
    ], (existing.autostartMode as AutostartMode) ?? defaults.autostartMode);

    // Herd kann DevHub selbst unter einer .test-Domain bereitstellen – Windows braucht dafür sonst einen hosts-Eintrag.
    const herdDataRoot = herdRoot ?? (detected.herdRoot ?? null);
    if ((stack === "herd" || (stack === "auto" && detected.herdRoot)) && herdDataRoot && platform === detectedPlatform) {
      const cli = await herdCli(herdDataRoot);
      // Mit --yes wird der Proxy nur auf ausdrücklichen Wunsch (--herd-proxy) angelegt – er verändert die Herd-Konfiguration.
      const wantsProxy = acceptDefaults ? argv.includes("--herd-proxy") : await prompter.confirm("Soll Herd DevHub unter http://devhub.test bereitstellen (herd proxy)?", true);
      if (cli && wantsProxy) {
        try {
          await runInherit(cli, ["proxy", "devhub", `http://127.0.0.1:${port}`], appRoot);
          publicHost = "devhub.test";
          publicUrl = "http://devhub.test";
          console.log("Herd-Proxy eingerichtet: http://devhub.test");
        } catch (error) {
          console.log(`Der Herd-Proxy konnte nicht angelegt werden: ${error instanceof Error ? error.message : error}`);
        }
      }
    } else if (platform === "win32") {
      publicHost = await prompter.ask("Lokaler Hostname (wird vom Windows-Installer in die hosts-Datei eingetragen):", publicHost);
    }
    if (!isValidPublicHost(publicHost)) throw new Error(`Ungültiger Hostname: ${publicHost}`);

    const answers: SetupAnswers = { platform, scanRoot, stack, laragonRoot, herdRoot, editor, terminal, port, publicHost, publicUrl, autostartMode };
    await writeConfigFile(buildConfig(existing, answers), configPath);
    console.log("");
    console.log(`Konfiguration gespeichert: ${configPath}`);
    console.log(`Workspace: ${scanRoot}`);
    console.log(`Stack: ${stack}${laragonRoot ? ` (Laragon: ${laragonRoot})` : ""}${herdRoot ? ` (Herd: ${herdRoot})` : ""}`);
    console.log(`Adresse: ${publicUrl ?? `http://${publicHost}:${port}`}${publicUrl ? ` (direkt: http://127.0.0.1:${port})` : ""}`);

    if (!skipAutostart && platform === detectedPlatform) {
      console.log("");
      if (await prompter.confirm(`Autostart jetzt einrichten? (${autostartDescription()})`, false)) {
        if (autostartMode === "production" && !await fileExists(path.join(appRoot, "dist", "server.js"))) {
          console.log("Produktions-Build fehlt – npm run build wird ausgeführt …");
          await runInherit(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], appRoot);
        }
        const config: AppConfig = { ...probeConfig, port, publicHost, publicUrl, autostartMode, editor, terminal };
        console.log(await installAutostart(config, appRoot, autostartMode));
      } else {
        console.log(`Später möglich mit: npm run autostart:install`);
      }
    }

    console.log("");
    console.log(`Fertig. Starte DevHub mit „npm run ${autostartMode === "dev" ? "dev" : "build && npm start"}“ und öffne ${publicUrl ?? `http://localhost:${port}`}.`);
  } finally {
    prompter.close();
  }
}

if (process.argv[1] && /setup\.(?:ts|js)$/.test(process.argv[1])) {
  runSetup().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
