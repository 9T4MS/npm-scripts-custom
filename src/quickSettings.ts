import * as vscode from 'vscode';
import { LatooScriptsConfig, StateManager, CustomFavoriteEntry } from './types';
import { updateConfig } from './config';

type QuickSettingsOption =
  | 'primary-click'
  | 'quick-actions'
  | 'internal-run-mode'
  | 'internal-run-location'
  | 'internal-run-preserve-focus'
  | 'internal-run-open-new-when-busy'
  | 'env-name-enabled'
  | 'env-name-source'
  | 'auto-terminal-style-enabled'
  | 'custom-favorite-commands-enabled'
  | 'manage-custom-favorites';

export async function showQuickSettings(
  config: LatooScriptsConfig,
  extensionUri: vscode.Uri,
  stateManager: StateManager,
  _rootPaths: string[]
): Promise<void> {
  const autoStyleEnabled = isAutoTerminalStyleEnabledGlobally(config);

  const selected = await vscode.window.showQuickPick<{
    label: string;
    detail?: string;
    value: QuickSettingsOption;
  }>(
    [
      {
        label: `Toggle primary click target (current: ${config.primaryClickTarget === 'internal' ? 'Run internally' : 'Run externally'})`,
        detail: getConfigurationDescription(
          extensionUri,
          'latooScripts.primaryClick.target',
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
        label: `Toggle internal run mode (current: ${config.internalRunMode})`,
        detail: getConfigurationDescription(
          extensionUri,
          'latooScripts.internalRun.mode',
          'Switches between one shared runner terminal and per-script terminals.'
        ),
        value: 'internal-run-mode',
      },
      {
        label: `Toggle internal run location (current: ${config.internalRunLocation})`,
        detail: getConfigurationDescription(
          extensionUri,
          'latooScripts.internalRun.location',
          'Sets whether internal runs open in terminal panel or editor area.'
        ),
        value: 'internal-run-location',
      },
      {
        label: `Toggle preserve focus on run (current: ${config.internalRunPreserveFocus ? 'on' : 'off'})`,
        detail: getConfigurationDescription(
          extensionUri,
          'latooScripts.internalRun.preserveFocus',
          'When enabled, running scripts keeps editor focus.'
        ),
        value: 'internal-run-preserve-focus',
      },
      {
        label: `Toggle open new terminal when busy (current: ${config.internalRunOpenNewWhenBusy ? 'on' : 'off'})`,
        detail: getConfigurationDescription(
          extensionUri,
          'latooScripts.internalRun.openNewWhenBusy',
          'When enabled, busy terminals get a new overflow terminal instead of interruption.'
        ),
        value: 'internal-run-open-new-when-busy',
      },
      {
        label: `Toggle envName hint visibility (current: ${config.envNameEnabled ? 'on' : 'off'})`,
        detail: getConfigurationDescription(
          extensionUri,
          'latooScripts.envName.enabled',
          'Shows or hides envName in the Latoo Scripts view header.'
        ),
        value: 'env-name-enabled',
      },
      {
        label: `Toggle envName source (current: ${config.envNameUseWorkspaceFolderName ? 'workspace folder/worktree aware' : 'envName.default'})`,
        detail: getConfigurationDescription(
          extensionUri,
          'latooScripts.envName.useWorkspaceFolderName',
          'Chooses envName source between workspace folder name and envName.default.'
        ),
        value: 'env-name-source',
      },
      {
        label: `Toggle auto terminal style for all scripts (current: ${autoStyleEnabled ? 'on' : 'off'})`,
        detail: getConfigurationDescription(
          extensionUri,
          'latooScripts.persistentTerminal.includeScripts',
          'Controls which scripts receive auto terminal style (name/color).'
        ),
        value: 'auto-terminal-style-enabled',
      },
      {
        label: `Toggle custom favorite commands (current: ${config.customFavoriteCommandsEnabled ? 'on' : 'off'})`,
        detail: getConfigurationDescription(
          extensionUri,
          'latooScripts.customFavoriteCommands.enabled',
          'Shows configurable always-on-top favorite command entries.'
        ),
        value: 'custom-favorite-commands-enabled',
      },
      {
        label: 'Manage custom favorite commands',
        detail: 'Add, edit, or remove custom favorite command entries stored per repository.',
        value: 'manage-custom-favorites',
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
      await updateConfig({ primaryClickTarget: config.primaryClickTarget === 'internal' ? 'external' : 'internal' });
      return;
    case 'quick-actions':
      await toggleQuickActionVisibility(config);
      return;
    case 'internal-run-mode':
      await updateConfig({ internalRunMode: config.internalRunMode === 'dedicated' ? 'perScript' : 'dedicated' });
      return;
    case 'internal-run-location':
      await updateConfig({ internalRunLocation: config.internalRunLocation === 'panel' ? 'editor' : 'panel' });
      return;
    case 'internal-run-preserve-focus':
      await updateConfig({ internalRunPreserveFocus: !config.internalRunPreserveFocus });
      return;
    case 'internal-run-open-new-when-busy':
      await updateConfig({ internalRunOpenNewWhenBusy: !config.internalRunOpenNewWhenBusy });
      return;
    case 'env-name-enabled':
      await updateConfig({ envNameEnabled: !config.envNameEnabled });
      return;
    case 'env-name-source':
      await updateConfig({ envNameUseWorkspaceFolderName: !config.envNameUseWorkspaceFolderName });
      return;
    case 'auto-terminal-style-enabled':
      if (autoStyleEnabled) {
        await updateConfig({ persistentTerminalIncludeScripts: [], persistentTerminalExcludeScripts: [] });
      } else {
        await updateConfig({ persistentTerminalIncludeScripts: ['*'], persistentTerminalExcludeScripts: [] });
      }
      return;
    case 'custom-favorite-commands-enabled':
      await updateConfig({ customFavoriteCommandsEnabled: !config.customFavoriteCommandsEnabled });
      return;
    case 'manage-custom-favorites':
      await manageCustomFavoriteCommands(stateManager);
      return;
  }
}

function isAutoTerminalStyleEnabledGlobally(config: LatooScriptsConfig): boolean {
  return config.persistentTerminalIncludeScripts.length === 1
    && config.persistentTerminalIncludeScripts[0] === '*'
    && config.persistentTerminalExcludeScripts.length === 0;
}

async function toggleQuickActionVisibility(config: LatooScriptsConfig): Promise<void> {
  const items = [
    { label: 'Open script in package.json', picked: config.showOpenScript, key: 'showOpenScript' as const },
    { label: 'Run in secondary location', picked: config.showRunSecondary, key: 'showRunSecondary' as const },
    { label: 'Run in external window', picked: config.showRunExternal, key: 'showRunExternal' as const },
    { label: 'Open external tab and copy command', picked: config.showOpenExternalTabCopyCommand, key: 'showOpenExternalTabCopyCommand' as const },
    { label: 'Favorite', picked: config.showFavorite, key: 'showFavorite' as const },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select row action buttons to show (selected = visible)',
    ignoreFocusOut: false,
  });
  if (!selected) { return; }

  const selectedKeys = new Set(selected.map((item) => item.key));
  await updateConfig({
    showOpenScript: selectedKeys.has('showOpenScript'),
    showRunSecondary: selectedKeys.has('showRunSecondary'),
    showRunExternal: selectedKeys.has('showRunExternal'),
    showOpenExternalTabCopyCommand: selectedKeys.has('showOpenExternalTabCopyCommand'),
    showFavorite: selectedKeys.has('showFavorite'),
  });
}

function getConfigurationDescription(extensionUri: vscode.Uri, configKey: string, fallback: string): string {
  const extension = vscode.extensions.all.find(
    (candidate) => candidate.extensionUri.fsPath === extensionUri.fsPath
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

async function manageCustomFavoriteCommands(stateManager: StateManager): Promise<void> {
  const entries = stateManager.getCustomFavoriteCommands();

  const items: { label: string; description?: string; value: 'add' | number }[] = [
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
  if (!selected) { return; }

  if (selected.value === 'add') {
    await addCustomFavoriteCommand(stateManager, entries);
    return;
  }

  const index = selected.value;
  const entry = entries[index];
  await editOrRemoveCustomFavoriteCommand(stateManager, entries, entry, index);
}

async function addCustomFavoriteCommand(stateManager: StateManager, entries: CustomFavoriteEntry[]): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: 'Command name (displayed in favorites)',
    placeHolder: 'e.g. claude',
    ignoreFocusOut: true,
  });
  if (!name || name.trim().length === 0) { return; }

  const command = await vscode.window.showInputBox({
    prompt: 'Shell command to run',
    placeHolder: 'e.g. claude',
    ignoreFocusOut: true,
  });
  if (!command || command.trim().length === 0) { return; }

  const iconId = await vscode.window.showInputBox({
    prompt: 'Icon ID (optional, leave blank for default)',
    placeHolder: 'e.g. claude-code',
    ignoreFocusOut: true,
  });

  const newEntry: CustomFavoriteEntry = {
    name: name.trim(),
    command: command.trim(),
    iconId: iconId && iconId.trim().length > 0 ? iconId.trim() : undefined,
  };
  stateManager.setCustomFavoriteCommands([...entries, newEntry]);
}

async function editOrRemoveCustomFavoriteCommand(
  stateManager: StateManager,
  entries: CustomFavoriteEntry[],
  entry: CustomFavoriteEntry,
  index: number
): Promise<void> {
  const action = await vscode.window.showQuickPick(
    [
      { label: '$(edit) Edit', value: 'edit' as const },
      { label: '$(trash) Remove', value: 'remove' as const },
    ],
    {
      placeHolder: `"${entry.name}" — choose action`,
      ignoreFocusOut: false,
    }
  );
  if (!action) { return; }

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
  if (!name || name.trim().length === 0) { return; }

  const command = await vscode.window.showInputBox({
    prompt: 'Shell command to run',
    value: entry.command,
    ignoreFocusOut: true,
  });
  if (!command || command.trim().length === 0) { return; }

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
