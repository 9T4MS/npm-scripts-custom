import * as vscode from 'vscode';
import type {
  ActionVisibility,
  InternalRunLocation,
  InternalRunMode,
  LatooScriptsConfig,
  PrimaryClickTarget,
  ScriptFeatureFilters,
} from './types';

export const DEFAULTS: Readonly<LatooScriptsConfig> = {
  primaryClickTarget: 'internal',
  externalRunCommandTemplate:
    'open "warp://action/new_tab?path={workspacePathUri}&command={runCommandUri}"',
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

export function readConfig(): LatooScriptsConfig {
  const raw = vscode.workspace.getConfiguration().get<Partial<LatooScriptsConfig>>('latooScripts', {});
  return { ...DEFAULTS, ...raw };
}

export async function updateConfig(
  patch: Partial<LatooScriptsConfig>,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace
): Promise<void> {
  const inspection = vscode.workspace.getConfiguration().inspect<Partial<LatooScriptsConfig>>('latooScripts');
  let scopeValue: Partial<LatooScriptsConfig>;
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

export function didConfigChange(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration('latooScripts');
}

export function getActionVisibility(config: LatooScriptsConfig): ActionVisibility {
  return {
    openScript: config.showOpenScript,
    runSecondary: config.showRunSecondary,
    runExternal: config.showRunExternal,
    openExternalTabCopyCommand: config.showOpenExternalTabCopyCommand,
    favorite: config.showFavorite,
  };
}

function normalizePatternList(patterns: string[] | undefined, defaultValue: string[]): string[] {
  const source = patterns ?? defaultValue;
  const normalized = source.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0);
  return normalized.length > 0 ? normalized : defaultValue;
}

export function getScriptFeatureFilters(config: LatooScriptsConfig): ScriptFeatureFilters {
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

export function getValidatedDefaultColors(config: LatooScriptsConfig): string[] {
  const filtered = config.persistentTerminalDefaultColors.filter((colorId) => colorId.trim().length > 0);
  if (filtered.length > 0) {
    return filtered;
  }
  return ['terminal.ansiBlue'];
}

export function normalizeInternalRunMode(config: LatooScriptsConfig): InternalRunMode {
  return config.internalRunMode === 'perScript' ? 'perScript' : 'dedicated';
}

export function normalizeInternalRunLocation(config: LatooScriptsConfig): InternalRunLocation {
  return config.internalRunLocation === 'editor' ? 'editor' : 'panel';
}

export function normalizePrimaryClickTarget(config: LatooScriptsConfig): PrimaryClickTarget {
  return config.primaryClickTarget === 'external' ? 'external' : 'internal';
}

export function normalizeLocationOverrides(
  config: LatooScriptsConfig
): Record<string, InternalRunLocation> {
  const configured = config.internalRunLocationOverrides;
  const normalized: Record<string, InternalRunLocation> = {};
  for (const [key, value] of Object.entries(configured)) {
    if (value === 'panel' || value === 'editor') {
      normalized[key] = value;
    }
  }
  return normalized;
}

export function normalizeAlwaysNewOverrides(config: LatooScriptsConfig): Record<string, boolean> {
  const configured = config.internalRunAlwaysNewOverrides;
  const normalized: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(configured)) {
    if (typeof value === 'boolean') {
      normalized[key] = value;
    }
  }
  return normalized;
}

export function isScriptTargetEnabled(
  includePatterns: string[],
  excludePatterns: string[],
  workspacePath: string,
  scriptName: string
): boolean {
  const isIncluded = includePatterns.some((pattern) =>
    matchesScriptTargetPattern(workspacePath, scriptName, pattern)
  );
  if (!isIncluded) {
    return false;
  }
  const isExcluded = excludePatterns.some((pattern) =>
    matchesScriptTargetPattern(workspacePath, scriptName, pattern)
  );
  return !isExcluded;
}

export function matchesScriptTargetPattern(
  workspacePath: string,
  scriptName: string,
  pattern: string
): boolean {
  const separatorIndex = pattern.indexOf('::');
  if (separatorIndex < 0) {
    return matchesScriptPattern(scriptName, pattern);
  }
  const workspacePattern = pattern.slice(0, separatorIndex) || '*';
  const scriptPattern = pattern.slice(separatorIndex + 2) || '*';
  return (
    matchesScriptPattern(workspacePath, workspacePattern) &&
    matchesScriptPattern(scriptName, scriptPattern)
  );
}

export function matchesScriptPattern(value: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(value);
}
