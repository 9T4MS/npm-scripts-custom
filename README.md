# Latoo Scripts

`Latoo Scripts` is a VS Code extension that turns your `package.json` scripts into a fast, tabbed scripts runner inside the Explorer.

It is designed for monorepos and multi-root workspaces, with favorites, drag-and-drop ordering, quick actions, and internal/external terminal execution.

## Features

- **Monorepo-aware script discovery**
  - Detects workspaces from `pnpm-workspace.yaml` and `package.json#workspaces`.
  - Falls back to recursive `package.json` scanning when needed.
- **Tabbed scripts UI in Explorer**
  - One tab per workspace plus a favorites tab.
  - Drag and drop workspace tabs to persist custom tab order.
  - Horizontal wheel scrolling for long tab lists.
- **Favorites**
  - Star scripts and view them in a single favorites tab.
  - Favorites are grouped by workspace.
  - Drag-and-drop reorder favorite sections.
  - Keyboard reorder support: `Alt+ArrowUp` / `Alt+ArrowDown`.
- **Script run modes**
  - Click a script row to run in the configured primary location.
  - Optional one-click secondary location action (panel/editor opposite).
  - Reusable dedicated runner terminal or per-script terminals.
  - Busy terminal overflow support (opens a new terminal when current one is still running).
  - Safe retrigger guard for active scripts (restart/close prompt before re-running the same busy script).
- **External terminal support**
  - Run scripts in external window via configurable command template.
  - Built-in Warp optimized mode (default) with launch configuration for immediate execution.
  - Optional "open external tab and copy command" action.
- **Quality of life**
  - Open the exact script location in `package.json`.
  - Script icons inferred from script name and command (e.g. Vite, Webpack, Jest, Prisma, Docker, GraphQL).
  - Per-script terminal name/color overrides.
  - Right-click script context menu for per-script toggles (persistent terminal, panel/editor location, envName disable, always-new internal terminal).
  - View header quick settings dropdown (next to refresh) for action visibility and primary click mode.
  - Favorites section header actions are shown on hover/focus to reduce visual noise.
  - `envName` propagation for script execution and external command templates.
  - Auto-refresh when `package.json` files or workspace folders change.

## Requirements

- VS Code `^1.85.0`
- A Node.js project with at least one `package.json` containing scripts
- For default external execution behavior: Warp terminal on macOS (optional)

## Installation

### From a `.vsix` package

1. Build:
   - `pnpm run package`
2. Install into Cursor/VS Code:
   - Cursor: `pnpm run install:cursor`
   - Or manually install the generated `.vsix` from the Extensions UI

## How To Use

1. Open a workspace that contains `package.json` scripts.
2. Open Explorer and locate the **Latoo Scripts** view.
3. Click a script row to run it (uses configured internal run location).
4. Use action icons on hover to:
   - Open script in `package.json`
   - Run in secondary location (panel/editor)
   - Run in external terminal
   - Open external tab and copy command
   - Toggle favorite
5. Right-click a script row (or press `Shift+F10`) for per-script config shortcuts:
   - Toggle persistent terminal
   - Toggle default run location (panel/editor)
   - Toggle disable envName for this script
   - Toggle always-open in new internal terminal for that script
6. Use the view header quick settings dropdown to toggle:
   - Quick action visibility
   - Primary click behavior (internal/external)
7. Reorder tabs and favorite sections via drag-and-drop.

## Settings

All settings are under the `latooScripts.*` namespace.

### External run

- `latooScripts.externalRun.commandTemplate`
  - Template used for "Run in external window".
  - Default:
    - `open "warp://action/new_tab?path={workspacePathUri}&command={runCommandUri}"`
  - Supported placeholders:
    - `{workspacePath}`, `{scriptName}`, `{packageManager}`, `{runCommand}`, `{envName}`
    - `{workspacePathEscaped}`, `{scriptNameEscaped}`, `{packageManagerEscaped}`, `{runCommandEscaped}`, `{envNameEscaped}`
    - `{workspacePathUri}`, `{scriptNameUri}`, `{packageManagerUri}`, `{runCommandUri}`, `{envNameUri}`

### envName

- `latooScripts.envName.default` (default: `local-0`)
- `latooScripts.envName.useWorkspaceFolderName` (default: `true`)
  - Uses the primary workspace folder name only for Git worktrees.
- `latooScripts.envName.enabled` (default: `true`)
  - Controls whether `envName` hint is shown in the view header.
