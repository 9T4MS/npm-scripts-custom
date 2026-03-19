import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import {
  WorkspaceInfo,
  StateManager,
  TerminalManager as ITerminalManager,
  WebviewToExtMessage,
  ExtToWebviewMessage,
  FavoriteEntry,
  InternalRunOptions,
  InternalRunLocation,
  CustomFavoriteEntry,
  LatooScriptsConfig,
  RunParams,
} from './types';
import { scanWorkspaceFolders, detectPackageManager } from './workspaceScanner';
import { detectGitWorktree, getRepositoryIdentity } from './gitUtils';
import {
  readConfig,
  updateConfig,
  didConfigChange,
  isScriptTargetEnabled,
  getActionVisibility,
  getScriptFeatureFilters,
  getValidatedDefaultColors,
  normalizeLocationOverrides,
  normalizeAlwaysNewOverrides,
} from './config';
import { showQuickSettings } from './quickSettings';

export class ScriptsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'latooScripts.scriptsView';

  private view?: vscode.WebviewView;
  private workspaces: WorkspaceInfo[] = [];
  private packageManager: string;
  private rootPaths: string[];
  private worktreeByRootPath = new Map<string, boolean>();
  private favoritesScopeId = 'default';
  private readonly configChangeDisposable: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    rootPaths: string[],
    private readonly stateManager: StateManager,
    private readonly terminalManager: ITerminalManager
  ) {
    this.rootPaths = rootPaths;
    const primaryRootPath = this.rootPaths[0] ?? '';
    this.packageManager = primaryRootPath ? detectPackageManager(primaryRootPath) : 'npm';
    this.workspaces = scanWorkspaceFolders(this.rootPaths);
    this.favoritesScopeId = this.createFavoritesScopeId();
    this.stateManager.setFavoritesScope(this.favoritesScopeId);
    this.configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (didConfigChange(event)) {
        this.sendUpdate();
      }
    });
  }

  public dispose(): void {
    this.configChangeDisposable.dispose();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
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

    webviewView.webview.onDidReceiveMessage((msg: WebviewToExtMessage) => {
      switch (msg.type) {
        case 'ready':
          this.sendUpdate();
          break;
        case 'runScript':
          {
            const config = readConfig();
            const params = this.buildRunParams(config, msg.workspacePath, msg.scriptName, msg.scriptCommand, Boolean(msg.isRawCommand));
            this.terminalManager.run(params, this.getInternalRunOptions(config, msg.workspacePath, msg.scriptName, msg.locationOverride));
          }
          break;
        case 'runExternal':
          {
            const config = readConfig();
            const params = this.buildRunParams(config, msg.workspacePath, msg.scriptName, msg.scriptCommand, Boolean(msg.isRawCommand));
            this.terminalManager.runExternal(params, config.externalRunCommandTemplate);
          }
          break;
        case 'openExternalTabCopyCommand':
          {
            const config = readConfig();
            const params = this.buildRunParams(config, msg.workspacePath, msg.scriptName, msg.scriptCommand, Boolean(msg.isRawCommand));
            this.terminalManager.openExternalTabCopyCommand(params);
          }
          break;
        case 'openScriptInPackageJson':
          void this.openScriptInPackageJson(
            msg.workspacePath,
            msg.scriptName,
            msg.scriptLine,
            msg.scriptColumn
          );
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
          void this.setScriptFeatureEnabled(
            'persistentTerminal',
            msg.workspacePath,
            msg.scriptName,
            msg.enabled
          );
          break;
        case 'toggleEnvNameScriptDisabled':
          void this.setScriptFeatureEnabled(
            'envName',
            msg.workspacePath,
            msg.scriptName,
            !msg.disabled
          );
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

  public async showQuickSettings(): Promise<void> {
    await showQuickSettings(
      readConfig(),
      this.extensionUri,
      this.stateManager,
      this.rootPaths
    );
  }

  public refresh(): void {
    const primaryRootPath = this.rootPaths[0] ?? '';
    this.packageManager = primaryRootPath ? detectPackageManager(primaryRootPath) : 'npm';
    this.workspaces = scanWorkspaceFolders(this.rootPaths);
    this.worktreeByRootPath.clear();
    this.favoritesScopeId = this.createFavoritesScopeId();
    this.stateManager.setFavoritesScope(this.favoritesScopeId);
    this.sendUpdate();
  }

  public updateRootPaths(rootPaths: string[]): void {
    this.rootPaths = rootPaths;
    this.worktreeByRootPath.clear();
    this.refresh();
  }

  private sendUpdate(): void {
    if (!this.view) { return; }
    this.stateManager.setFavoritesScope(this.favoritesScopeId);
    const config = readConfig();
    const envName = this.getEnvName(config);
    this.view.description = config.envNameEnabled ? `envName: ${envName}` : undefined;
    const message: ExtToWebviewMessage = {
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
      actionVisibility: getActionVisibility(config),
      scriptFeatureFilters: getScriptFeatureFilters(config),
      internalRunLocationOverrides: normalizeLocationOverrides(config),
      internalRunAlwaysNewOverrides: normalizeAlwaysNewOverrides(config),
      customFavoriteEntries: this.getCustomFavoriteEntries(config),
    };
    this.view.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js')
    );
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

  private buildRunParams(
    config: LatooScriptsConfig,
    workspacePath: string,
    scriptName: string,
    scriptCommand: string,
    isRawCommand: boolean
  ): RunParams {
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

  private getInternalRunOptions(
    config: LatooScriptsConfig,
    workspacePath: string,
    scriptName: string,
    locationOverride?: InternalRunLocation
  ): InternalRunOptions {
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

  private getScriptLocationOverrideValue(
    config: LatooScriptsConfig,
    workspacePath: string,
    scriptName: string
  ): InternalRunLocation | undefined {
    return normalizeLocationOverrides(config)[getPersistentTerminalKey(workspacePath, scriptName)];
  }

  private getScriptAlwaysNewOverrideValue(
    config: LatooScriptsConfig,
    workspacePath: string,
    scriptName: string
  ): boolean {
    return normalizeAlwaysNewOverrides(config)[getPersistentTerminalKey(workspacePath, scriptName)] === true;
  }

  private getInternalRunTerminalStyle(
    config: LatooScriptsConfig,
    workspacePath: string,
    scriptName: string
  ): InternalRunOptions['terminalStyle'] | undefined {
    if (!this.shouldApplyPersistentTerminalBehavior(config, workspacePath, scriptName)) {
      return undefined;
    }
    const key = getPersistentTerminalKey(workspacePath, scriptName);
    const override = config.persistentTerminalOverrides[key];
    const overrideName = override?.name?.trim();
    const overrideColor = override?.color?.trim();
    const keyHash = createHash('sha1').update(key).digest('hex').slice(0, 10);
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

  private pickDefaultPersistentTerminalColor(config: LatooScriptsConfig, workspacePath: string, scriptName: string): string {
    const palette = getValidatedDefaultColors(config);
    const hashHex = createHash('sha1')
      .update(getPersistentTerminalKey(workspacePath, scriptName))
      .digest('hex')
      .slice(0, 8);
    const hashValue = Number.parseInt(hashHex, 16);
    const index = Number.isFinite(hashValue) ? hashValue % palette.length : 0;
    return palette[index] ?? 'terminal.ansiBlue';
  }

  private migrateFavorites(favorites: FavoriteEntry[]): FavoriteEntry[] {
    const workspacePathByName = new Map<string, string>();
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

  private createFavoritesScopeId(): string {
    const primaryRootPath = this.rootPaths[0];
    if (!primaryRootPath) {
      return 'default';
    }

    const repoIdentity = getRepositoryIdentity(primaryRootPath);
    const hash = createHash('sha1').update(repoIdentity).digest('hex').slice(0, 12);
    return hash;
  }

  private async openScriptInPackageJson(
    workspacePath: string,
    scriptName: string,
    scriptLine?: number,
    scriptColumn?: number
  ): Promise<void> {
    const pkgUri = vscode.Uri.file(path.join(workspacePath, 'package.json'));

    try {
      const document = await vscode.workspace.openTextDocument(pkgUri);
      const position = this.resolveScriptPosition(document, scriptName, scriptLine, scriptColumn);
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
      });

      if (!position) { return; }
      const range = new vscode.Range(position, position);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch {
      vscode.window.showErrorMessage(`Could not open package.json for script "${scriptName}".`);
    }
  }

  private async openWorkspaceScriptsInPackageJson(
    workspacePath: string,
    workspaceName?: string
  ): Promise<void> {
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
      if (!position) { return; }
      const range = new vscode.Range(position, position);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch {
      vscode.window.showErrorMessage('Could not open package.json scripts section.');
    }
  }

  private resolveWorkspacePackageJsonUri(
    workspacePath: string,
    workspaceName?: string
  ): vscode.Uri | undefined {
    const candidateDirs: string[] = [];
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

    const seen = new Set<string>();
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

  private resolveScriptPosition(
    document: vscode.TextDocument,
    scriptName: string,
    scriptLine?: number,
    scriptColumn?: number
  ): vscode.Position | undefined {
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
      if (!scriptPattern.test(line)) { continue; }
      return new vscode.Position(i, line.search(/\S|$/));
    }

    return undefined;
  }

  private resolveScriptsBlockPosition(document: vscode.TextDocument): vscode.Position | undefined {
    const scriptsPattern = /^\s*"scripts"\s*:/;
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i).text;
      if (!scriptsPattern.test(line)) { continue; }
      return new vscode.Position(i, line.search(/\S|$/));
    }
    return undefined;
  }

  private async openUserSettingsJson(): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.openApplicationSettingsJson');
    } catch {
      await vscode.commands.executeCommand('workbench.action.openSettingsJson');
    }
  }

  private getCustomFavoriteEntries(config: LatooScriptsConfig): (CustomFavoriteEntry & {
    workspacePath: string;
    workspaceName: string;
    scriptCommand: string;
  })[] {
    const workspacePath = this.rootPaths[0]?.trim();
    if (!workspacePath || !config.customFavoriteCommandsEnabled) { return []; }
    const workspaceName = path.basename(workspacePath);

    const sharedEntries = this.stateManager.getCustomFavoriteCommands();
    const settingsEntries = config.customFavoriteCommands;

    const byName = new Map<string, CustomFavoriteEntry>();
    for (const entry of sharedEntries) { byName.set(entry.name, entry); }
    for (const entry of settingsEntries) { byName.set(entry.name, entry); }

    return Array.from(byName.values())
      .filter(e => e.name.length > 0 && e.command.length > 0)
      .map(e => ({ ...e, workspacePath, workspaceName, scriptCommand: e.command }));
  }

  private getWorkspaceFolderName(): string {
    const primaryRootPath = this.rootPaths[0];
    if (!primaryRootPath) { return ''; }
    return path.basename(primaryRootPath);
  }

  private isPrimaryRootGitWorktree(): boolean {
    const primaryRootPath = this.rootPaths[0];
    if (!primaryRootPath) { return false; }
    const cachedValue = this.worktreeByRootPath.get(primaryRootPath);
    if (cachedValue !== undefined) {
      return cachedValue;
    }
    const isWorktree = detectGitWorktree(primaryRootPath);
    this.worktreeByRootPath.set(primaryRootPath, isWorktree);
    return isWorktree;
  }

  private getEnvName(config?: LatooScriptsConfig): string {
    const c = config ?? readConfig();
    if (c.envNameUseWorkspaceFolderName && this.isPrimaryRootGitWorktree()) {
      const folderName = this.getWorkspaceFolderName().trim();
      if (folderName.length > 0) { return folderName; }
    }
    const trimmed = c.envNameDefault.trim();
    return trimmed.length > 0 ? trimmed : 'local-0';
  }

  private shouldInjectEnvName(config: LatooScriptsConfig, workspacePath: string, scriptName: string): boolean {
    const filters = getScriptFeatureFilters(config);
    return isScriptTargetEnabled(
      filters.envName.includeScripts,
      filters.envName.excludeScripts,
      workspacePath,
      scriptName
    );
  }

  private shouldApplyInternalRunBehavior(config: LatooScriptsConfig, workspacePath: string, scriptName: string): boolean {
    const filters = getScriptFeatureFilters(config);
    return isScriptTargetEnabled(
      filters.internalRun.includeScripts,
      filters.internalRun.excludeScripts,
      workspacePath,
      scriptName
    );
  }

  private shouldApplyPersistentTerminalBehavior(config: LatooScriptsConfig, workspacePath: string, scriptName: string): boolean {
    const filters = getScriptFeatureFilters(config);
    return isScriptTargetEnabled(
      filters.persistentTerminal.includeScripts,
      filters.persistentTerminal.excludeScripts,
      workspacePath,
      scriptName
    );
  }

  private async setScriptFeatureEnabled(
    feature: 'persistentTerminal' | 'envName',
    workspacePath: string,
    scriptName: string,
    enabled: boolean
  ): Promise<void> {
    const config = readConfig();
    const filters = getScriptFeatureFilters(config);
    const target = getPersistentTerminalKey(workspacePath, scriptName);

    const includeKey = feature === 'persistentTerminal' ? 'persistentTerminalIncludeScripts' : 'envNameIncludeScripts' as const;
    const excludeKey = feature === 'persistentTerminal' ? 'persistentTerminalExcludeScripts' : 'envNameExcludeScripts' as const;

    const featureFilters = filters[feature];
    const includeList = featureFilters.includeScripts;
    const includeSet = new Set(includeList);

    const patch: Partial<LatooScriptsConfig> = {};

    if (enabled && !includeList.some((pattern) => isScriptTargetEnabled([pattern], [], workspacePath, scriptName))) {
      includeSet.add(target);
      patch[includeKey] = Array.from(includeSet);
    }

    const excludeList = featureFilters.excludeScripts;
    const excludeSet = new Set(excludeList);
    if (enabled) {
      excludeSet.delete(target);
    } else {
      excludeSet.add(target);
    }
    patch[excludeKey] = Array.from(excludeSet);

    await updateConfig(patch);
  }

  private async setScriptLocationOverride(
    workspacePath: string,
    scriptName: string,
    location?: InternalRunLocation
  ): Promise<void> {
    this.terminalManager.disposeScriptTerminals(workspacePath, scriptName);
    const config = readConfig();
    const overrides = { ...normalizeLocationOverrides(config) };
    const key = getPersistentTerminalKey(workspacePath, scriptName);
    if (!location) { delete overrides[key]; } else { overrides[key] = location; }
    await updateConfig({ internalRunLocationOverrides: overrides });
  }

  private async setScriptAlwaysNewOverride(
    workspacePath: string,
    scriptName: string,
    enabled: boolean
  ): Promise<void> {
    const config = readConfig();
    const overrides = { ...normalizeAlwaysNewOverrides(config) };
    const key = getPersistentTerminalKey(workspacePath, scriptName);
    overrides[key] = enabled;
    await updateConfig({ internalRunAlwaysNewOverrides: overrides });
  }
}

function getPersistentTerminalKey(workspacePath: string, scriptName: string): string {
  return `${workspacePath}::${scriptName}`;
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
