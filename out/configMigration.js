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
exports.migrateLegacyConfig = migrateLegacyConfig;
const vscode = __importStar(require("vscode"));
/**
 * Maps old dotted configuration keys (v0.1.x) to new flat property names (v0.2.0+).
 * Old: "latooScripts.internalRun.mode" → New: latooScripts.internalRunMode
 */
const LEGACY_KEY_MAP = [
    ['latooScripts.primaryClick.target', 'primaryClickTarget'],
    ['latooScripts.externalRun.commandTemplate', 'externalRunCommandTemplate'],
    ['latooScripts.internalRun.mode', 'internalRunMode'],
    ['latooScripts.internalRun.location', 'internalRunLocation'],
    ['latooScripts.internalRun.preserveFocus', 'internalRunPreserveFocus'],
    ['latooScripts.internalRun.openNewWhenBusy', 'internalRunOpenNewWhenBusy'],
    ['latooScripts.internalRun.locationOverrides', 'internalRunLocationOverrides'],
    ['latooScripts.internalRun.alwaysNewOverrides', 'internalRunAlwaysNewOverrides'],
    ['latooScripts.internalRun.includeScripts', 'internalRunIncludeScripts'],
    ['latooScripts.internalRun.excludeScripts', 'internalRunExcludeScripts'],
    ['latooScripts.envName.default', 'envNameDefault'],
    ['latooScripts.envName.useWorkspaceFolderName', 'envNameUseWorkspaceFolderName'],
    ['latooScripts.envName.enabled', 'envNameEnabled'],
    ['latooScripts.envName.includeScripts', 'envNameIncludeScripts'],
    ['latooScripts.envName.excludeScripts', 'envNameExcludeScripts'],
    ['latooScripts.persistentTerminal.overrides', 'persistentTerminalOverrides'],
    ['latooScripts.persistentTerminal.defaultColors', 'persistentTerminalDefaultColors'],
    ['latooScripts.persistentTerminal.includeScripts', 'persistentTerminalIncludeScripts'],
    ['latooScripts.persistentTerminal.excludeScripts', 'persistentTerminalExcludeScripts'],
    ['latooScripts.actions.showOpenScript', 'showOpenScript'],
    ['latooScripts.actions.showRunSecondary', 'showRunSecondary'],
    ['latooScripts.actions.showRunExternal', 'showRunExternal'],
    ['latooScripts.actions.showOpenExternalTabCopyCommand', 'showOpenExternalTabCopyCommand'],
    ['latooScripts.actions.showFavorite', 'showFavorite'],
    ['latooScripts.customFavoriteCommands.enabled', 'customFavoriteCommandsEnabled'],
    ['latooScripts.customFavoriteCommands.entries', 'customFavoriteCommands'],
];
const SCOPES = [
    {
        target: vscode.ConfigurationTarget.Global,
        getValue: (i) => i.globalValue,
        getExisting: (i) => i.globalValue,
    },
    {
        target: vscode.ConfigurationTarget.Workspace,
        getValue: (i) => i.workspaceValue,
        getExisting: (i) => i.workspaceValue,
    },
    {
        target: vscode.ConfigurationTarget.WorkspaceFolder,
        getValue: (i) => i.workspaceFolderValue,
        getExisting: (i) => i.workspaceFolderValue,
    },
];
async function migrateLegacyConfig() {
    const config = vscode.workspace.getConfiguration();
    for (const scope of SCOPES) {
        const patch = {};
        const keysToRemove = [];
        for (const [oldKey, newProp] of LEGACY_KEY_MAP) {
            const inspection = config.inspect(oldKey);
            if (!inspection) {
                continue;
            }
            const value = scope.getValue(inspection);
            if (value === undefined) {
                continue;
            }
            patch[newProp] = value;
            keysToRemove.push(oldKey);
        }
        if (keysToRemove.length === 0) {
            continue;
        }
        // Merge with any existing new-format values in this scope
        const newInspection = config.inspect('latooScripts');
        const existing = newInspection ? scope.getExisting(newInspection) ?? {} : {};
        const merged = { ...existing, ...patch };
        try {
            await config.update('latooScripts', merged, scope.target);
            for (const oldKey of keysToRemove) {
                await config.update(oldKey, undefined, scope.target);
            }
        }
        catch {
            // Migration is best-effort — don't block activation
        }
    }
}
//# sourceMappingURL=configMigration.js.map