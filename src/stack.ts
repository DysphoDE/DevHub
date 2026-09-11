import type { AppConfig, StackActionId, StackProvider, StackStatus, StackWebInfo } from "./types.js";

/**
 * Ein lokaler Entwicklungs-Stack (Laragon unter Windows, Herd oder Valet unter macOS/Windows/Linux).
 * DevHub fragt ihn nach laufenden Diensten, lokalen Domains und steuerbaren Aktionen –
 * die Oberfläche kennt keine Produktnamen mehr, sondern nur dieses Modell.
 */
export interface LocalStack {
  readonly provider: StackProvider;
  readonly name: string;
  isInstalled(config: AppConfig): Promise<boolean>;
  getStatus(config: AppConfig): Promise<StackStatus>;
  readWebInfo(config: AppConfig): Promise<StackWebInfo>;
  runAction(config: AppConfig, action: StackActionId): Promise<string>;
}

export const noStack: LocalStack = {
  provider: "none",
  name: "Lokaler Stack",
  async isInstalled() { return false; },
  async getStatus() {
    return {
      provider: "none", name: "Lokaler Stack", installed: false, root: null, appRunning: false,
      webServerName: "Webserver", webServer: null, database: null, mail: false, documentRoot: null, sites: 0, tld: null, actions: []
    };
  },
  async readWebInfo() { return { documentRoot: null, sites: [] }; },
  async runAction() { throw new Error("Es ist kein lokaler Stack (Laragon, Herd oder Valet) eingerichtet."); }
};

export function isStackAction(value: string): value is StackActionId {
  return value === "open" || value === "start" || value === "stop" || value === "reload";
}
