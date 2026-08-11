# DevHub

DevHub is a local dashboard for finding, opening, running, and maintaining the projects on your development machine. Point it at the folder that contains your repositories and it builds a visual workbench from the files that are already there—no per-project registration required.

The server binds to your loopback interface by default. Project paths, Git state, process output, and configuration stay on your computer.

## What it does

- Discovers every direct child of a workspace folder as a project.
- Watches the workspace and refreshes projects and Git state live over server-sent events—no manual reload, and unchanged cards are left untouched so the UI never flickers.
- Detects common stacks such as Node.js, React, Vue, Next.js, PHP, Laravel, Symfony, Python, Docker, and static HTML.
- Creates launch actions from `package.json` scripts, `start.bat`, `start.cmd`, `start.ps1`, static sites, and PHP entry points.
- Starts and stops development processes, assigns free preview ports, and streams their output.
- Shows Git branch, sync state, changed files, diffs, staging controls, commits, and pushes in one workbench.
- Opens projects in the file manager, terminal, or a detected editor.
- Supports favorites, recent projects, a context-aware global search (`Ctrl+K`), technology filters, and grid/list views.
- Includes a workspace-wide Git control center for browsing every repository, exploring the complete commit history and per-commit diffs, selecting and staging files in batches, safely discarding local changes, generating local commit-message suggestions, committing, and syncing without leaving DevHub.
- Supports switching and creating branches, undoing the last unpushed commit (changes stay staged), and discarding new files to the Windows Recycle Bin instead of deleting them permanently.
- Integrates with Laragon on Windows, including local virtual hosts and service controls.
- Can start silently when you sign in to Windows.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer
- npm
- Git for repository status and Git actions
- Windows for Laragon integration and the included scheduled-task installer

The core dashboard also runs on macOS and Linux. Some operating-system actions are currently Windows-specific.

## Quick start

```bash
git clone https://github.com/DysphoDE/DevHub.git
cd DevHub
npm install
npm run dev
```

