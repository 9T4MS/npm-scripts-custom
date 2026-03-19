import * as vscode from 'vscode';
import type { LatooScriptsConfig } from './types';

/**
 * Maps old dotted configuration keys (v0.1.x) to new flat property names (v0.2.0+).
 * Old: "latooScripts.internalRun.mode" → New: latooScripts.internalRunMode
 */
const LEGACY_KEY_MAP: ReadonlyArray<[oldKey: string, newProp: keyof LatooScriptsConfig]> = [
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

type ConfigScope = {
  target: vscode.ConfigurationTarget;
  getValue: <T>(inspection: { globalValue?: T; workspaceValue?: T; workspaceFolderValue?: T }) => T | undefined;
  getExisting: <T>(inspection: { globalValue?: T; workspaceValue?: T; workspaceFolderValue?: T }) => T | undefined;
};

const SCOPES: ConfigScope[] = [
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

export async function migrateLegacyConfig(): Promise<void> {
  const config = vscode.workspace.getConfiguration();

  for (const scope of SCOPES) {
    const patch: Partial<LatooScriptsConfig> = {};
    const keysToRemove: string[] = [];

    for (const [oldKey, newProp] of LEGACY_KEY_MAP) {
      const inspection = config.inspect(oldKey);
      if (!inspection) { continue; }
      const value = scope.getValue(inspection);
      if (value === undefined) { continue; }

      (patch as Record<string, unknown>)[newProp] = value;
      keysToRemove.push(oldKey);
    }

    if (keysToRemove.length === 0) { continue; }

    // Merge with any existing new-format values in this scope
    const newInspection = config.inspect<Partial<LatooScriptsConfig>>('latooScripts');
    const existing = newInspection ? scope.getExisting(newInspection) ?? {} : {};
    const merged = { ...existing, ...patch };

    try {
      await config.update('latooScripts', merged, scope.target);
      for (const oldKey of keysToRemove) {
        await config.update(oldKey, undefined, scope.target);
      }
    } catch {
      // Migration is best-effort — don't block activation
    }
  }
}