- `latooScripts.envName.includeScripts` (default: `["*"]`)
  - Controls which scripts receive automatic `envName` injection.
- `latooScripts.envName.excludeScripts` (default: `[]`)
  - Excludes scripts from automatic `envName` injection.
  - Patterns support `*` and optional workspace-qualified syntax:
    - `scriptPattern` (applies across all workspaces)
    - `<workspacePathPattern>::<scriptPattern>`

### Internal run behavior

- `latooScripts.internalRun.mode`
  - `perScript` (default): one terminal per workspace+script
  - `dedicated`: one shared runner terminal
- `latooScripts.internalRun.includeScripts` (default: `["*"]`)
- `latooScripts.internalRun.excludeScripts` (default: `[]`)
  - Controls where internal run behavior settings apply (`mode`, `location`, `preserveFocus`, `openNewWhenBusy`).
  - Exclude patterns override include patterns.
- `latooScripts.internalRun.location`
  - `panel` (default) or `editor`
- `latooScripts.internalRun.locationOverrides` (default: `{}`)
  - Optional per-script location override map keyed by `<workspacePath>::<scriptName>`.
- `latooScripts.internalRun.preserveFocus` (default: `true`)
- `latooScripts.internalRun.openNewWhenBusy` (default: `true`)
  - If the same script is already running in its terminal, the extension asks whether to restart or close it.

### Persistent terminal styling

- `latooScripts.persistentTerminal.overrides`
  - Object keyed by `<workspacePath>::<scriptName>`
  - Value example:
    - `{ "name": "My Dev", "color": "terminal.ansiBlue" }`
- `latooScripts.persistentTerminal.includeScripts` (default: `["*"]`)
- `latooScripts.persistentTerminal.excludeScripts` (default: `[]`)
  - Controls where persistent terminal naming/color behavior applies.
  - Exclude patterns override include patterns.
- `latooScripts.persistentTerminal.defaultColors`
  - Default palette:
    - `terminal.ansiBlue`
    - `terminal.ansiCyan`
    - `terminal.ansiGreen`
    - `terminal.ansiMagenta`
    - `terminal.ansiYellow`
    - `terminal.ansiRed`

### Action visibility and primary click

- `latooScripts.actions.showOpenScript` (default: `false`)
- `latooScripts.actions.showRunSecondary` (default: `true`)
- `latooScripts.actions.showRunExternal` (default: `true`)
- `latooScripts.actions.showOpenExternalTabCopyCommand` (default: `false`)
- `latooScripts.actions.showFavorite` (default: `true`)
- `latooScripts.primaryClick.target` (default: `internal`)
  - `internal`: primary row click runs internal terminal flow
  - `external`: primary row click runs external command flow
- `latooScripts.internalRun.alwaysNewOverrides` (default: `{}`)
  - Optional per-script override map keyed by `<workspacePath>::<scriptName>` to always open a new internal terminal.

## Example Configuration

```json
{
  "latooScripts.internalRun.mode": "perScript",
  "latooScripts.internalRun.excludeScripts": ["/Users/me/repo::dev:*"],
  "latooScripts.internalRun.location": "editor",
  "latooScripts.internalRun.locationOverrides": {
    "/Users/me/repo/apps/web::dev": "panel"
  },
  "latooScripts.internalRun.preserveFocus": true,
  "latooScripts.envName.default": "local-0",
  "latooScripts.envName.includeScripts": ["*"],
  "latooScripts.envName.excludeScripts": ["test:*"],
  "latooScripts.persistentTerminal.excludeScripts": ["*::lint*"],
  "latooScripts.primaryClick.target": "internal",
  "latooScripts.externalRun.commandTemplate": "open \"warp://action/new_tab?path={workspacePathUri}&command={runCommandUri}\"",
  "latooScripts.actions.showOpenExternalTabCopyCommand": false
}
```

## Commands

- `Latoo Scripts: Quick Settings`
- `Latoo Scripts: Refresh Scripts`

## Development

- Install dependencies:
  - `pnpm install`
- Build:
  - `pnpm run compile`
- Watch:
  - `pnpm run watch`
- Package extension:
  - `pnpm run package`
- Re-package and reinstall into Cursor:
  - `pnpm run reinstall:cursor`

## License And Third-Party Notices

- Third-party icon notices: [`THIRD_PARTY_NOTICES.md`]
