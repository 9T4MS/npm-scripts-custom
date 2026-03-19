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
  PersistentTerminalOverride,
  ActionVisibility,
  PrimaryClickTarget,
} from './types';
import { scanWorkspaceFolders, detectPackageManager } from './workspaceScanner';

export class ScriptsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'latooScripts.scriptsView';
  private static readonly externalRunCommandConfigKey = 'latooScripts.externalRun.commandTemplate';
  private static readonly envNameDefaultConfigKey = 'latooScripts.envName.default';
  private static readonly envNameUseWorkspaceFolderNameConfigKey = 'latooScripts.envName.useWorkspaceFolderName';
  private static readonly envNameEnabledConfigKey = 'latooScripts.envName.enabled';
  private static readonly customFavoriteCommandsEnabledConfigKey = 'latooScripts.customFavoriteCommands.enabled';
  private static readonly customFavoriteCommandsEntriesConfigKey = 'latooScripts.customFavoriteCommands.entries';
  private static readonly envNameIncludeScriptsConfigKey = 'latooScripts.envName.includeScripts';
  private static readonly envNameExcludeScriptsConfigKey = 'latooScripts.envName.excludeScripts';
  private static readonly internalRunModeConfigKey = 'latooScripts.internalRun.mode';
  private static readonly internalRunIncludeScriptsConfigKey = 'latooScripts.internalRun.includeScripts';
  private static readonly internalRunExcludeScriptsConfigKey = 'latooScripts.internalRun.excludeScripts';
  private static readonly internalRunLocationConfigKey = 'latooScripts.internalRun.location';
  private static readonly internalRunLocationOverridesConfigKey = 'latooScripts.internalRun.locationOverrides';
  private static readonly internalRunPreserveFocusConfigKey = 'latooScripts.internalRun.preserveFocus';
  private static readonly internalRunOpenNewWhenBusyConfigKey = 'latooScripts.internalRun.openNewWhenBusy';
  private static readonly persistentTerminalOverridesConfigKey = 'latooScripts.persistentTerminal.overrides';
  private static readonly persistentTerminalIncludeScriptsConfigKey = 'latooScripts.persistentTerminal.includeScripts';
  private static readonly persistentTerminalExcludeScriptsConfigKey = 'latooScripts.persistentTerminal.excludeScripts';
  private static readonly persistentTerminalDefaultColorsConfigKey = 'latooScripts.persistentTerminal.defaultColors';
  private static readonly actionVisibilityOpenScriptConfigKey = 'latooScripts.actions.showOpenScript';
  private static readonly actionVisibilityRunSecondaryConfigKey = 'latooScripts.actions.showRunSecondary';
  private static readonly actionVisibilityRunExternalConfigKey = 'latooScripts.actions.showRunExternal';
  private static readonly actionVisibilityOpenExternalTabCopyCommandConfigKey = 'latooScripts.actions.showOpenExternalTabCopyCommand';
  private static readonly actionVisibilityFavoriteConfigKey = 'latooScripts.actions.showFavorite';
  private static readonly primaryClickTargetConfigKey = 'latooScripts.primaryClick.target';
  private static readonly internalRunAlwaysNewOverridesConfigKey = 'latooScripts.internalRun.alwaysNewOverrides';

  private view?: vscode.WebviewView;
  private workspaces: WorkspaceInfo[] = [];
  private packageManager: string;
  private rootPaths: string[];
  private worktreeByRootPath = new Map<string, boolean>();
  private favoritesScopeId = 'default';

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
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (this.didRelevantConfigChange(event)) {
        this.sendUpdate();
      }
    });
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
            const injectEnvName = this.shouldInjectEnvName(msg.workspacePath, msg.scriptName);
          this.terminalManager.run(
            msg.workspacePath,
            msg.scriptName,
            msg.scriptCommand,
            Boolean(msg.isRawCommand),
            this.packageManager,
            this.getEnvName(),
            injectEnvName,
            this.getInternalRunOptions(msg.workspacePath, msg.scriptName, msg.locationOverride)
          );
          }
          break;
        case 'runExternal':
          {
            const injectEnvName = this.shouldInjectEnvName(msg.workspacePath, msg.scriptName);
          this.terminalManager.runExternal(
            msg.workspacePath,
            msg.scriptName,
            msg.scriptCommand,
            Boolean(msg.isRawCommand),
            this.packageManager,
            this.getEnvName(),
            injectEnvName,
            this.getExternalRunCommandTemplate()
          );
          }
          break;
        case 'openExternalTabCopyCommand':
          {
            const injectEnvName = this.shouldInjectEnvName(msg.workspacePath, msg.scriptName);
          this.terminalManager.openExternalTabCopyCommand(
            msg.workspacePath,
            msg.scriptName,
            msg.scriptCommand,
            Boolean(msg.isRawCommand),
            this.packageManager,
            this.getEnvName(),
            injectEnvName
          );
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
            ScriptsViewProvider.persistentTerminalIncludeScriptsConfigKey,
            ScriptsViewProvider.persistentTerminalExcludeScriptsConfigKey,
            msg.workspacePath,
            msg.scriptName,
            msg.enabled
          );
          break;
        case 'toggleEnvNameScriptDisabled':
          void this.setScriptFeatureEnabled(
            ScriptsViewProvider.envNameIncludeScriptsConfigKey,
            ScriptsViewProvider.envNameExcludeScriptsConfigKey,
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
    const selected = await vscode.window.showQuickPick<{
      label: string;
      detail?: string;
      value:
        | 'primary-click'
        | 'quick-actions'
        | 'internal-run-mode'
        | 'internal-run-location'
        | 'internal-run-preserve-focus'
        | 'internal-run-open-new-when-busy'
        | 'env-name-enabled'
        | 'env-name-source'
        | 'auto-terminal-style-enabled'
        | 'custom-favorite-commands-enabled';
    }>(
      [
        {
          label: `Toggle primary click target (current: ${this.getPrimaryClickTarget() === 'internal' ? 'Run internally' : 'Run externally'})`,
          detail: this.getConfigurationDescription(
            ScriptsViewProvider.primaryClickTargetConfigKey,
            'Controls whether clicking a script row runs internally or externally by default.'
          ),
          value: 'primary-click',
        },
        {
          label: 'Choose visible row action buttons',
          detail: 'Controls which quick action buttons are visible on each script row.',
          value: 'quick-actions',
        },
        {
          label: `Toggle internal run mode (current: ${this.getInternalRunMode()})`,
          detail: this.getConfigurationDescription(
            ScriptsViewProvider.internalRunModeConfigKey,
            'Switches between one shared runner terminal and per-script terminals.'
          ),
          value: 'internal-run-mode',
        },
        {
          label: `Toggle internal run location (current: ${this.getInternalRunLocation()})`,
          detail: this.getConfigurationDescription(
            ScriptsViewProvider.internalRunLocationConfigKey,
            'Sets whether internal runs open in terminal panel or editor area.'
          ),
          value: 'internal-run-location',
        },
        {
          label: `Toggle preserve focus on run (current: ${this.getInternalRunPreserveFocus() ? 'on' : 'off'})`,
          detail: this.getConfigurationDescription(
            ScriptsViewProvider.internalRunPreserveFocusConfigKey,
            'When enabled, running scripts keeps editor focus.'
          ),
          value: 'internal-run-preserve-focus',
        },
        {
          label: `Toggle open new terminal when busy (current: ${this.getInternalRunOpenNewWhenBusy() ? 'on' : 'off'})`,
          detail: this.getConfigurationDescription(
            ScriptsViewProvider.internalRunOpenNewWhenBusyConfigKey,
            'When enabled, busy terminals get a new overflow terminal instead of interruption.'
          ),
          value: 'internal-run-open-new-when-busy',
        },
        {
          label: `Toggle envName hint visibility (current: ${this.getEnvNameEnabled() ? 'on' : 'off'})`,
          detail: this.getConfigurationDescription(
            ScriptsViewProvider.envNameEnabledConfigKey,
            'Shows or hides envName in the Latoo Scripts view header.'
          ),
          value: 'env-name-enabled',
        },
        {
          label: `Toggle envName source (current: ${this.getUseWorkspaceFolderName() ? 'workspace folder/worktree aware' : 'envName.default'})`,
          detail: this.getConfigurationDescription(
            ScriptsViewProvider.envNameUseWorkspaceFolderNameConfigKey,
            'Chooses envName source between workspace folder name and envName.default.'
          ),
          value: 'env-name-source',
        },
        {
          label: `Toggle auto terminal style for all scripts (current: ${this.isAutoTerminalStyleEnabledGlobally() ? 'on' : 'off'})`,
          detail: this.getConfigurationDescription(
            ScriptsViewProvider.persistentTerminalIncludeScriptsConfigKey,
            'Controls which scripts receive auto terminal style (name/color).'
          ),
          value: 'auto-terminal-style-enabled',
        },
        {
          label: `Toggle custom favorite commands (current: ${this.getCustomFavoriteCommandsEnabled() ? 'on' : 'off'})`,
          detail: this.getConfigurationDescription(
            ScriptsViewProvider.customFavoriteCommandsEnabledConfigKey,
            'Shows configurable always-on-top favorite command entries.'
          ),
          value: 'custom-favorite-commands-enabled',
        },
      ],
      {
        placeHolder: 'Quick settings: choose what to configure',
        ignoreFocusOut: false,
      }
    );
    if (!selected) { return; }

    switch (selected.value) {
      case 'primary-click':
        await this.togglePrimaryClickTarget();
        return;
      case 'quick-actions':
        await this.toggleQuickActionVisibility();
        return;
      case 'internal-run-mode':
        await this.toggleInternalRunMode();
        return;
      case 'internal-run-location':
        await this.toggleInternalRunLocation();
        return;
      case 'internal-run-preserve-focus':
        await this.toggleInternalRunPreserveFocus();
        return;
      case 'internal-run-open-new-when-busy':
        await this.toggleInternalRunOpenNewWhenBusy();
        return;
      case 'env-name-enabled':
        await this.toggleEnvNameEnabled();
        return;
      case 'env-name-source':
        await this.toggleEnvNameSource();
        return;
      case 'auto-terminal-style-enabled':
        await this.toggleAutoTerminalStyleEnabledGlobally();
        return;
      case 'custom-favorite-commands-enabled':
        await this.toggleCustomFavoriteCommandsEnabled();
        return;
    }
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

    const migratedFavorites = this.migrateFavorites(this.stateManager.getFavorites());
    const envNameEnabled = this.getEnvNameEnabled();
    const envName = this.getEnvName();

    this.view.description = envNameEnabled ? `envName: ${envName}` : undefined;

    const message: ExtToWebviewMessage = {
      type: 'updateData',
      workspaces: this.workspaces,
      favorites: migratedFavorites,
      tabOrder: this.stateManager.getTabOrder(),
      favoritesSectionOrder: this.stateManager.getFavoritesSectionOrder(),
      packageManager: this.packageManager,
      envName,
      isEnvNameAuto: this.getUseWorkspaceFolderName(),
      isEnvNameEnabled: envNameEnabled,
      primaryRunLocation: this.getInternalRunLocation(),
      primaryClickTarget: this.getPrimaryClickTarget(),
      actionVisibility: this.getActionVisibility(),
      scriptFeatureFilters: this.getScriptFeatureFilters(),
      internalRunLocationOverrides: this.getInternalRunLocationOverrides(),
      internalRunAlwaysNewOverrides: this.getInternalRunAlwaysNewOverrides(),
      customFavoriteEntries: this.getCustomFavoriteEntries(),
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

  private getExternalRunCommandTemplate(): string {
    return vscode.workspace
      .getConfiguration()
      .get<string>(
        ScriptsViewProvider.externalRunCommandConfigKey,
        'open "warp://action/new_tab?path={workspacePathUri}&command={runCommandUri}"'
      );
  }

  private getInternalRunMode(): InternalRunOptions['mode'] {
    const value = vscode.workspace
      .getConfiguration()
      .get<string>(ScriptsViewProvider.internalRunModeConfigKey, 'dedicated');
    return value === 'perScript' ? 'perScript' : 'dedicated';
  }

  private getInternalRunLocation(): InternalRunOptions['location'] {
    const value = vscode.workspace
      .getConfiguration()
      .get<string>(ScriptsViewProvider.internalRunLocationConfigKey, 'panel');
    return value === 'editor' ? 'editor' : 'panel';
  }

  private getPrimaryClickTarget(): PrimaryClickTarget {
    const value = vscode.workspace
      .getConfiguration()
      .get<string>(ScriptsViewProvider.primaryClickTargetConfigKey, 'internal');
    return value === 'external' ? 'external' : 'internal';
  }

  private getInternalRunAlwaysNewOverrides(): Record<string, boolean> {
    const configured = vscode.workspace
      .getConfiguration()
      .get<Record<string, boolean>>(ScriptsViewProvider.internalRunAlwaysNewOverridesConfigKey, {});
    const normalized: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(configured)) {
      if (typeof value === 'boolean') {
        normalized[key] = value;
      }
    }
    return normalized;
  }

  private getInternalRunPreserveFocus(): boolean {
    return vscode.workspace
      .getConfiguration()
      .get<boolean>(ScriptsViewProvider.internalRunPreserveFocusConfigKey, true);
  }

  private getInternalRunOpenNewWhenBusy(): boolean {
    return vscode.workspace
      .getConfiguration()
      .get<boolean>(ScriptsViewProvider.internalRunOpenNewWhenBusyConfigKey, true);
  }

  private getInternalRunOptions(
    workspacePath: string,
    scriptName: string,
    locationOverride?: InternalRunLocation
  ): InternalRunOptions {
    const useInternalRunBehavior = this.shouldApplyInternalRunBehavior(workspacePath, scriptName);
    const location = locationOverride
      ?? this.getScriptLocationOverride(workspacePath, scriptName)
      ?? (useInternalRunBehavior ? this.getInternalRunLocation() : 'panel');
    const terminalStyle = this.getInternalRunTerminalStyle(workspacePath, scriptName);
    return {
      mode: useInternalRunBehavior ? this.getInternalRunMode() : 'dedicated',
      location,
      preserveFocus: useInternalRunBehavior ? this.getInternalRunPreserveFocus() : true,
      openNewWhenBusy: useInternalRunBehavior ? this.getInternalRunOpenNewWhenBusy() : true,
      alwaysNewTerminal: this.getScriptAlwaysNewOverride(workspacePath, scriptName),
      terminalStyle,
    };
  }

  private getInternalRunLocationOverrides(): Record<string, InternalRunLocation> {
    const configured = vscode.workspace
      .getConfiguration()
      .get<Record<string, string>>(ScriptsViewProvider.internalRunLocationOverridesConfigKey, {});
    const normalized: Record<string, InternalRunLocation> = {};
    for (const [key, value] of Object.entries(configured)) {
      if (value === 'panel' || value === 'editor') {
        normalized[key] = value;
      }
    }
    return normalized;
  }

  private getScriptLocationOverride(
    workspacePath: string,
    scriptName: string
  ): InternalRunLocation | undefined {
    return this.getInternalRunLocationOverrides()[this.getPersistentTerminalKey(workspacePath, scriptName)];
  }

  private getScriptAlwaysNewOverride(workspacePath: string, scriptName: string): boolean {
    return this.getInternalRunAlwaysNewOverrides()[this.getPersistentTerminalKey(workspacePath, scriptName)] === true;
  }

  private getActionVisibility(): ActionVisibility {
    const configuration = vscode.workspace.getConfiguration();
    return {
      openScript: configuration.get<boolean>(ScriptsViewProvider.actionVisibilityOpenScriptConfigKey, true),
      runSecondary: configuration.get<boolean>(ScriptsViewProvider.actionVisibilityRunSecondaryConfigKey, true),
      runExternal: configuration.get<boolean>(ScriptsViewProvider.actionVisibilityRunExternalConfigKey, true),
      openExternalTabCopyCommand: configuration.get<boolean>(
        ScriptsViewProvider.actionVisibilityOpenExternalTabCopyCommandConfigKey,
        true
      ),
      favorite: configuration.get<boolean>(ScriptsViewProvider.actionVisibilityFavoriteConfigKey, true),
    };
  }

  private getPersistentTerminalOverrides(): Record<string, PersistentTerminalOverride> {
    return vscode.workspace
      .getConfiguration()
      .get<Record<string, PersistentTerminalOverride>>(
        ScriptsViewProvider.persistentTerminalOverridesConfigKey,
        {}
      );
  }

  private getPersistentTerminalDefaultColors(): string[] {
    const configuredColors = vscode.workspace
      .getConfiguration()
      .get<string[]>(
        ScriptsViewProvider.persistentTerminalDefaultColorsConfigKey,
        [
          'terminal.ansiBlue',
          'terminal.ansiCyan',
          'terminal.ansiGreen',
          'terminal.ansiMagenta',
          'terminal.ansiYellow',
          'terminal.ansiRed',
        ]
      );
    const filtered = configuredColors.filter((colorId) => colorId.trim().length > 0);
    if (filtered.length > 0) {
      return filtered;
    }
    return ['terminal.ansiBlue'];
  }

  private getTerminalStyleOverride(
    workspacePath: string,
    scriptName: string
  ): PersistentTerminalOverride | undefined {
    const overrides = this.getPersistentTerminalOverrides();
    return overrides[this.getPersistentTerminalKey(workspacePath, scriptName)];
  }

  private getInternalRunTerminalStyle(
    workspacePath: string,
    scriptName: string
  ): InternalRunOptions['terminalStyle'] | undefined {
    if (!this.shouldApplyPersistentTerminalBehavior(workspacePath, scriptName)) {
      return undefined;
    }
    const override = this.getTerminalStyleOverride(workspacePath, scriptName);
    const overrideName = override?.name?.trim();
    const overrideColor = override?.color?.trim();
    const keyHash = createHash('sha1')
      .update(this.getPersistentTerminalKey(workspacePath, scriptName))
      .digest('hex')
      .slice(0, 10);
    return {
      key: `persistent:${keyHash}`,
      name: overrideName && overrideName.length > 0
        ? overrideName
        : this.buildDefaultPersistentTerminalName(scriptName),
      color: overrideColor && overrideColor.length > 0
        ? overrideColor
        : this.pickDefaultPersistentTerminalColor(workspacePath, scriptName),
    };
  }

  private getPersistentTerminalKey(workspacePath: string, scriptName: string): string {
    return `${workspacePath}::${scriptName}`;
  }

  private buildDefaultPersistentTerminalName(scriptName: string): string {
    return `Latoo • ${scriptName}`;
  }

  private pickDefaultPersistentTerminalColor(workspacePath: string, scriptName: string): string {
    const palette = this.getPersistentTerminalDefaultColors();
    const hashHex = createHash('sha1')
      .update(this.getPersistentTerminalKey(workspacePath, scriptName))
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

    const repoIdentity = this.getRepositoryIdentity(primaryRootPath);
    const hash = createHash('sha1').update(repoIdentity).digest('hex').slice(0, 12);
    return hash;
  }

  private getRepositoryIdentity(workspacePath: string): string {
    const dotGitPath = path.join(workspacePath, '.git');
    try {
      const dotGitStats = fs.statSync(dotGitPath);
      if (dotGitStats.isDirectory()) {
        return fs.realpathSync(dotGitPath);
      }
      if (!dotGitStats.isFile()) {
        return fs.realpathSync(workspacePath);
      }

      const dotGitContent = fs.readFileSync(dotGitPath, 'utf8');
      const gitDirLine = dotGitContent
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.toLowerCase().startsWith('gitdir:'));
      if (!gitDirLine) {
        return fs.realpathSync(workspacePath);
      }

      const gitDirValue = gitDirLine.slice('gitdir:'.length).trim();
      if (!gitDirValue) {
        return fs.realpathSync(workspacePath);
      }

      const resolvedGitDir = path.resolve(workspacePath, gitDirValue);
      const normalizedGitDir = resolvedGitDir.replace(/\\/g, '/').toLowerCase();
      if (normalizedGitDir.includes('/worktrees/')) {
        // Convert .git/worktrees/<name> to the repository .git directory.
        return fs.realpathSync(path.dirname(path.dirname(resolvedGitDir)));
      }

      return fs.realpathSync(resolvedGitDir);
    } catch {
      return workspacePath;
    }
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

  private getDefaultEnvName(): string {
    const configured = vscode.workspace
      .getConfiguration()
      .get<string>(ScriptsViewProvider.envNameDefaultConfigKey, 'local-0');
    const trimmed = configured?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : 'local-0';
  }

  private getUseWorkspaceFolderName(): boolean {
    return vscode.workspace
      .getConfiguration()
      .get<boolean>(ScriptsViewProvider.envNameUseWorkspaceFolderNameConfigKey, true);
  }

  private getEnvNameEnabled(): boolean {
    return vscode.workspace
      .getConfiguration()
      .get<boolean>(ScriptsViewProvider.envNameEnabledConfigKey, true);
  }

  private getCustomFavoriteCommandsEnabled(): boolean {
    return vscode.workspace
      .getConfiguration()
      .get<boolean>(ScriptsViewProvider.customFavoriteCommandsEnabledConfigKey, true);
  }

  private getCustomFavoriteEntries():
    { workspacePath: string; workspaceName: string; scriptName: string; scriptCommand: string; iconId?: string }[] {
    const workspacePath = this.rootPaths[0]?.trim();
    if (!workspacePath || !this.getCustomFavoriteCommandsEnabled()) {
      return [];
    }

    const configuredEntries = vscode.workspace
      .getConfiguration()
      .get<Array<{ name?: unknown; command?: unknown; iconId?: unknown }>>(
        ScriptsViewProvider.customFavoriteCommandsEntriesConfigKey,
        [{ name: 'claude', command: 'claude', iconId: 'claude' }]
      );

    const workspaceName = path.basename(workspacePath);
    const entries: { workspacePath: string; workspaceName: string; scriptName: string; scriptCommand: string; iconId?: string }[] = [];
    for (const entry of configuredEntries) {
      const scriptName = typeof entry?.name === 'string' ? entry.name.trim() : '';
      const scriptCommand = typeof entry?.command === 'string' ? entry.command.trim() : '';
      const iconIdValue = typeof entry?.iconId === 'string' ? entry.iconId.trim() : '';
      if (scriptName.length === 0 || scriptCommand.length === 0) {
        continue;
      }
      entries.push({
        workspacePath,
        workspaceName,
        scriptName,
        scriptCommand,
        iconId: iconIdValue.length > 0 ? iconIdValue : undefined,
      });
    }
    return entries;
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
    const isWorktree = this.detectGitWorktree(primaryRootPath);
    this.worktreeByRootPath.set(primaryRootPath, isWorktree);
    return isWorktree;
  }

  private detectGitWorktree(workspacePath: string): boolean {
    try {
      const dotGitPath = path.join(workspacePath, '.git');
      const dotGitStats = fs.statSync(dotGitPath);
      if (!dotGitStats.isFile()) { return false; }
      const dotGitContent = fs.readFileSync(dotGitPath, 'utf8');
      const gitDirLine = dotGitContent
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.toLowerCase().startsWith('gitdir:'));
      if (!gitDirLine) { return false; }
      const gitDirValue = gitDirLine.slice('gitdir:'.length).trim();
      if (!gitDirValue) { return false; }

      // Worktree .git files point into the repository's .git/worktrees/... path.
      const resolvedGitDir = path.resolve(workspacePath, gitDirValue);
      const normalizedGitDir = resolvedGitDir.replace(/\\/g, '/').toLowerCase();
      return normalizedGitDir.includes('/worktrees/');
    } catch {
      return false;
    }
  }

  private getEnvName(): string {
    if (this.getUseWorkspaceFolderName()) {
      if (this.isPrimaryRootGitWorktree()) {
        const folderName = this.getWorkspaceFolderName().trim();
        if (folderName.length > 0) {
          return folderName;
        }
      }
      return this.getDefaultEnvName();
    }

    return this.getDefaultEnvName();
  }

  private getEnvNameIncludeScripts(): string[] {
    return this.getScriptPatternList(ScriptsViewProvider.envNameIncludeScriptsConfigKey, ['*']);
  }

  private getEnvNameExcludeScripts(): string[] {
    return this.getScriptPatternList(ScriptsViewProvider.envNameExcludeScriptsConfigKey, []);
  }

  private getInternalRunIncludeScripts(): string[] {
    return this.getScriptPatternList(ScriptsViewProvider.internalRunIncludeScriptsConfigKey, ['*']);
  }

  private getInternalRunExcludeScripts(): string[] {
    return this.getScriptPatternList(ScriptsViewProvider.internalRunExcludeScriptsConfigKey, []);
  }

  private getPersistentTerminalIncludeScripts(): string[] {
    return this.getScriptPatternList(ScriptsViewProvider.persistentTerminalIncludeScriptsConfigKey, ['*']);
  }

  private getPersistentTerminalExcludeScripts(): string[] {
    return this.getScriptPatternList(ScriptsViewProvider.persistentTerminalExcludeScriptsConfigKey, []);
  }

  private shouldInjectEnvName(workspacePath: string, scriptName: string): boolean {
    return this.isScriptTargetEnabled(
      this.getEnvNameIncludeScripts(),
      this.getEnvNameExcludeScripts(),
      workspacePath,
      scriptName
    );
  }

  private shouldApplyInternalRunBehavior(workspacePath: string, scriptName: string): boolean {
    return this.isScriptTargetEnabled(
      this.getInternalRunIncludeScripts(),
      this.getInternalRunExcludeScripts(),
      workspacePath,
      scriptName
    );
  }

  private shouldApplyPersistentTerminalBehavior(workspacePath: string, scriptName: string): boolean {
    return this.isScriptTargetEnabled(
      this.getPersistentTerminalIncludeScripts(),
      this.getPersistentTerminalExcludeScripts(),
      workspacePath,
      scriptName
    );
  }

  private isScriptTargetEnabled(
    includePatterns: string[],
    excludePatterns: string[],
    workspacePath: string,
    scriptName: string
  ): boolean {
    const isIncluded = includePatterns.some((pattern) =>
      this.matchesScriptTargetPattern(workspacePath, scriptName, pattern)
    );
    if (!isIncluded) {
      return false;
    }
    const isExcluded = excludePatterns.some((pattern) =>
      this.matchesScriptTargetPattern(workspacePath, scriptName, pattern)
    );
    return !isExcluded;
  }

  private matchesScriptTargetPattern(workspacePath: string, scriptName: string, pattern: string): boolean {
    const separatorIndex = pattern.indexOf('::');
    if (separatorIndex < 0) {
      return this.matchesScriptPattern(scriptName, pattern);
    }
    const workspacePattern = pattern.slice(0, separatorIndex) || '*';
    const scriptPattern = pattern.slice(separatorIndex + 2) || '*';
    return this.matchesScriptPattern(workspacePath, workspacePattern)
      && this.matchesScriptPattern(scriptName, scriptPattern);
  }

  private getScriptPatternList(configKey: string, defaultValue: string[]): string[] {
    const configured = vscode.workspace
      .getConfiguration()
      .get<string[]>(configKey, defaultValue);
    const normalized = configured
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern.length > 0);
    return normalized.length > 0 ? normalized : defaultValue;
  }

  private matchesScriptPattern(scriptName: string, pattern: string): boolean {
    if (pattern === '*') {
      return true;
    }
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(scriptName);
  }

  private getScriptFeatureFilters(): ExtToWebviewMessage['scriptFeatureFilters'] {
    return {
      envName: {
        includeScripts: this.getEnvNameIncludeScripts(),
        excludeScripts: this.getEnvNameExcludeScripts(),
      },
      internalRun: {
        includeScripts: this.getInternalRunIncludeScripts(),
        excludeScripts: this.getInternalRunExcludeScripts(),
      },
      persistentTerminal: {
        includeScripts: this.getPersistentTerminalIncludeScripts(),
        excludeScripts: this.getPersistentTerminalExcludeScripts(),
      },
    };
  }

  private async setScriptFeatureEnabled(
    includeConfigKey: string,
    configKey: string,
    workspacePath: string,
    scriptName: string,
    enabled: boolean
  ): Promise<void> {
    const target = this.getPersistentTerminalKey(workspacePath, scriptName);
    const includeList = this.getScriptPatternList(includeConfigKey, ['*']);
    const includeSet = new Set(includeList);
    if (enabled && !includeList.some((pattern) => this.matchesScriptTargetPattern(workspacePath, scriptName, pattern))) {
      includeSet.add(target);
      await vscode.workspace.getConfiguration().update(
        includeConfigKey,
        Array.from(includeSet),
        vscode.ConfigurationTarget.Workspace
      );
    }

    const list = this.getScriptPatternList(configKey, []);
    const nextSet = new Set(list);
    if (enabled) {
      nextSet.delete(target);
    } else {
      nextSet.add(target);
    }
    await vscode.workspace.getConfiguration().update(
      configKey,
      Array.from(nextSet),
      vscode.ConfigurationTarget.Workspace
    );
  }

  private async setScriptLocationOverride(
    workspacePath: string,
    scriptName: string,
    location: InternalRunLocation | undefined
  ): Promise<void> {
    this.terminalManager.disposeScriptTerminals(workspacePath, scriptName);
    const key = this.getPersistentTerminalKey(workspacePath, scriptName);
    const overrides = { ...this.getInternalRunLocationOverrides() };
    if (!location) {
      delete overrides[key];
    } else {
      overrides[key] = location;
    }
    await vscode.workspace.getConfiguration().update(
      ScriptsViewProvider.internalRunLocationOverridesConfigKey,
      overrides,
      vscode.ConfigurationTarget.Workspace
    );
  }

  private async setScriptAlwaysNewOverride(
    workspacePath: string,
    scriptName: string,
    enabled: boolean
  ): Promise<void> {
    const key = this.getPersistentTerminalKey(workspacePath, scriptName);
    const overrides = { ...this.getInternalRunAlwaysNewOverrides() };
    overrides[key] = enabled;
    await vscode.workspace.getConfiguration().update(
      ScriptsViewProvider.internalRunAlwaysNewOverridesConfigKey,
      overrides,
      vscode.ConfigurationTarget.Workspace
    );
  }

  private async togglePrimaryClickTarget(): Promise<void> {
    const next = this.getPrimaryClickTarget() === 'internal' ? 'external' : 'internal';
    await vscode.workspace.getConfiguration().update(
      ScriptsViewProvider.primaryClickTargetConfigKey,
      next,
      vscode.ConfigurationTarget.Workspace
    );
  }

  private async toggleInternalRunMode(): Promise<void> {
    const next = this.getInternalRunMode() === 'dedicated' ? 'perScript' : 'dedicated';
    await vscode.workspace.getConfiguration().update(
      ScriptsViewProvider.internalRunModeConfigKey,
      next,
      vscode.ConfigurationTarget.Workspace
    );
  }

  private async toggleInternalRunLocation(): Promise<void> {
    const next = this.getInternalRunLocation() === 'panel' ? 'editor' : 'panel';
    await vscode.workspace.getConfiguration().update(
      ScriptsViewProvider.internalRunLocationConfigKey,
      next,
      vscode.ConfigurationTarget.Workspace
    );
  }

  private async toggleInternalRunPreserveFocus(): Promise<void> {
    await vscode.workspace.getConfiguration().update(
      ScriptsViewProvider.internalRunPreserveFocusConfigKey,
      !this.getInternalRunPreserveFocus(),
      vscode.ConfigurationTarget.Workspace
    );
  }

  private async toggleInternalRunOpenNewWhenBusy(): Promise<void> {
    await vscode.workspace.getConfiguration().update(
      ScriptsViewProvider.internalRunOpenNewWhenBusyConfigKey,
      !this.getInternalRunOpenNewWhenBusy(),
      vscode.ConfigurationTarget.Workspace
    );
  }

  private async toggleEnvNameEnabled(): Promise<void> {
    await vscode.workspace.getConfiguration().update(
      ScriptsViewProvider.envNameEnabledConfigKey,
      !this.getEnvNameEnabled(),
      vscode.ConfigurationTarget.Workspace
    );
  }

  private async toggleEnvNameSource(): Promise<void> {
    await vscode.workspace.getConfiguration().update(
      ScriptsViewProvider.envNameUseWorkspaceFolderNameConfigKey,
      !this.getUseWorkspaceFolderName(),
      vscode.ConfigurationTarget.Workspace
    );
  }

  private isAutoTerminalStyleEnabledGlobally(): boolean {
    const includeScripts = this.getPersistentTerminalIncludeScripts();
    const excludeScripts = this.getPersistentTerminalExcludeScripts();
    return includeScripts.length === 1 && includeScripts[0] === '*' && excludeScripts.length === 0;
  }

  private async toggleAutoTerminalStyleEnabledGlobally(): Promise<void> {
    const enabled = this.isAutoTerminalStyleEnabledGlobally();
    const configuration = vscode.workspace.getConfiguration();
    if (enabled) {
      await configuration.update(
        ScriptsViewProvider.persistentTerminalIncludeScriptsConfigKey,
        [],
        vscode.ConfigurationTarget.Workspace
      );
      await configuration.update(
        ScriptsViewProvider.persistentTerminalExcludeScriptsConfigKey,
        [],
        vscode.ConfigurationTarget.Workspace
      );
      return;
    }
    await configuration.update(
      ScriptsViewProvider.persistentTerminalIncludeScriptsConfigKey,
      ['*'],
      vscode.ConfigurationTarget.Workspace
    );
    await configuration.update(
      ScriptsViewProvider.persistentTerminalExcludeScriptsConfigKey,
      [],
      vscode.ConfigurationTarget.Workspace
    );
  }

  private async toggleCustomFavoriteCommandsEnabled(): Promise<void> {
    await vscode.workspace.getConfiguration().update(
      ScriptsViewProvider.customFavoriteCommandsEnabledConfigKey,
      !this.getCustomFavoriteCommandsEnabled(),
      vscode.ConfigurationTarget.Workspace
    );
  }

  private async openUserSettingsJson(): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.openApplicationSettingsJson');
    } catch {
      await vscode.commands.executeCommand('workbench.action.openSettingsJson');
    }
  }

  private async toggleQuickActionVisibility(): Promise<void> {
    const current = this.getActionVisibility();
    const selected = await vscode.window.showQuickPick<{ label: string; picked: boolean; key: string }>(
      [
        { label: 'Open script in package.json', picked: current.openScript, key: ScriptsViewProvider.actionVisibilityOpenScriptConfigKey },
        { label: 'Run in secondary location', picked: current.runSecondary, key: ScriptsViewProvider.actionVisibilityRunSecondaryConfigKey },
        { label: 'Run in external window', picked: current.runExternal, key: ScriptsViewProvider.actionVisibilityRunExternalConfigKey },
        {
          label: 'Open external tab and copy command',
          picked: current.openExternalTabCopyCommand,
          key: ScriptsViewProvider.actionVisibilityOpenExternalTabCopyCommandConfigKey,
        },
        { label: 'Favorite', picked: current.favorite, key: ScriptsViewProvider.actionVisibilityFavoriteConfigKey },
      ],
      {
        canPickMany: true,
        placeHolder: 'Select row action buttons to show (selected = visible)',
        ignoreFocusOut: false,
      }
    );
    if (!selected) {
      return;
    }
    const selectedKeys = new Set(selected.map((item) => item.key));
    const updates: Array<{ key: string; value: boolean }> = [
      { key: ScriptsViewProvider.actionVisibilityOpenScriptConfigKey, value: selectedKeys.has(ScriptsViewProvider.actionVisibilityOpenScriptConfigKey) },
      { key: ScriptsViewProvider.actionVisibilityRunSecondaryConfigKey, value: selectedKeys.has(ScriptsViewProvider.actionVisibilityRunSecondaryConfigKey) },
      { key: ScriptsViewProvider.actionVisibilityRunExternalConfigKey, value: selectedKeys.has(ScriptsViewProvider.actionVisibilityRunExternalConfigKey) },
      {
        key: ScriptsViewProvider.actionVisibilityOpenExternalTabCopyCommandConfigKey,
        value: selectedKeys.has(ScriptsViewProvider.actionVisibilityOpenExternalTabCopyCommandConfigKey),
      },
      { key: ScriptsViewProvider.actionVisibilityFavoriteConfigKey, value: selectedKeys.has(ScriptsViewProvider.actionVisibilityFavoriteConfigKey) },
    ];
    for (const update of updates) {
      await vscode.workspace.getConfiguration().update(
        update.key,
        update.value,
        vscode.ConfigurationTarget.Workspace
      );
    }
  }

  private didRelevantConfigChange(event: vscode.ConfigurationChangeEvent): boolean {
    const keys = [
      ScriptsViewProvider.envNameDefaultConfigKey,
      ScriptsViewProvider.envNameUseWorkspaceFolderNameConfigKey,
      ScriptsViewProvider.envNameEnabledConfigKey,
      ScriptsViewProvider.customFavoriteCommandsEnabledConfigKey,
      ScriptsViewProvider.customFavoriteCommandsEntriesConfigKey,
      ScriptsViewProvider.envNameIncludeScriptsConfigKey,
      ScriptsViewProvider.envNameExcludeScriptsConfigKey,
      ScriptsViewProvider.internalRunModeConfigKey,
      ScriptsViewProvider.internalRunIncludeScriptsConfigKey,
      ScriptsViewProvider.internalRunExcludeScriptsConfigKey,
      ScriptsViewProvider.internalRunLocationConfigKey,
      ScriptsViewProvider.internalRunLocationOverridesConfigKey,
      ScriptsViewProvider.internalRunPreserveFocusConfigKey,
      ScriptsViewProvider.internalRunOpenNewWhenBusyConfigKey,
      ScriptsViewProvider.persistentTerminalOverridesConfigKey,
      ScriptsViewProvider.persistentTerminalIncludeScriptsConfigKey,
      ScriptsViewProvider.persistentTerminalExcludeScriptsConfigKey,
      ScriptsViewProvider.persistentTerminalDefaultColorsConfigKey,
      ScriptsViewProvider.primaryClickTargetConfigKey,
      ScriptsViewProvider.internalRunAlwaysNewOverridesConfigKey,
      ScriptsViewProvider.actionVisibilityOpenScriptConfigKey,
      ScriptsViewProvider.actionVisibilityRunSecondaryConfigKey,
      ScriptsViewProvider.actionVisibilityRunExternalConfigKey,
      ScriptsViewProvider.actionVisibilityOpenExternalTabCopyCommandConfigKey,
      ScriptsViewProvider.actionVisibilityFavoriteConfigKey,
    ];
    return keys.some((key) => event.affectsConfiguration(key));
  }

  private getConfigurationDescription(configKey: string, fallback: string): string {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.extensionUri.fsPath === this.extensionUri.fsPath
    );
    const properties = (extension?.packageJSON as {
      contributes?: { configuration?: { properties?: Record<string, { description?: unknown }> } };
    } | undefined)?.contributes?.configuration?.properties;
    const description = properties?.[configKey]?.description;
    if (typeof description === 'string' && description.trim().length > 0) {
      return description;
    }
    return fallback;
  }
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
