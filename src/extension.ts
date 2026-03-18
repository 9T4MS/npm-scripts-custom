import * as vscode from 'vscode';
import { ScriptsViewProvider } from './ScriptsViewProvider';
import { createStateManager } from './stateManager';
import { createTerminalManager } from './terminalManager';

export function activate(context: vscode.ExtensionContext): void {
  let rootPaths = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  if (rootPaths.length === 0) { return; }

  const stateManager = createStateManager(context.workspaceState, context.globalState);
  const terminalManager = createTerminalManager();

  const provider = new ScriptsViewProvider(
    context.extensionUri,
    rootPaths,
    stateManager,
    terminalManager
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ScriptsViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('latooScripts.quickSettings', () => provider.showQuickSettings()),
    vscode.commands.registerCommand('latooScripts.refresh', () => provider.refresh()),
    terminalManager
  );

  // Watch for package.json changes to auto-refresh
  const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
  watcher.onDidChange(() => provider.refresh());
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());
  const workspaceFolderListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    rootPaths = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    provider.updateRootPaths(rootPaths);
  });
  context.subscriptions.push(watcher, workspaceFolderListener);
}

export function deactivate(): void {
  // nothing to clean up
}