Open [http://localhost:7331](http://localhost:7331).

DevHub initially uses the parent folder of the repository as its workspace. Click the workspace path in the top-left corner to choose a different folder. On Windows and macOS you can use the native folder picker; on every platform you can enter an absolute path.

The selection is saved in a local `devhub.config.json` file. That file is ignored by Git, so machine-specific paths are never committed.

## Workspace layout

Every folder is classified in three steps, which lets projects sit several levels below the workspace root:

1. **Own traces** — a manifest, a `.git` directory, source files, or an `index.html`/`index.php` make the folder a project. Its subfolders belong to it (monorepos stay one project).
2. **Bundles projects** — a folder without traces of its own whose children are projects becomes a category, and the search continues one level deeper.
3. **Code somewhere below** — otherwise the folder is only a project if any source file exists underneath. Folders holding nothing but documents, exports, or images are skipped.

```text
F:\
├── projects/                ← category
│   ├── customer-portal/     ← project
│   └── docs-site/           ← project
├── clients/                 ← category
│   └── bernd-stapfner/      ← category
│       ├── website/         ← project (named after the client folder)
│       ├── variants/        ← project
│       ├── uebergabe/       ← skipped (PDFs and HTML exports, no code)
│       └── resources/       ← skipped (images)
├── pizza-recipe/            ← project (source files, no category)
└── projects/devhub/         ← listed for Git and project actions
```

Loose `.html`, `.css`, or `.md` files do not count as source code — otherwise every documentation folder would show up as a project. Conventional subfolder names (`src`, `public`, `assets`, `docs`, …) never become projects of their own.

Categories appear as filters in the sidebar. Set `categoryDepth` to `0` to disable the grouping and read every direct child as a project again, or lower it to limit how deep categories may nest.

Project metadata and launchers may be discovered recursively within each project. Large dependency and build directories are skipped automatically.

### Browser button

The green *Open in browser* action only appears when a running web server can actually answer. A Laragon virtual host counts only if its `DocumentRoot` holds an `index.php`, or an `index.html` that is not raw source — a bundler config or a `package.json` next to a `src/` directory means the folder still needs a build. Projects that only run through `npm run dev` therefore show their launcher instead of a link that would lead to a directory listing.

When DevHub itself is inside the selected workspace, it remains visible so you can open it and use the Git workbench. Its own launch actions are hidden to prevent starting a second DevHub server on the same port.

## Production mode

Build and run the compiled server:

```bash
npm run build
npm start
```

The default address is [http://localhost:7331](http://localhost:7331). DevHub only accepts local connections unless remote access is explicitly enabled.

## Configuration

Most users only need the workspace control in the UI. For additional settings, copy the example configuration:

```powershell
Copy-Item devhub.config.example.json devhub.config.json
```

On macOS or Linux:

```bash
cp devhub.config.example.json devhub.config.json
```

Important options:

| Option | Default | Purpose |
| --- | --- | --- |
| `host` | `127.0.0.1` | Address the local server binds to |
| `publicHost` | `devhub` | Hostname used by the Windows installer |
| `port` | `7331` | DevHub HTTP port |
| `scanRoot` | `..` | Workspace containing the project folders |
| `categoryDepth` | `3` | Levels of category folders above the projects (`0` disables grouping) |
| `maxDepth` | `5` | Maximum metadata scan depth per project |
| `maxEntriesPerProject` | `15000` | Safety limit for scanned entries |
| `laragonRoot` | `C:\laragon` | Laragon installation directory |
| `editor` | `auto` | Editor executable or automatic detection |
| `autostartMode` | `dev` | `dev` for the watcher or `production` for the compiled server |
| `ignore` | `[]` | Additional directory names to ignore |

Environment variables override file configuration:

- `DEVHUB_ROOT`
- `DEVHUB_PORT`
- `DEVHUB_HOST`
- `DEVHUB_PUBLIC_HOST`
- `DEVHUB_AUTOSTART_MODE`

When `DEVHUB_ROOT` is set, the workspace is intentionally locked and cannot be changed from the UI. Binding to a non-loopback address additionally requires `DEVHUB_ALLOW_REMOTE=1`.

## Windows autostart

Run the installer from an elevated PowerShell prompt, or accept the UAC prompt it opens:

```powershell
npm run windows:install
```

The installer:

- builds the application;
- adds the configured `publicHost` to the Windows hosts file;
- creates the `DevHub Node` scheduled task for the current user;
- starts DevHub without a visible terminal window; and
- writes autostart output to `.devhub\autostart.log`.

After installation, the default configuration is available at [http://devhub:7331](http://devhub:7331).

Remove the task and managed hosts entry with:

```powershell
npm run windows:uninstall
```

## Project discovery

DevHub uses existing project files instead of a central registry. Among other signals, it reads:

- `package.json` scripts and dependencies;
- `composer.json` packages;
- Git metadata;
- README headings and descriptions;
- HTML and PHP entry points;
- `start.bat`, `start.cmd`, and `start.ps1`; and
- optional `thumbnail.jpg`, `thumbnail.png`, `thumbnail.webp`, or `thumbnail.gif` files.

Only scripts and files inside the selected workspace are considered. Launch actions still execute local code with your user permissions, so only start projects you trust.

## Development

```bash
npm run check    # TypeScript type-check
npm test         # Node test suite
npm run build    # Compile to dist/
npm run verify   # Run all checks above
```

Repository structure:

```text
public/      Browser UI (HTML, CSS, JavaScript)
runtime/     Static preview server
scripts/     Windows autostart helpers
src/         TypeScript server, scanner, Git, and process management
tests/       Scanner, configuration, Git, and process tests
```

## Security model

- The server binds to a loopback address and rejects non-local clients by default.
- State-changing API requests require a session-specific token.
- The UI is served with a restrictive Content Security Policy.
- Absolute project paths are not included in public project API objects.
- Local configuration, logs, build output, and dependencies are excluded from Git.

If you intentionally expose DevHub beyond your own machine, review the security implications first. It can launch processes, access repositories, and perform Git operations with the permissions of the DevHub process.

## Contributing

Issues and pull requests are welcome. Please run `npm run verify` before submitting a change.
