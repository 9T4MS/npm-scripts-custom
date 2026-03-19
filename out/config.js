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
exports.DEFAULTS = void 0;
exports.readConfig = readConfig;
exports.updateConfig = updateConfig;
exports.didConfigChange = didConfigChange;
exports.getActionVisibility = getActionVisibility;
exports.getScriptFeatureFilters = getScriptFeatureFilters;
exports.getValidatedDefaultColors = getValidatedDefaultColors;
exports.normalizeInternalRunMode = normalizeInternalRunMode;
exports.normalizeInternalRunLocation = normalizeInternalRunLocation;
exports.normalizePrimaryClickTarget = normalizePrimaryClickTarget;
exports.normalizeLocationOverrides = normalizeLocationOverrides;
exports.normalizeAlwaysNewOverrides = normalizeAlwaysNewOverrides;
exports.isScriptTargetEnabled = isScriptTargetEnabled;
exports.matchesScriptTargetPattern = matchesScriptTargetPattern;
exports.matchesScriptPattern = matchesScriptPattern;
const vscode = __importStar(require("vscode"));
exports.DEFAULTS = {
    primaryClickTarget: 'internal',
    externalRunCommandTemplate: 'open "warp://action/new_tab?path={workspacePathUri}&command={runCommandUri}"',
    internalRunMode: 'perScript',
    internalRunLocation: 'panel',
    internalRunPreserveFocus: true,
    internalRunOpenNewWhenBusy: true,
    internalRunLocationOverrides: {},
    internalRunAlwaysNewOverrides: {},
    internalRunIncludeScripts: ['*'],
    internalRunExcludeScripts: [],
    envNameDefault: 'local-0',
    envNameUseWorkspaceFolderName: true,
    envNameEnabled: true,
    envNameIncludeScripts: ['*'],
    envNameExcludeScripts: [],
    persistentTerminalOverrides: {},
    persistentTerminalDefaultColors: [
        'terminal.ansiBlue',
        'terminal.ansiCyan',
        'terminal.ansiGreen',
        'terminal.ansiMagenta',
        'terminal.ansiYellow',
        'terminal.ansiRed',
    ],
    persistentTerminalIncludeScripts: ['*'],
    persistentTerminalExcludeScripts: [],
    showOpenScript: false,
    showRunSecondary: true,
    showRunExternal: true,
    showOpenExternalTabCopyCommand: false,
    showFavorite: true,
    customFavoriteCommandsEnabled: true,
    customFavoriteCommands: [{ name: 'claude', command: 'claude', iconId: 'claude-code' }],
};
function readConfig() {
    const raw = vscode.workspace.getConfiguration().get('latooScripts', {});
    return { ...exports.DEFAULTS, ...raw };
}
async function updateConfig(patch, target = vscode.ConfigurationTarget.Workspace) {
    const inspection = vscode.workspace.getConfiguration().inspect('latooScripts');
    let scopeValue;
    switch (target) {
        case vscode.ConfigurationTarget.Global:
            scopeValue = inspection?.globalValue ?? {};
            break;
        case vscode.ConfigurationTarget.WorkspaceFolder:
            scopeValue = inspection?.workspaceFolderValue ?? {};
            break;
        default:
            scopeValue = inspection?.workspaceValue ?? {};
    }
    const updated = { ...scopeValue, ...patch };
    await vscode.workspace.getConfiguration().update('latooScripts', updated, target);
}
function didConfigChange(event) {
    return event.affectsConfiguration('latooScripts');
}
function getActionVisibility(config) {
    return {
        openScript: config.showOpenScript,
        runSecondary: config.showRunSecondary,
        runExternal: config.showRunExternal,
        openExternalTabCopyCommand: config.showOpenExternalTabCopyCommand,
        favorite: config.showFavorite,
    };
}
function normalizePatternList(patterns, defaultValue) {
    const source = patterns ?? defaultValue;
    const normalized = source.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0);
    return normalized.length > 0 ? normalized : defaultValue;
}
function getScriptFeatureFilters(config) {
    return {
        envName: {
            includeScripts: normalizePatternList(config.envNameIncludeScripts, ['*']),
            excludeScripts: normalizePatternList(config.envNameExcludeScripts, []),
        },
        internalRun: {
            includeScripts: normalizePatternList(config.internalRunIncludeScripts, ['*']),
            excludeScripts: normalizePatternList(config.internalRunExcludeScripts, []),
        },
        persistentTerminal: {
            includeScripts: normalizePatternList(config.persistentTerminalIncludeScripts, ['*']),
            excludeScripts: normalizePatternList(config.persistentTerminalExcludeScripts, []),
        },
    };
}
function getValidatedDefaultColors(config) {
    const filtered = config.persistentTerminalDefaultColors.filter((colorId) => colorId.trim().length > 0);
    if (filtered.length > 0) {
        return filtered;
    }
    return ['terminal.ansiBlue'];
}
function normalizeInternalRunMode(config) {
    return config.internalRunMode === 'perScript' ? 'perScript' : 'dedicated';
}
function normalizeInternalRunLocation(config) {
    return config.internalRunLocation === 'editor' ? 'editor' : 'panel';
}
function normalizePrimaryClickTarget(config) {
    return config.primaryClickTarget === 'external' ? 'external' : 'internal';
}
function normalizeLocationOverrides(config) {
    const configured = config.internalRunLocationOverrides;
    const normalized = {};
    for (const [key, value] of Object.entries(configured)) {
        if (value === 'panel' || value === 'editor') {
            normalized[key] = value;
        }
    }
    return normalized;
}
function normalizeAlwaysNewOverrides(config) {
    const configured = config.internalRunAlwaysNewOverrides;
    const normalized = {};
    for (const [key, value] of Object.entries(configured)) {
        if (typeof value === 'boolean') {
            normalized[key] = value;
        }
    }
    return normalized;
}
function isScriptTargetEnabled(includePatterns, excludePatterns, workspacePath, scriptName) {
    const isIncluded = includePatterns.some((pattern) => matchesScriptTargetPattern(workspacePath, scriptName, pattern));
    if (!isIncluded) {
        return false;
    }
    const isExcluded = excludePatterns.some((pattern) => matchesScriptTargetPattern(workspacePath, scriptName, pattern));
    return !isExcluded;
}
function matchesScriptTargetPattern(workspacePath, scriptName, pattern) {
    const separatorIndex = pattern.indexOf('::');
    if (separatorIndex < 0) {
        return matchesScriptPattern(scriptName, pattern);
    }
    const workspacePattern = pattern.slice(0, separatorIndex) || '*';
    const scriptPattern = pattern.slice(separatorIndex + 2) || '*';
    return (matchesScriptPattern(workspacePath, workspacePattern) &&
        matchesScriptPattern(scriptName, scriptPattern));
}
function matchesScriptPattern(value, pattern) {
    if (pattern === '*') {
        return true;
    }
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(value);
}
//# sourceMappingURL=config.js.map