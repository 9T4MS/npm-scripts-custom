import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import { exec } from 'child_process';
import { TerminalManager as ITerminalManager, InternalRunOptions } from './types';

const defaultExternalRunCommandTemplate =
  'open "warp://action/new_tab?path={workspacePathUri}&command={runCommandUri}"';
const warpLaunchConfigurationsDir = path.join(os.homedir(), '.warp', 'launch_configurations');

const DEDICATED_RUNNER_TERMINAL_NAME = 'Latoo Scripts • Runner';
const WARP_LAUNCH_CONFIG_PREFIX = 'latoo-scripts-';
const WARP_CONFIG_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export function createTerminalManager(): ITerminalManager {
  const terminals = new Map<string, vscode.Terminal>();
  const busyTerminals = new WeakSet<vscode.Terminal>();
  const activeRunContextByTerminal = new WeakMap<vscode.Terminal, { key: string; workspacePath: string; scriptName: string }>();
  const managedEditorTerminals = new Set<vscode.Terminal>();
  let overflowCounter = 0;

  // Clean up map entries when terminals are closed
  const closeListener = vscode.window.onDidCloseTerminal((terminal) => {
    removeTerminalFromMaps(terminal);
  });

  // Track busy state via shell integration events (VS Code 1.93+).
  // On older VS Code the events don't exist — busyTerminals stays empty → always reuse.
  const startDisposable = vscode.window.onDidStartTerminalShellExecution
    ? vscode.window.onDidStartTerminalShellExecution((event: { terminal: vscode.Terminal }) => {
        busyTerminals.add(event.terminal);
      })
    : undefined;
  const endDisposable = vscode.window.onDidEndTerminalShellExecution
    ? vscode.window.onDidEndTerminalShellExecution((event: { terminal: vscode.Terminal }) => {
        busyTerminals.delete(event.terminal);
        activeRunContextByTerminal.delete(event.terminal);
      })
    : undefined;

  return {
    run(
      workspacePath: string,
      scriptName: string,
      scriptCommand: string,
      isRawCommand: boolean,
      packageManager: string,
      envName: string,
      injectEnvName: boolean,
      options: InternalRunOptions
    ): void {
      const key = getTerminalKey(workspacePath, scriptName, options);
      const terminalName = getTerminalDisplayName(workspacePath, scriptName, options);
      const terminalColor = toTerminalThemeColor(options.terminalStyle?.color);
      const runCommand = buildRunCommand(
        workspacePath,
        scriptName,
        scriptCommand,
        isRawCommand,
        packageManager,
        envName,
        injectEnvName
      );

      let terminal = terminals.get(key);

      if (options.alwaysNewTerminal) {
        overflowCounter++;
        const alwaysNewTerminal = createManagedTerminal({
          name: `${terminalName} #${overflowCounter}`,
          cwd: workspacePath,
          location: toTerminalLocation(options.location),
          color: terminalColor,
        });
        alwaysNewTerminal.show(options.preserveFocus);
        alwaysNewTerminal.sendText(runCommand);
        activeRunContextByTerminal.set(alwaysNewTerminal, { key, workspacePath, scriptName });
        return;
      }

      // Busy-aware: spawn overflow terminal instead of interrupting
      if (terminal && busyTerminals.has(terminal)) {
        const activeContext = activeRunContextByTerminal.get(terminal);
        const isSameRunningScript = activeContext?.key === key
          && activeContext.workspacePath === workspacePath
          && activeContext.scriptName === scriptName;
        if (isSameRunningScript) {
          void promptForBusyScriptAction({
            key,
            workspacePath,
            scriptName,
            runCommand,
            terminalName,
            terminalColor,
            options,
            terminal,
          });
          return;
        }
        if (options.openNewWhenBusy) {
          overflowCounter++;
          const overflow = createManagedTerminal({
            name: `${terminalName} #${overflowCounter}`,
            cwd: workspacePath,
            location: toTerminalLocation(options.location),
            color: terminalColor,
          });
          overflow.show(options.preserveFocus);
          overflow.sendText(runCommand);
          activeRunContextByTerminal.set(overflow, { key, workspacePath, scriptName });
          return;
        }
      }

      if (terminal) {
        terminal.show(options.preserveFocus);
        terminal.sendText(runCommand);
        activeRunContextByTerminal.set(terminal, { key, workspacePath, scriptName });
        return;
      }

      terminal = createManagedTerminal({
        name: terminalName,
        cwd: workspacePath,
        location: toTerminalLocation(options.location),
        color: terminalColor,
      });
      terminals.set(key, terminal);
      terminal.show(options.preserveFocus);
      terminal.sendText(runCommand);
      activeRunContextByTerminal.set(terminal, { key, workspacePath, scriptName });
    },

    runExternal(
      workspacePath: string,
      scriptName: string,
      scriptCommand: string,
      isRawCommand: boolean,
      packageManager: string,
      envName: string,
      injectEnvName: boolean,
      commandTemplate: string
    ): void {
      const runCommand = buildRunCommand(
        workspacePath,
        scriptName,
        scriptCommand,
        isRawCommand,
        packageManager,
        envName,
        injectEnvName
      );
      const command = interpolateCommandTemplate(commandTemplate, {
        workspacePath,
        scriptName,
        packageManager,
        runCommand,
        envName,
      });

      if (isDefaultExternalRunCommandTemplate(commandTemplate)) {
        void runInWarpWithLaunchConfig(workspacePath, scriptName, runCommand, command);
        return;
      }

      executeExternalCommand(command, workspacePath, envName, true);
    },

    openExternalTabCopyCommand(
      workspacePath: string,
      scriptName: string,
      scriptCommand: string,
      isRawCommand: boolean,
      packageManager: string,
      envName: string,
      injectEnvName: boolean
    ): void {
      const runCommand = buildRunCommand(
        workspacePath,
        scriptName,
        scriptCommand,
        isRawCommand,
        packageManager,
        envName,
        injectEnvName
      );
      void openExternalTabAndCopyCommand(workspacePath, runCommand);
    },

    disposeScriptTerminals(workspacePath: string, scriptName: string): void {
      const terminalsToDispose: vscode.Terminal[] = [];
      for (const terminal of terminals.values()) {
        const activeContext = activeRunContextByTerminal.get(terminal);
        if (!activeContext) {
          continue;
        }
        if (activeContext.workspacePath !== workspacePath || activeContext.scriptName !== scriptName) {
          continue;
        }
        terminalsToDispose.push(terminal);
      }

      for (const terminal of terminalsToDispose) {
        removeTerminalFromMaps(terminal);
        try {
          terminal.dispose();
        } catch {
          // Ignore terminal disposal errors.
        }
      }
    },

    disposeManagedEditorTerminals(): void {
      for (const terminal of managedEditorTerminals) {
        removeTerminalFromMaps(terminal);
        try {
          terminal.dispose();
        } catch {
          // Ignore terminal disposal errors.
        }
      }
      managedEditorTerminals.clear();
    },

    dispose(): void {
      this.disposeManagedEditorTerminals();
      closeListener.dispose();
      startDisposable?.dispose();
      endDisposable?.dispose();
    },
  };

  function createManagedTerminal(
    options: vscode.TerminalOptions
  ): vscode.Terminal {
    const terminal = vscode.window.createTerminal(options);
    if (options.location === vscode.TerminalLocation.Editor) {
      managedEditorTerminals.add(terminal);
    }
    return terminal;
  }

  function removeTerminalFromMaps(terminal: vscode.Terminal): void {
    busyTerminals.delete(terminal);
    activeRunContextByTerminal.delete(terminal);
    managedEditorTerminals.delete(terminal);
    for (const [key, candidate] of terminals) {
      if (candidate === terminal) {
        terminals.delete(key);
      }
    }
  }

  async function promptForBusyScriptAction(params: {
    key: string;
    workspacePath: string;
    scriptName: string;
    runCommand: string;
    terminalName: string;
    terminalColor: vscode.ThemeColor | undefined;
    options: InternalRunOptions;
    terminal: vscode.Terminal;
  }): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      `"${params.scriptName}" is already running. Restart or close it?`,
      { modal: false },
      'Restart',
      'Close Running'
    );
    if (!choice) {
      return;
    }

    removeTerminalFromMaps(params.terminal);
    try {
      params.terminal.dispose();
    } catch {
      // Ignore disposal errors, then continue with requested action.
    }

    if (choice !== 'Restart') {
      return;
    }

    const restartedTerminal = createManagedTerminal({
      name: params.terminalName,
      cwd: params.workspacePath,
      location: toTerminalLocation(params.options.location),
      color: params.terminalColor,
    });
    terminals.set(params.key, restartedTerminal);
    restartedTerminal.show(params.options.preserveFocus);
    restartedTerminal.sendText(params.runCommand);
    activeRunContextByTerminal.set(restartedTerminal, {
      key: params.key,
      workspacePath: params.workspacePath,
      scriptName: params.scriptName,
    });
  }
}

