import { getAppDirectory, loadConfig } from "./config.js";
import { installAutostart, uninstallAutostart } from "./autostart.js";
import type { AutostartMode } from "./types.js";

const command = process.argv[2];
const modeArgument = process.argv.find((value) => value.startsWith("--mode="))?.slice(7);

try {
  const config = await loadConfig();
  if (command === "install") {
    const mode = (modeArgument ?? config.autostartMode) as AutostartMode;
    if (mode !== "dev" && mode !== "production") throw new Error(`Ungültiger Modus: ${mode}`);
    console.log(await installAutostart(config, getAppDirectory(), mode));
    console.log(`Adresse: ${config.publicUrl ?? `http://${config.publicHost}:${config.port}`}`);
  } else if (command === "uninstall") {
    console.log(await uninstallAutostart(getAppDirectory()));
    console.log("Ein bereits laufender DevHub-Prozess wird dadurch nicht beendet.");
  } else {
    console.error("Verwendung: autostart-cli <install|uninstall> [--mode=dev|production]");
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
