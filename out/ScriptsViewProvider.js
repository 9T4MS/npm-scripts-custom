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
exports.ScriptsViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const crypto_1 = require("crypto");
const workspaceScanner_1 = require("./workspaceScanner");
const gitUtils_1 = require("./gitUtils");
const config_1 = require("./config");
const quickSettings_1 = require("./quickSettings");
class ScriptsViewProvider {
    extensionUri;
    stateManager;
    terminalManager;
    static viewType = 'latooScripts.scriptsView';
    view;
    workspaces = [];
    packageManager;
    rootPaths;
    worktreeByRootPath = new Map();
    favoritesScopeId = 'default';
    configChangeDisposable;
    constructor(extensionUri, rootPaths, stateManager, terminalManager) {
        this.extensionUri = extensionUri;
        this.stateManager = stateManager;
        this.terminalManager = terminalManager;
        this.rootPaths = rootPaths;
        const primaryRootPath = this.rootPaths[0] ?? '';
        this.packageManager = primaryRootPath ? (0, workspaceScanner_1.detectPackageManager)(primaryRootPath) : 'npm';
        this.workspaces = (0, workspaceScanner_1.scanWorkspaceFolders)(this.rootPaths);
        this.favoritesScopeId = this.createFavoritesScopeId();
        this.stateManager.setFavoritesScope(this.favoritesScopeId);
        this.configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
            if ((0, config_1.didConfigChange)(event)) {
                this.sendUpdate();
            }
        });
    }
    dispose() {
        this.configChangeDisposable.dispose();
    }
    resolveWebviewView(webviewView, _context, _token) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);
        webviewView.onDidDispose(() => {
            this.terminalManager.disposeManagedEditorTerminals();
            this.view = undefined;
        });
        webviewView.webview.onDidReceiveMessage((msg) => {
            switch (msg.type) {
                case 'ready':
                    this.sendUpdate();
                    break;
                case 'runScript':
                    {
                        const config = (0, config_1.readConfig)();
                        const params = this.buildRunParams(config, msg.workspacePath, msg.scriptName, msg.scriptCommand, Boolean(msg.isRawCommand));
                        this.terminalManager.run(params, this.getInternalRunOptions(config, msg.workspacePath, msg.scriptName, msg.locationOverride));
                    }
                    break;
                case 'runExternal':
                    {
                        const config = (0, config_1.readConfig)();
                        const params = this.buildRunParams(config, msg.workspacePath, msg.scriptName, msg.scriptCommand, Boolean(msg.isRawCommand));
                        this.terminalManager.runExternal(params, config.externalRunCommandTemplate);
                    }
                    break;
                case 'openExternalTabCopyCommand':
                    {
                        const config = (0, config_1.readConfig)();
                        const params = this.buildRunParams(config, msg.workspacePath, msg.scriptName, msg.scriptCommand, Boolean(msg.isRawCommand));
                        this.terminalManager.openExternalTabCopyCommand(params);
                    }
                    break;
                case 'openScriptInPackageJson':
                    void this.openScriptInPackageJson(msg.workspacePath, msg.scriptName, msg.scriptLine, msg.scriptColumn);
                    break;
                case 'openWorkspaceScriptsInPackageJson':
                    void this.openWorkspaceScriptsInPackageJson(msg.workspacePath, msg.workspaceName);
                    break;
                case 'openUserSettingsJson':
                    void this.openUserSettingsJson();
                    break;
                case 'toggleFavorite':
                    this.stateManager.toggleFavorite(msg.workspacePath, msg.scriptName, msg.workspaceName);
                    this.sendUpdate();
                    break;
                case 'reorderTabs':
                    this.stateManager.setTabOrder(msg.tabOrder);
                    break;
                case 'reorderFavoritesSections':
                    this.stateManager.setFavoritesSectionOrder(msg.favoritesSectionOrder);
                    break;
                case 'togglePersistentTerminalScript':
                    void this.setScriptFeatureEnabled('persistentTerminal', msg.workspacePath, msg.scriptName, msg.enabled);
                    break;
                case 'toggleEnvNameScriptDisabled':
                    void this.setScriptFeatureEnabled('envName', msg.workspacePath, msg.scriptName, !msg.disabled);
                    break;
                case 'setScriptLocationOverride':
                    void this.setScriptLocationOverride(msg.workspacePath, msg.scriptName, msg.location);
                    break;
                case 'setScriptAlwaysNewTerminal':
                    void this.setScriptAlwaysNewOverride(msg.workspacePath, msg.scriptName, msg.enabled);
                    break;
            }
        });
    }
    async showQuickSettings() {
        await (0, quickSettings_1.showQuickSettings)((0, config_1.readConfig)(), this.extensionUri, this.stateManager, this.rootPaths);
    }
    refresh() {
        const primaryRootPath = this.rootPaths[0] ?? '';
        this.packageManager = primaryRootPath ? (0, workspaceScanner_1.detectPackageManager)(primaryRootPath) : 'npm';
        this.workspaces = (0, workspaceScanner_1.scanWorkspaceFolders)(this.rootPaths);
        this.worktreeByRootPath.clear();
        this.favoritesScopeId = this.createFavoritesScopeId();
        this.stateManager.setFavoritesScope(this.favoritesScopeId);
        this.sendUpdate();
    }
    updateRootPaths(rootPaths) {
        this.rootPaths = rootPaths;
        this.worktreeByRootPath.clear();
        this.refresh();
    }
    sendUpdate() {
        if (!this.view) {
            return;
        }
        this.stateManager.setFavoritesScope(this.favoritesScopeId);
        const config = (0, config_1.readConfig)();
        const envName = this.getEnvName(config);
        this.view.description = config.envNameEnabled ? `envName: ${envName}` : undefined;
        const message = {
            type: 'updateData',
            workspaces: this.workspaces,
            favorites: this.migrateFavorites(this.stateManager.getFavorites()),
            tabOrder: this.stateManager.getTabOrder(),
            favoritesSectionOrder: this.stateManager.getFavoritesSectionOrder(),
            packageManager: this.packageManager,
            envName,
            isEnvNameAuto: config.envNameUseWorkspaceFolderName,
            isEnvNameEnabled: config.envNameEnabled,
            primaryRunLocation: config.internalRunLocation,
            primaryClickTarget: config.primaryClickTarget,
            actionVisibility: (0, config_1.getActionVisibility)(config),
            scriptFeatureFilters: (0, config_1.getScriptFeatureFilters)(config),
            internalRunLocationOverrides: (0, config_1.normalizeLocationOverrides)(config),
            internalRunAlwaysNewOverrides: (0, config_1.normalizeAlwaysNewOverrides)(config),
            customFavoriteEntries: this.getCustomFavoriteEntries(config),
        };
        this.view.webview.postMessage(message);
    }
    getHtml(webview) {
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));
        const nonce = getNonce();
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
  <title>Latoo Scripts</title>
