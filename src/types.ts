import * as vscode from 'vscode';

export interface WorkspaceInfo {
  name: string;
  path: string;
  scripts: ScriptInfo[];
}

export interface ScriptInfo {
  name: string;
  command: string;
  workspaceName: string;
  workspacePath: string;
  scriptLine?: number;
  scriptColumn?: number;
  isRawCommand?: boolean;
}

export interface FavoriteEntry {
  workspacePath: string;
  workspaceName?: string;
  scriptName: string;
}

export type InternalRunMode = 'dedicated' | 'perScript';
export type InternalRunLocation = 'panel' | 'editor';

export type PersistentTerminalOverride = {
  name?: string;
  color?: string;
};

export type ActionVisibility = {
  openScript: boolean;
  runSecondary: boolean;
  runExternal: boolean;
  openExternalTabCopyCommand: boolean;
  favorite: boolean;
};

export type ScriptTargetFilters = {
  includeScripts: string[];
  excludeScripts: string[];
};

export type ScriptFeatureFilters = {
  envName: ScriptTargetFilters;
  internalRun: ScriptTargetFilters;
  persistentTerminal: ScriptTargetFilters;
};

export type PrimaryClickTarget = 'internal' | 'external';

export type InternalRunTerminalStyle = {
  key: string;
  name: string;
  color?: string;
};

export type InternalRunOptions = {
  mode: InternalRunMode;
  location: InternalRunLocation;
  preserveFocus: boolean;
  openNewWhenBusy: boolean;
  alwaysNewTerminal: boolean;
  terminalStyle?: InternalRunTerminalStyle;
};

// Messages from webview → extension
export type WebviewToExtMessage =
  | { type: 'ready' }
  | {
      type: 'runScript';
      workspacePath: string;
      scriptName: string;
      scriptCommand: string;
      isRawCommand?: boolean;
      locationOverride?: InternalRunLocation;
    }
  | {
      type: 'runExternal';
      workspacePath: string;
      scriptName: string;
      scriptCommand: string;
      isRawCommand?: boolean;
    }
  | {
      type: 'openExternalTabCopyCommand';
      workspacePath: string;
      scriptName: string;
      scriptCommand: string;
      isRawCommand?: boolean;
    }
  | {
      type: 'openScriptInPackageJson';
      workspacePath: string;
      scriptName: string;
      scriptLine?: number;
      scriptColumn?: number;
    }
  | {
      type: 'openWorkspaceScriptsInPackageJson';
      workspacePath: string;
      workspaceName?: string;
    }
  | { type: 'openUserSettingsJson' }
  | { type: 'toggleFavorite'; workspacePath: string; workspaceName?: string; scriptName: string }
  | { type: 'reorderTabs'; tabOrder: string[] }
  | { type: 'reorderFavoritesSections'; favoritesSectionOrder: string[] }
  | {
      type: 'togglePersistentTerminalScript';
      workspacePath: string;
      scriptName: string;
      enabled: boolean;
    }
  | {
      type: 'toggleEnvNameScriptDisabled';
      workspacePath: string;
      scriptName: string;
      disabled: boolean;
    }
  | {
      type: 'setScriptLocationOverride';
      workspacePath: string;
      scriptName: string;
      location?: InternalRunLocation;
    }
  | {
      type: 'setScriptAlwaysNewTerminal';
      workspacePath: string;
      scriptName: string;
      enabled: boolean;
    };

// Messages from extension → webview
export type ExtToWebviewMessage =
  | {
      type: 'updateData';
      workspaces: WorkspaceInfo[];
      favorites: FavoriteEntry[];
      tabOrder: string[];
      favoritesSectionOrder: string[];
      packageManager: string;
      envName: string;
      isEnvNameAuto: boolean;
      isEnvNameEnabled: boolean;
      primaryRunLocation: InternalRunLocation;
      primaryClickTarget: PrimaryClickTarget;
      actionVisibility: ActionVisibility;
      scriptFeatureFilters: ScriptFeatureFilters;
      internalRunLocationOverrides: Record<string, InternalRunLocation>;
      internalRunAlwaysNewOverrides: Record<string, boolean>;
      customFavoriteEntries?: {
        workspacePath: string;
        workspaceName: string;
        scriptName: string;
        scriptCommand: string;
        iconId?: string;
      }[];
    };

export interface StateManager {
  setFavoritesScope(scopeId: string): void;
  getFavorites(): FavoriteEntry[];
  setFavorites(favorites: FavoriteEntry[]): void;
  toggleFavorite(workspacePath: string, scriptName: string, workspaceName?: string): FavoriteEntry[];
  getFavoritesSectionOrder(): string[];
  setFavoritesSectionOrder(order: string[]): void;
  getTabOrder(): string[];
  setTabOrder(order: string[]): void;
}

export interface TerminalManager {
  run(
    workspacePath: string,
    scriptName: string,
    scriptCommand: string,
    isRawCommand: boolean,
    packageManager: string,
    envName: string,
    injectEnvName: boolean,
    options: InternalRunOptions
  ): void;
  runExternal(
    workspacePath: string,
    scriptName: string,
    scriptCommand: string,
    isRawCommand: boolean,
    packageManager: string,
    envName: string,
    injectEnvName: boolean,
    commandTemplate: string
  ): void;
  openExternalTabCopyCommand(
    workspacePath: string,
    scriptName: string,
    scriptCommand: string,
    isRawCommand: boolean,
    packageManager: string,
    envName: string,
    injectEnvName: boolean
  ): void;
  disposeScriptTerminals(workspacePath: string, scriptName: string): void;
  disposeManagedEditorTerminals(): void;
  dispose(): void;
}
