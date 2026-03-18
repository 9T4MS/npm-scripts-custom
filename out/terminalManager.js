"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTerminalManager = createTerminalManager;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs/promises"));
const crypto_1 = require("crypto");
const child_process_1 = require("child_process");
const defaultExternalRunCommandTemplate = 'open "warp://action/new_tab?path={workspacePathUri}&command={runCommandUri}"';
const warpLaunchConfigurationsDir = path.join(os.homedir(), '.warp', 'launch_configurations');
const DEDICATED_RUNNER_TERMINAL_NAME = 'Latoo Scripts • Runner';
const WARP_LAUNCH_CONFIG_PREFIX = 'latoo-scripts-';
const WARP_CONFIG_TTL_MS = 2 * 24 * 60 * 60 * 1000;
function createTerminalManager() {
    const terminals = new Map();
    const busyTerminals = new WeakSet();
    const activeRunContextByTerminal = new WeakMap();
    const managedEditorTerminals = new Set();
    let overflowCounter = 0;
    // Clean up map entries when terminals are closed
    const closeListener = vscode.window.onDidCloseTerminal((terminal) => {
        removeTerminalFromMaps(terminal);
    });
    // Track busy state via shell integration events (VS Code 1.93+).
    // On older VS Code the events don't exist — busyTerminals stays empty → always reuse.
    const startDisposable = vscode.window.onDidStartTerminalShellExecution
        ? vscode.window.onDidStartTerminalShellExecution((event) => {
            busyTerminals.add(event.terminal);
        })
        : undefined;
    const endDisposable = vscode.window.onDidEndTerminalShellExecution
        ? vscode.window.onDidEndTerminalShellExecution((event) => {
            busyTerminals.delete(event.terminal);
            activeRunContextByTerminal.delete(event.terminal);
        })
        : undefined;
    return {
        run(workspacePath, scriptName, scriptCommand, isRawCommand, packageManager, envName, injectEnvName, options) {
            const key = getTerminalKey(workspacePath, scriptName, options);
            const terminalName = getTerminalDisplayName(workspacePath, scriptName, options);
            const terminalColor = toTerminalThemeColor(options.terminalStyle?.color);
            const runCommand = buildRunCommand(workspacePath, scriptName, scriptCommand, isRawCommand, packageManager, envName, injectEnvName);
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
        runExternal(workspacePath, scriptName, scriptCommand, isRawCommand, packageManager, envName, injectEnvName, commandTemplate) {
            const runCommand = buildRunCommand(workspacePath, scriptName, scriptCommand, isRawCommand, packageManager, envName, injectEnvName);
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
        openExternalTabCopyCommand(workspacePath, scriptName, scriptCommand, isRawCommand, packageManager, envName, injectEnvName) {
            const runCommand = buildRunCommand(workspacePath, scriptName, scriptCommand, isRawCommand, packageManager, envName, injectEnvName);
            void openExternalTabAndCopyCommand(workspacePath, runCommand);
        },
        disposeScriptTerminals(workspacePath, scriptName) {
            const terminalsToDispose = [];
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
                }
                catch {
                    // Ignore terminal disposal errors.
                }
            }
        },
        disposeManagedEditorTerminals() {
            for (const terminal of managedEditorTerminals) {
                removeTerminalFromMaps(terminal);
                try {
                    terminal.dispose();
                }
                catch {
                    // Ignore terminal disposal errors.
                }
            }
            managedEditorTerminals.clear();
        },
        dispose() {
            this.disposeManagedEditorTerminals();
            closeListener.dispose();
            startDisposable?.dispose();
            endDisposable?.dispose();
        },
    };
    function createManagedTerminal(options) {
        const terminal = vscode.window.createTerminal(options);
        if (options.location === vscode.TerminalLocation.Editor) {
            managedEditorTerminals.add(terminal);
        }
        return terminal;
    }
    function removeTerminalFromMaps(terminal) {
        busyTerminals.delete(terminal);
        activeRunContextByTerminal.delete(terminal);
        managedEditorTerminals.delete(terminal);
        for (const [key, candidate] of terminals) {
            if (candidate === terminal) {
                terminals.delete(key);
            }
        }
    }
    async function promptForBusyScriptAction(params) {
        const choice = await vscode.window.showWarningMessage(`"${params.scriptName}" is already running. Restart or close it?`, { modal: false }, 'Restart', 'Close Running');
        if (!choice) {
            return;
        }
        removeTerminalFromMaps(params.terminal);
        try {
            params.terminal.dispose();
        }
        catch {
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
function getTerminalKey(workspacePath, scriptName, options) {
    if (options.terminalStyle) {
        return options.terminalStyle.key;
    }
    if (options.mode === 'dedicated') {
        return `${DEDICATED_RUNNER_TERMINAL_NAME}::${options.location}`;
    }
    const folder = path.basename(workspacePath);
    return `${folder} ~ ${scriptName}::${options.location}`;
}
function getTerminalDisplayName(workspacePath, scriptName, options) {
    if (options.terminalStyle) {
        return options.terminalStyle.name;
    }
    if (options.mode === 'dedicated') {
        return DEDICATED_RUNNER_TERMINAL_NAME;
    }
    const folder = path.basename(workspacePath);
    return `${folder} ~ ${scriptName}`;
}
function toTerminalLocation(location) {
    return location === 'editor' ? vscode.TerminalLocation.Editor : vscode.TerminalLocation.Panel;
}
function toTerminalThemeColor(colorId) {
    const normalizedColor = colorId?.trim();
    if (!normalizedColor) {
        return undefined;
    }
    return new vscode.ThemeColor(normalizedColor);
}
function isDefaultExternalRunCommandTemplate(commandTemplate) {
    return commandTemplate.trim() === defaultExternalRunCommandTemplate;
}
async function openExternalTabAndCopyCommand(workspacePath, runCommand) {
    try {
        await vscode.env.clipboard.writeText(runCommand);
    }
    catch {
        // Ignore clipboard errors and still open tab in the requested directory.
    }
    executeExternalCommand(buildWarpNewTabCommand(workspacePath), workspacePath, '', false);
}
async function runInWarpWithLaunchConfig(workspacePath, scriptName, runCommand, fallbackCommand) {
    let launchUri;
    try {
        const launchConfigName = buildStableWarpLaunchConfigName(workspacePath, scriptName);
        const launchConfigPath = path.join(warpLaunchConfigurationsDir, `${launchConfigName}.yaml`);
        scheduleWarpLaunchConfigCleanup(launchConfigName);
        await fs.mkdir(warpLaunchConfigurationsDir, { recursive: true });
        await fs.writeFile(launchConfigPath, buildWarpLaunchConfigurationYaml(launchConfigName, workspacePath, runCommand));
        launchUri = `warp://launch/${encodeURIComponent(launchConfigName)}`;
        const launched = await executeExternalCommandAsync(`warp-terminal ${shellEscape(launchUri)}`, workspacePath, '', false);
        if (launched) {
            return;
        }
        const opened = await executeExternalCommandAsync(`open ${shellEscape(launchUri)}`, workspacePath, '', false);
        if (opened) {
            return;
        }
    }
    catch {
        // Fall back silently to opening Warp in the workspace path.
    }
    if (launchUri) {
        void executeExternalCommandAsync(`open ${shellEscape(launchUri)}`, workspacePath, '', false);
    }
    executeExternalCommand(fallbackCommand, workspacePath, '', false);
}
function executeExternalCommand(command, workspacePath, envName, showError) {
    (0, child_process_1.exec)(command, { cwd: workspacePath, env: { ...process.env, envName } }, (error) => {
        if (!error || !showError) {
            return;
        }
        vscode.window.showErrorMessage(`Failed to run external terminal command: ${error.message}`);
    });
}
function executeExternalCommandAsync(command, workspacePath, envName, showError) {
    return new Promise((resolve) => {
        (0, child_process_1.exec)(command, { cwd: workspacePath, env: { ...process.env, envName } }, (error) => {
            if (!error) {
                resolve(true);
                return;
            }
            if (showError) {
                vscode.window.showErrorMessage(`Failed to run external terminal command: ${error.message}`);
            }
            resolve(false);
        });
    });
}
function buildStableWarpLaunchConfigName(workspacePath, scriptName) {
    const input = workspacePath + '::' + scriptName;
    const hash = (0, crypto_1.createHash)('sha1').update(input).digest('hex').slice(0, 8);
    const scriptSlug = scriptName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'script';
    return `${WARP_LAUNCH_CONFIG_PREFIX}${hash}-${scriptSlug}`;
}
let warpCleanupInFlight;
function scheduleWarpLaunchConfigCleanup(excludeName) {
    if (warpCleanupInFlight !== undefined) {
        return;
    }
    warpCleanupInFlight = runWarpLaunchConfigCleanup(excludeName).finally(() => {
        warpCleanupInFlight = undefined;
    });
}
async function runWarpLaunchConfigCleanup(excludeName) {
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
            }
            catch (err) {
                if (!isIgnorableUnlinkError(err)) {
                    // Ignore stat/read race errors so launch path is never blocked
                }
                continue;
            }
        }
    }
    catch {
        // Never throw from cleanup path
    }
}
function isIgnorableUnlinkError(err) {
    if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
        const code = err.code;
        return code === 'ENOENT' || code === 'EBUSY' || code === 'EPERM';
    }
    return false;
}
function buildWarpLaunchConfigurationYaml(launchConfigName, workspacePath, runCommand) {
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
function buildWarpNewTabCommand(workspacePath) {
    return `open "warp://action/new_tab?path=${encodeURIComponent(workspacePath)}"`;
}
function interpolateCommandTemplate(template, params) {
    const values = {
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
function shellEscape(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
function yamlSingleQuote(value) {
    return `'${value.replace(/'/g, `''`)}'`;
}
function buildRunCommand(workspacePath, scriptName, scriptCommand, isRawCommand, packageManager, envName, injectEnvName) {
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
//# sourceMappingURL=terminalManager.js.map