function getTerminalKey(
  workspacePath: string,
  scriptName: string,
  options: InternalRunOptions
): string {
  if (options.terminalStyle) {
    return options.terminalStyle.key;
  }
  if (options.mode === 'dedicated') {
    return `${DEDICATED_RUNNER_TERMINAL_NAME}::${options.location}`;
  }
  const folder = path.basename(workspacePath);
  return `${folder} ~ ${scriptName}::${options.location}`;
}

function getTerminalDisplayName(
  workspacePath: string,
  scriptName: string,
  options: InternalRunOptions
): string {
  if (options.terminalStyle) {
    return options.terminalStyle.name;
  }
  if (options.mode === 'dedicated') {
    return DEDICATED_RUNNER_TERMINAL_NAME;
  }
  const folder = path.basename(workspacePath);
  return `${folder} ~ ${scriptName}`;
}

function toTerminalLocation(location: InternalRunOptions['location']): vscode.TerminalLocation {
  return location === 'editor' ? vscode.TerminalLocation.Editor : vscode.TerminalLocation.Panel;
}

function toTerminalThemeColor(colorId?: string): vscode.ThemeColor | undefined {
  const normalizedColor = colorId?.trim();
  if (!normalizedColor) {
    return undefined;
  }
  return new vscode.ThemeColor(normalizedColor);
}

