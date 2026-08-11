export type LauncherKind = "package-script" | "batch" | "command" | "powershell" | "static-server" | "php-server";
export type RuntimeStatus = "stopped" | "starting" | "running" | "stopping" | "error";
export type AutostartMode = "dev" | "production";

export interface AppConfig {
  host: string;
  publicHost: string;
  autostartMode: AutostartMode;
  port: number;
  scanRoot: string;
  categoryDepth: number;
  maxDepth: number;
  maxEntriesPerProject: number;
  ignore: string[];
  laragonRoot: string;
  editor: string;
}

export interface LauncherDefinition {
  id: string;
  projectId: string;
  name: string;
  kind: LauncherKind;
  relativeCwd: string;
  command: string;
  cwd: string;
  executable: string;
  args: string[];
  dynamicPort: boolean;
  preferred: boolean;
}

export interface GitInfo {
  branch: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  changedFiles: number;
  remoteName: string | null;
  remoteUrl: string | null;
  upstream: string | null;
  repositoryRoot: string;
  files: Array<{
    path: string;
    originalPath: string | null;
    indexStatus: string;
    worktreeStatus: string;
  }>;
  filesTruncated: boolean;
  lastCommit: {
    hash: string;
    subject: string;
    author: string;
    date: string;
  } | null;
}

export interface ProjectDefinition {
  id: string;
  name: string;
  description: string;
  relativePath: string;
  absolutePath: string;
  category: string | null;
  categoryPath: string | null;
  thumbnailPath: string | null;
  modifiedAt: string;
  technologies: string[];
  kind: string;
  defaultUrl: string | null;
  webRoot: string | null;
  git: GitInfo | null;
  fileCount: number;
  launchers: LauncherDefinition[];
}

export interface LogEntry {
  timestamp: string;
  stream: "system" | "stdout" | "stderr";
  text: string;
}

export interface RuntimeSnapshot {
  status: RuntimeStatus;
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  exitCode: number | null;
  url: string | null;
  message: string | null;
}

export interface PublicLauncher extends Omit<LauncherDefinition, "cwd" | "executable" | "args"> {
  runtime: RuntimeSnapshot;
}

export interface PublicProject extends Omit<ProjectDefinition, "absolutePath" | "thumbnailPath" | "webRoot" | "launchers"> {
  thumbnailUrl: string | null;
  launchers: PublicLauncher[];
}

export interface SystemCapabilities {
  platform: NodeJS.Platform;
  editor: { available: boolean; name: string | null };
  terminal: { available: boolean; name: string | null };
  folder: boolean;
  folderPicker: boolean;
}

export interface LaragonStatus {
  installed: boolean;
  root: string | null;
  appRunning: boolean;
  webServer: "Apache" | "Nginx" | null;
  database: "MySQL" | "MariaDB" | "PostgreSQL" | null;
  mail: boolean;
  documentRoot: string | null;
  virtualHosts: number;
}
