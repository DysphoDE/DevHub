import { herdStack } from "./herd.js";
import { laragonStack } from "./laragon.js";
import { noStack, type LocalStack } from "./stack.js";
import type { AppConfig } from "./types.js";

let cached: { key: string; stack: LocalStack } | null = null;

/**
 * Wählt den lokalen Stack: explizit per Konfiguration oder automatisch anhand dessen, was
 * installiert ist. Unter Windows hat Laragon Vorrang, Herd und Valet gelten überall.
 */
export async function resolveStack(config: AppConfig): Promise<LocalStack> {
  const key = `${config.stack}|${config.laragonRoot}|${config.herdRoot}`;
  if (cached?.key === key) return cached.stack;
  let stack: LocalStack = noStack;
  if (config.stack === "laragon") stack = laragonStack;
  else if (config.stack === "herd" || config.stack === "valet") stack = herdStack;
  else if (config.stack === "auto") {
    if (await laragonStack.isInstalled(config)) stack = laragonStack;
    else if (await herdStack.isInstalled(config)) stack = herdStack;
  }
  cached = { key, stack };
  return stack;
}

export function resetStackCache(): void {
  cached = null;
}