function isDefaultExternalRunCommandTemplate(commandTemplate: string): boolean {
  return commandTemplate.trim() === defaultExternalRunCommandTemplate;
}

async function openExternalTabAndCopyCommand(workspacePath: string, runCommand: string): Promise<void> {
  try {
    await vscode.env.clipboard.writeText(runCommand);
  } catch {
    // Ignore clipboard errors and still open tab in the requested directory.
  }
  executeExternalCommand(buildWarpNewTabCommand(workspacePath), workspacePath, '', false);
}

async function runInWarpWithLaunchConfig(
  workspacePath: string,
  scriptName: string,
  runCommand: string,
  fallbackCommand: string
): Promise<void> {
  let launchUri: string | undefined;

  try {
    const launchConfigName = buildStableWarpLaunchConfigName(workspacePath, scriptName);
    const launchConfigPath = path.join(warpLaunchConfigurationsDir, `${launchConfigName}.yaml`);

    scheduleWarpLaunchConfigCleanup(launchConfigName);

    await fs.mkdir(warpLaunchConfigurationsDir, { recursive: true });
    await fs.writeFile(
      launchConfigPath,
      buildWarpLaunchConfigurationYaml(launchConfigName, workspacePath, runCommand)
    );

    launchUri = `warp://launch/${encodeURIComponent(launchConfigName)}`;
    const launched = await executeExternalCommandAsync(
      `warp-terminal ${shellEscape(launchUri)}`,
      workspacePath,
      '',
      false
    );
    if (launched) { return; }

    const opened = await executeExternalCommandAsync(
      `open ${shellEscape(launchUri)}`,
      workspacePath,
      '',
      false
    );
    if (opened) { return; }
  } catch {
    // Fall back silently to opening Warp in the workspace path.
  }

  if (launchUri) {
    void executeExternalCommandAsync(`open ${shellEscape(launchUri)}`, workspacePath, '', false);
  }
  executeExternalCommand(fallbackCommand, workspacePath, '', false);
}

function executeExternalCommand(
  command: string,
  workspacePath: string,
  envName: string,
  showError: boolean
): void {
  exec(command, { cwd: workspacePath, env: { ...process.env, envName } }, (error) => {
    if (!error || !showError) { return; }
    vscode.window.showErrorMessage(
      `Failed to run external terminal command: ${error.message}`
    );
  });
}

function executeExternalCommandAsync(
  command: string,
  workspacePath: string,
  envName: string,
  showError: boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    exec(command, { cwd: workspacePath, env: { ...process.env, envName } }, (error) => {
      if (!error) {
        resolve(true);
        return;
      }
      if (showError) {
        vscode.window.showErrorMessage(
          `Failed to run external terminal command: ${error.message}`
        );
      }
      resolve(false);
    });
  });
}

function buildStableWarpLaunchConfigName(workspacePath: string, scriptName: string): string {
  const input = workspacePath + '::' + scriptName;
  const hash = createHash('sha1').update(input).digest('hex').slice(0, 8);
  const scriptSlug = scriptName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'script';
  return `${WARP_LAUNCH_CONFIG_PREFIX}${hash}-${scriptSlug}`;
}

let warpCleanupInFlight: Promise<void> | undefined;

