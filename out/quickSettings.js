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
exports.showQuickSettings = showQuickSettings;
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
async function showQuickSettings(config, extensionUri, stateManager, _rootPaths) {
    const autoStyleEnabled = isAutoTerminalStyleEnabledGlobally(config);
    const selected = await vscode.window.showQuickPick([
        {
            label: `Toggle primary click target (current: ${config.primaryClickTarget === 'internal' ? 'Run internally' : 'Run externally'})`,
            detail: getConfigurationDescription(extensionUri, 'latooScripts.primaryClick.target', 'Controls whether clicking a script row runs internally or externally by default.'),
            value: 'primary-click',
        },
        {
            label: 'Choose visible row action buttons',
            detail: 'Controls which quick action buttons are visible on each script row.',
            value: 'quick-actions',
        },
        {
            label: `Toggle internal run mode (current: ${config.internalRunMode})`,
            detail: getConfigurationDescription(extensionUri, 'latooScripts.internalRun.mode', 'Switches between one shared runner terminal and per-script terminals.'),
            value: 'internal-run-mode',
        },
        {
            label: `Toggle internal run location (current: ${config.internalRunLocation})`,
            detail: getConfigurationDescription(extensionUri, 'latooScripts.internalRun.location', 'Sets whether internal runs open in terminal panel or editor area.'),
            value: 'internal-run-location',
        },
        {
            label: `Toggle preserve focus on run (current: ${config.internalRunPreserveFocus ? 'on' : 'off'})`,
            detail: getConfigurationDescription(extensionUri, 'latooScripts.internalRun.preserveFocus', 'When enabled, running scripts keeps editor focus.'),
            value: 'internal-run-preserve-focus',
        },
        {
            label: `Toggle open new terminal when busy (current: ${config.internalRunOpenNewWhenBusy ? 'on' : 'off'})`,
            detail: getConfigurationDescription(extensionUri, 'latooScripts.internalRun.openNewWhenBusy', 'When enabled, busy terminals get a new overflow terminal instead of interruption.'),
            value: 'internal-run-open-new-when-busy',
        },
        {
            label: `Toggle envName hint visibility (current: ${config.envNameEnabled ? 'on' : 'off'})`,
            detail: getConfigurationDescription(extensionUri, 'latooScripts.envName.enabled', 'Shows or hides envName in the Latoo Scripts view header.'),
            value: 'env-name-enabled',
        },
        {
            label: `Toggle envName source (current: ${config.envNameUseWorkspaceFolderName ? 'workspace folder/worktree aware' : 'envName.default'})`,
            detail: getConfigurationDescription(extensionUri, 'latooScripts.envName.useWorkspaceFolderName', 'Chooses envName source between workspace folder name and envName.default.'),
            value: 'env-name-source',
        },
        {
            label: `Toggle auto terminal style for all scripts (current: ${autoStyleEnabled ? 'on' : 'off'})`,
            detail: getConfigurationDescription(extensionUri, 'latooScripts.persistentTerminal.includeScripts', 'Controls which scripts receive auto terminal style (name/color).'),
            value: 'auto-terminal-style-enabled',
        },
        {
            label: `Toggle custom favorite commands (current: ${config.customFavoriteCommandsEnabled ? 'on' : 'off'})`,
            detail: getConfigurationDescription(extensionUri, 'latooScripts.customFavoriteCommands.enabled', 'Shows configurable always-on-top favorite command entries.'),
            value: 'custom-favorite-commands-enabled',
        },
        {
            label: 'Manage custom favorite commands',
            detail: 'Add, edit, or remove custom favorite command entries stored per repository.',
            value: 'manage-custom-favorites',
        },
    ], {
        placeHolder: 'Quick settings: choose what to configure',
        ignoreFocusOut: false,
    });
    if (!selected) {
        return;
    }
    switch (selected.value) {
        case 'primary-click':
            await (0, config_1.updateConfig)({ primaryClickTarget: config.primaryClickTarget === 'internal' ? 'external' : 'internal' });
            return;
        case 'quick-actions':
            await toggleQuickActionVisibility(config);
            return;
        case 'internal-run-mode':
            await (0, config_1.updateConfig)({ internalRunMode: config.internalRunMode === 'dedicated' ? 'perScript' : 'dedicated' });
            return;
        case 'internal-run-location':
            await (0, config_1.updateConfig)({ internalRunLocation: config.internalRunLocation === 'panel' ? 'editor' : 'panel' });
            return;
        case 'internal-run-preserve-focus':
            await (0, config_1.updateConfig)({ internalRunPreserveFocus: !config.internalRunPreserveFocus });
            return;
        case 'internal-run-open-new-when-busy':
            await (0, config_1.updateConfig)({ internalRunOpenNewWhenBusy: !config.internalRunOpenNewWhenBusy });
            return;
        case 'env-name-enabled':
            await (0, config_1.updateConfig)({ envNameEnabled: !config.envNameEnabled });
            return;
        case 'env-name-source':
            await (0, config_1.updateConfig)({ envNameUseWorkspaceFolderName: !config.envNameUseWorkspaceFolderName });
            return;
        case 'auto-terminal-style-enabled':
            if (autoStyleEnabled) {
                await (0, config_1.updateConfig)({ persistentTerminalIncludeScripts: [], persistentTerminalExcludeScripts: [] });
            }
            else {
                await (0, config_1.updateConfig)({ persistentTerminalIncludeScripts: ['*'], persistentTerminalExcludeScripts: [] });
            }
            return;
        case 'custom-favorite-commands-enabled':
            await (0, config_1.updateConfig)({ customFavoriteCommandsEnabled: !config.customFavoriteCommandsEnabled });
            return;
        case 'manage-custom-favorites':
            await manageCustomFavoriteCommands(stateManager);
            return;
    }
}
function isAutoTerminalStyleEnabledGlobally(config) {
    return config.persistentTerminalIncludeScripts.length === 1
        && config.persistentTerminalIncludeScripts[0] === '*'
        && config.persistentTerminalExcludeScripts.length === 0;
}
async function toggleQuickActionVisibility(config) {
    const items = [
        { label: 'Open script in package.json', picked: config.showOpenScript, key: 'showOpenScript' },
        { label: 'Run in secondary location', picked: config.showRunSecondary, key: 'showRunSecondary' },
        { label: 'Run in external window', picked: config.showRunExternal, key: 'showRunExternal' },
        { label: 'Open external tab and copy command', picked: config.showOpenExternalTabCopyCommand, key: 'showOpenExternalTabCopyCommand' },
        { label: 'Favorite', picked: config.showFavorite, key: 'showFavorite' },
    ];
    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Select row action buttons to show (selected = visible)',
        ignoreFocusOut: false,
    });
    if (!selected) {
        return;
    }
    const selectedKeys = new Set(selected.map((item) => item.key));
    await (0, config_1.updateConfig)({
        showOpenScript: selectedKeys.has('showOpenScript'),
        showRunSecondary: selectedKeys.has('showRunSecondary'),
        showRunExternal: selectedKeys.has('showRunExternal'),
        showOpenExternalTabCopyCommand: selectedKeys.has('showOpenExternalTabCopyCommand'),
        showFavorite: selectedKeys.has('showFavorite'),
    });
}
function getConfigurationDescription(extensionUri, configKey, fallback) {
    const extension = vscode.extensions.all.find((candidate) => candidate.extensionUri.fsPath === extensionUri.fsPath);
    const properties = extension?.packageJSON?.contributes?.configuration?.properties;
    const description = properties?.[configKey]?.description;
    if (typeof description === 'string' && description.trim().length > 0) {
        return description;
    }
    return fallback;
}
async function manageCustomFavoriteCommands(stateManager) {
    const entries = stateManager.getCustomFavoriteCommands();
    const items = [
        { label: '$(add) Add new command...', value: 'add' },
    ];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        items.push({
            label: entry.name,
            description: entry.command + (entry.iconId ? ` (icon: ${entry.iconId})` : ''),
            value: i,
        });
    }
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Manage custom favorite commands',
        ignoreFocusOut: false,
    });
    if (!selected) {
        return;
    }
    if (selected.value === 'add') {
        await addCustomFavoriteCommand(stateManager, entries);
        return;
    }
    const index = selected.value;
    const entry = entries[index];
    await editOrRemoveCustomFavoriteCommand(stateManager, entries, entry, index);
}
async function addCustomFavoriteCommand(stateManager, entries) {
    const name = await vscode.window.showInputBox({
        prompt: 'Command name (displayed in favorites)',
        placeHolder: 'e.g. claude',
        ignoreFocusOut: true,
    });
    if (!name || name.trim().length === 0) {
        return;
    }
    const command = await vscode.window.showInputBox({
        prompt: 'Shell command to run',
        placeHolder: 'e.g. claude',
        ignoreFocusOut: true,
    });
    if (!command || command.trim().length === 0) {
        return;
    }
    const iconId = await vscode.window.showInputBox({
        prompt: 'Icon ID (optional, leave blank for default)',
        placeHolder: 'e.g. claude-code',
        ignoreFocusOut: true,
    });
    const newEntry = {
        name: name.trim(),
        command: command.trim(),
        iconId: iconId && iconId.trim().length > 0 ? iconId.trim() : undefined,
    };
    stateManager.setCustomFavoriteCommands([...entries, newEntry]);
}
async function editOrRemoveCustomFavoriteCommand(stateManager, entries, entry, index) {
    const action = await vscode.window.showQuickPick([
        { label: '$(edit) Edit', value: 'edit' },
        { label: '$(trash) Remove', value: 'remove' },
    ], {
        placeHolder: `"${entry.name}" — choose action`,
        ignoreFocusOut: false,
    });
    if (!action) {
        return;
    }
    if (action.value === 'remove') {
        const updated = entries.filter((_, i) => i !== index);
        stateManager.setCustomFavoriteCommands(updated);
        return;
    }
    const name = await vscode.window.showInputBox({
        prompt: 'Command name',
        value: entry.name,
        ignoreFocusOut: true,
    });
    if (!name || name.trim().length === 0) {
        return;
    }
    const command = await vscode.window.showInputBox({
        prompt: 'Shell command to run',
        value: entry.command,
        ignoreFocusOut: true,
    });
    if (!command || command.trim().length === 0) {
        return;
    }
    const iconId = await vscode.window.showInputBox({
        prompt: 'Icon ID (optional, leave blank for default)',
        value: entry.iconId ?? '',
        ignoreFocusOut: true,
    });
    const updated = [...entries];
    updated[index] = {
        name: name.trim(),
        command: command.trim(),
        iconId: iconId && iconId.trim().length > 0 ? iconId.trim() : undefined,
    };
    stateManager.setCustomFavoriteCommands(updated);
}
//# sourceMappingURL=quickSettings.js.map