</head>
<body>
  <div id="toolbar"></div>
  <div id="tab-bar"></div>
  <div id="content"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
    }
    buildRunParams(config, workspacePath, scriptName, scriptCommand, isRawCommand) {
        return {
            workspacePath,
            scriptName,
            scriptCommand,
            isRawCommand,
            packageManager: this.packageManager,
            envName: this.getEnvName(config),
            injectEnvName: this.shouldInjectEnvName(config, workspacePath, scriptName),
        };
    }
    getInternalRunOptions(config, workspacePath, scriptName, locationOverride) {
        const useInternalRunBehavior = this.shouldApplyInternalRunBehavior(config, workspacePath, scriptName);
        const location = locationOverride
            ?? this.getScriptLocationOverrideValue(config, workspacePath, scriptName)
            ?? (useInternalRunBehavior ? config.internalRunLocation : 'panel');
        const terminalStyle = this.getInternalRunTerminalStyle(config, workspacePath, scriptName);
        return {
            mode: useInternalRunBehavior ? config.internalRunMode : 'dedicated',
            location,
            preserveFocus: useInternalRunBehavior ? config.internalRunPreserveFocus : true,
            openNewWhenBusy: useInternalRunBehavior ? config.internalRunOpenNewWhenBusy : true,
            alwaysNewTerminal: this.getScriptAlwaysNewOverrideValue(config, workspacePath, scriptName),
            terminalStyle,
        };
    }
    getScriptLocationOverrideValue(config, workspacePath, scriptName) {
        return (0, config_1.normalizeLocationOverrides)(config)[getPersistentTerminalKey(workspacePath, scriptName)];
    }
    getScriptAlwaysNewOverrideValue(config, workspacePath, scriptName) {
        return (0, config_1.normalizeAlwaysNewOverrides)(config)[getPersistentTerminalKey(workspacePath, scriptName)] === true;
    }
    getInternalRunTerminalStyle(config, workspacePath, scriptName) {
        if (!this.shouldApplyPersistentTerminalBehavior(config, workspacePath, scriptName)) {
            return undefined;
        }
        const key = getPersistentTerminalKey(workspacePath, scriptName);
        const override = config.persistentTerminalOverrides[key];
        const overrideName = override?.name?.trim();
        const overrideColor = override?.color?.trim();
        const keyHash = (0, crypto_1.createHash)('sha1').update(key).digest('hex').slice(0, 10);
        return {
            key: `persistent:${keyHash}`,
            name: overrideName && overrideName.length > 0
                ? overrideName
                : `Latoo • ${scriptName}`,
            color: overrideColor && overrideColor.length > 0
                ? overrideColor
                : this.pickDefaultPersistentTerminalColor(config, workspacePath, scriptName),
        };
    }
    pickDefaultPersistentTerminalColor(config, workspacePath, scriptName) {
        const palette = (0, config_1.getValidatedDefaultColors)(config);
        const hashHex = (0, crypto_1.createHash)('sha1')
            .update(getPersistentTerminalKey(workspacePath, scriptName))
            .digest('hex')
            .slice(0, 8);
        const hashValue = Number.parseInt(hashHex, 16);
        const index = Number.isFinite(hashValue) ? hashValue % palette.length : 0;
        return palette[index] ?? 'terminal.ansiBlue';
    }
    migrateFavorites(favorites) {
        const workspacePathByName = new Map();
        for (const workspace of this.workspaces) {
            workspacePathByName.set(workspace.name, workspace.path);
        }
        const migrated = favorites.map((favorite) => {
            if (favorite.workspacePath.trim().length > 0) {
                return favorite;
            }
            if (!favorite.workspaceName) {
                return favorite;
            }
            const workspacePath = workspacePathByName.get(favorite.workspaceName);
            if (!workspacePath) {
                return favorite;
            }
            return {
                ...favorite,
                workspacePath,
            };
        });
        const changed = migrated.some((favorite, idx) => favorite.workspacePath !== favorites[idx]?.workspacePath);
        if (changed) {
            this.stateManager.setFavorites(migrated);
        }
        return migrated;
    }
    createFavoritesScopeId() {
        const primaryRootPath = this.rootPaths[0];
        if (!primaryRootPath) {
            return 'default';
        }
        const repoIdentity = (0, gitUtils_1.getRepositoryIdentity)(primaryRootPath);
        const hash = (0, crypto_1.createHash)('sha1').update(repoIdentity).digest('hex').slice(0, 12);
        return hash;
    }
    async openScriptInPackageJson(workspacePath, scriptName, scriptLine, scriptColumn) {
        const pkgUri = vscode.Uri.file(path.join(workspacePath, 'package.json'));
        try {
            const document = await vscode.workspace.openTextDocument(pkgUri);
            const position = this.resolveScriptPosition(document, scriptName, scriptLine, scriptColumn);
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: false,
            });
            if (!position) {
                return;
            }
            const range = new vscode.Range(position, position);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        }
        catch {
            vscode.window.showErrorMessage(`Could not open package.json for script "${scriptName}".`);
        }
    }
    async openWorkspaceScriptsInPackageJson(workspacePath, workspaceName) {
        const pkgUri = this.resolveWorkspacePackageJsonUri(workspacePath, workspaceName);
        if (!pkgUri) {
            vscode.window.showErrorMessage('Could not find package.json for this workspace.');
            return;
        }
        try {
            const document = await vscode.workspace.openTextDocument(pkgUri);
            const position = this.resolveScriptsBlockPosition(document);
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: false,
            });
            if (!position) {
                return;
            }
            const range = new vscode.Range(position, position);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        }
        catch {
            vscode.window.showErrorMessage('Could not open package.json scripts section.');
        }
    }
    resolveWorkspacePackageJsonUri(workspacePath, workspaceName) {
        const candidateDirs = [];
        const normalizedWorkspacePath = workspacePath.trim();
        if (normalizedWorkspacePath.length > 0) {
            candidateDirs.push(normalizedWorkspacePath);
        }
        if (workspaceName && workspaceName.trim().length > 0) {
            const byName = this.workspaces.find((workspace) => workspace.name === workspaceName.trim());
            if (byName) {
                candidateDirs.push(byName.path);
            }
        }
        if (normalizedWorkspacePath.length > 0) {
            const byPath = this.workspaces.find((workspace) => workspace.path === normalizedWorkspacePath);
            if (byPath) {
                candidateDirs.push(byPath.path);
            }
        }
        const seen = new Set();
        for (const candidateDir of candidateDirs) {
            const normalizedDir = candidateDir.trim();
            if (normalizedDir.length === 0 || seen.has(normalizedDir)) {
                continue;
            }
            seen.add(normalizedDir);
            const packageJsonPath = path.join(normalizedDir, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
                return vscode.Uri.file(packageJsonPath);
            }
        }
        return undefined;
    }
    resolveScriptPosition(document, scriptName, scriptLine, scriptColumn) {
        if (scriptLine !== undefined && scriptLine >= 0 && scriptLine < document.lineCount) {
            const line = document.lineAt(scriptLine).text;
            const safeColumn = Math.max(0, Math.min(scriptColumn ?? 0, line.length));
            if (line.includes(`"${scriptName}"`)) {
                return new vscode.Position(scriptLine, safeColumn);
            }
        }
        const escapedScriptName = escapeRegExp(scriptName);
        const scriptPattern = new RegExp(`^\\s*"${escapedScriptName}"\\s*:`);
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            if (!scriptPattern.test(line)) {
                continue;
            }
            return new vscode.Position(i, line.search(/\S|$/));
        }
        return undefined;
    }
    resolveScriptsBlockPosition(document) {
        const scriptsPattern = /^\s*"scripts"\s*:/;
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            if (!scriptsPattern.test(line)) {
                continue;
            }
            return new vscode.Position(i, line.search(/\S|$/));
        }
        return undefined;
    }
    async openUserSettingsJson() {
        try {
            await vscode.commands.executeCommand('workbench.action.openApplicationSettingsJson');
        }
        catch {
            await vscode.commands.executeCommand('workbench.action.openSettingsJson');
        }
    }
    getCustomFavoriteEntries(config) {
        const workspacePath = this.rootPaths[0]?.trim();
        if (!workspacePath || !config.customFavoriteCommandsEnabled) {
            return [];
        }
        const workspaceName = path.basename(workspacePath);
        const sharedEntries = this.stateManager.getCustomFavoriteCommands();
        const settingsEntries = config.customFavoriteCommands;
        const byName = new Map();
        for (const entry of sharedEntries) {
            byName.set(entry.name, entry);
        }
        for (const entry of settingsEntries) {
            byName.set(entry.name, entry);
        }
        return Array.from(byName.values())
            .filter(e => e.name.length > 0 && e.command.length > 0)
            .map(e => ({ ...e, workspacePath, workspaceName, scriptCommand: e.command }));
    }
    getWorkspaceFolderName() {
        const primaryRootPath = this.rootPaths[0];
        if (!primaryRootPath) {
            return '';
        }
        return path.basename(primaryRootPath);
    }
    isPrimaryRootGitWorktree() {
        const primaryRootPath = this.rootPaths[0];
        if (!primaryRootPath) {
            return false;
        }
        const cachedValue = this.worktreeByRootPath.get(primaryRootPath);
        if (cachedValue !== undefined) {
            return cachedValue;
        }
        const isWorktree = (0, gitUtils_1.detectGitWorktree)(primaryRootPath);
        this.worktreeByRootPath.set(primaryRootPath, isWorktree);
        return isWorktree;
    }
    getEnvName(config) {
        const c = config ?? (0, config_1.readConfig)();
        if (c.envNameUseWorkspaceFolderName && this.isPrimaryRootGitWorktree()) {
            const folderName = this.getWorkspaceFolderName().trim();
            if (folderName.length > 0) {
                return folderName;
            }
        }
        const trimmed = c.envNameDefault.trim();
        return trimmed.length > 0 ? trimmed : 'local-0';
    }
    shouldInjectEnvName(config, workspacePath, scriptName) {
        const filters = (0, config_1.getScriptFeatureFilters)(config);
        return (0, config_1.isScriptTargetEnabled)(filters.envName.includeScripts, filters.envName.excludeScripts, workspacePath, scriptName);
    }
    shouldApplyInternalRunBehavior(config, workspacePath, scriptName) {
        const filters = (0, config_1.getScriptFeatureFilters)(config);
        return (0, config_1.isScriptTargetEnabled)(filters.internalRun.includeScripts, filters.internalRun.excludeScripts, workspacePath, scriptName);
    }
    shouldApplyPersistentTerminalBehavior(config, workspacePath, scriptName) {
        const filters = (0, config_1.getScriptFeatureFilters)(config);
        return (0, config_1.isScriptTargetEnabled)(filters.persistentTerminal.includeScripts, filters.persistentTerminal.excludeScripts, workspacePath, scriptName);
    }
    async setScriptFeatureEnabled(feature, workspacePath, scriptName, enabled) {
        const config = (0, config_1.readConfig)();
        const filters = (0, config_1.getScriptFeatureFilters)(config);
        const target = getPersistentTerminalKey(workspacePath, scriptName);
        const includeKey = feature === 'persistentTerminal' ? 'persistentTerminalIncludeScripts' : 'envNameIncludeScripts';
        const excludeKey = feature === 'persistentTerminal' ? 'persistentTerminalExcludeScripts' : 'envNameExcludeScripts';
        const featureFilters = filters[feature];
        const includeList = featureFilters.includeScripts;
        const includeSet = new Set(includeList);
        const patch = {};
        if (enabled && !includeList.some((pattern) => (0, config_1.isScriptTargetEnabled)([pattern], [], workspacePath, scriptName))) {
            includeSet.add(target);
            patch[includeKey] = Array.from(includeSet);
        }
        const excludeList = featureFilters.excludeScripts;
        const excludeSet = new Set(excludeList);
        if (enabled) {
            excludeSet.delete(target);
        }
        else {
            excludeSet.add(target);
        }
        patch[excludeKey] = Array.from(excludeSet);
        await (0, config_1.updateConfig)(patch);
    }
    async setScriptLocationOverride(workspacePath, scriptName, location) {
        this.terminalManager.disposeScriptTerminals(workspacePath, scriptName);
        const config = (0, config_1.readConfig)();
        const overrides = { ...(0, config_1.normalizeLocationOverrides)(config) };
        const key = getPersistentTerminalKey(workspacePath, scriptName);
        if (!location) {
            delete overrides[key];
        }
        else {
            overrides[key] = location;
        }
        await (0, config_1.updateConfig)({ internalRunLocationOverrides: overrides });
    }
    async setScriptAlwaysNewOverride(workspacePath, scriptName, enabled) {
        const config = (0, config_1.readConfig)();
        const overrides = { ...(0, config_1.normalizeAlwaysNewOverrides)(config) };
        const key = getPersistentTerminalKey(workspacePath, scriptName);
        overrides[key] = enabled;
        await (0, config_1.updateConfig)({ internalRunAlwaysNewOverrides: overrides });
    }
}
exports.ScriptsViewProvider = ScriptsViewProvider;
function getPersistentTerminalKey(workspacePath, scriptName) {
    return `${workspacePath}::${scriptName}`;
}
function getNonce() {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=ScriptsViewProvider.js.map