function scheduleWarpLaunchConfigCleanup(excludeName: string): void {
  if (warpCleanupInFlight !== undefined) {
    return;
  }
  warpCleanupInFlight = runWarpLaunchConfigCleanup(excludeName).finally(() => {
    warpCleanupInFlight = undefined;
  });
}

async function runWarpLaunchConfigCleanup(excludeName: string): Promise<void> {
  try {
    const entries = await fs.readdir(warpLaunchConfigurationsDir, { withFileTypes: true });
    const now = Date.now();
    const excludeFile = `${excludeName}.yaml`;

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(WARP_LAUNCH_CONFIG_PREFIX) || !entry.name.endsWith('.yaml')) {
        continue;
      }
      if (entry.name === excludeFile) {
        continue;
      }
      try {
        const filePath = path.join(warpLaunchConfigurationsDir, entry.name);
        const stat = await fs.stat(filePath);
        const mtimeMs = stat.mtimeMs;
        if (now - mtimeMs <= WARP_CONFIG_TTL_MS) {
          continue;
        }
        await fs.unlink(filePath);
      } catch (err) {
        if (!isIgnorableUnlinkError(err)) {
          // Ignore stat/read race errors so launch path is never blocked
        }
        continue;
      }
    }
  } catch {
    // Never throw from cleanup path
  }
}

function isIgnorableUnlinkError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as NodeJS.ErrnoException).code === 'string') {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'EBUSY' || code === 'EPERM';
  }
  return false;
}

function buildWarpLaunchConfigurationYaml(
  launchConfigName: string,
  workspacePath: string,
  runCommand: string
): string {
  return `---
name: ${yamlSingleQuote(launchConfigName)}
windows:
  - tabs:
      - title: ${yamlSingleQuote('Latoo Scripts')}
        layout:
          cwd: ${yamlSingleQuote(workspacePath)}
          commands:
            - exec: ${yamlSingleQuote(runCommand)}
`;
}

function buildWarpNewTabCommand(workspacePath: string): string {
  return `open "warp://action/new_tab?path=${encodeURIComponent(workspacePath)}"`;
}

type CommandTemplateParams = {
  workspacePath: string;
  scriptName: string;
  packageManager: string;
  runCommand: string;
  envName: string;
};

function interpolateCommandTemplate(template: string, params: CommandTemplateParams): string {
  const values: Record<string, string> = {
    workspacePath: params.workspacePath,
    scriptName: params.scriptName,
    packageManager: params.packageManager,
    runCommand: params.runCommand,
    envName: params.envName,
    workspacePathEscaped: shellEscape(params.workspacePath),
    scriptNameEscaped: shellEscape(params.scriptName),
    packageManagerEscaped: shellEscape(params.packageManager),
    runCommandEscaped: shellEscape(params.runCommand),
    envNameEscaped: shellEscape(params.envName),
    workspacePathUri: encodeURIComponent(params.workspacePath),
    scriptNameUri: encodeURIComponent(params.scriptName),
    packageManagerUri: encodeURIComponent(params.packageManager),
    runCommandUri: encodeURIComponent(params.runCommand),
    envNameUri: encodeURIComponent(params.envName),
  };

  return template.replace(/\{([a-zA-Z]+)\}/g, (match, key) => values[key] ?? match);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function yamlSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`;
}

function buildRunCommand(
  workspacePath: string,
  scriptName: string,
  scriptCommand: string,
  isRawCommand: boolean,
  packageManager: string,
  envName: string,
  injectEnvName: boolean
): string {
  if (isRawCommand) {
    const rawCommand = scriptCommand.trim();
    if (rawCommand.length === 0) {
      return '';
    }
    if (rawCommand.includes('{envName}')) {
      const interpolated = interpolateCommandTemplate(rawCommand, {
        workspacePath,
        scriptName,
        packageManager,
        runCommand: rawCommand,
        envName,
      });
      if (!injectEnvName) {
        return interpolated;
      }
      return `envName=${shellEscape(envName)} ${interpolated}`;
    }
    if (!injectEnvName) {
      return rawCommand;
    }
    return `envName=${shellEscape(envName)} ${rawCommand}`;
  }

  if (scriptCommand.includes('{envName}')) {
    const interpolated = interpolateCommandTemplate(scriptCommand, {
      workspacePath,
      scriptName,
      packageManager,
      runCommand: `${packageManager} run ${scriptName}`,
      envName,
    });
    if (!injectEnvName) {
      return interpolated;
    }
    return `envName=${shellEscape(envName)} ${interpolated}`;
  }

  if (!injectEnvName) {
    return `${packageManager} run ${scriptName}`;
  }

  return `envName=${shellEscape(envName)} ${packageManager} run ${scriptName}`;
}
