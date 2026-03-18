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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const ScriptsViewProvider_1 = require("./ScriptsViewProvider");
const stateManager_1 = require("./stateManager");
const terminalManager_1 = require("./terminalManager");
function activate(context) {
    let rootPaths = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    if (rootPaths.length === 0) {
        return;
    }
    const stateManager = (0, stateManager_1.createStateManager)(context.workspaceState, context.globalState);
    const terminalManager = (0, terminalManager_1.createTerminalManager)();
    const provider = new ScriptsViewProvider_1.ScriptsViewProvider(context.extensionUri, rootPaths, stateManager, terminalManager);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(ScriptsViewProvider_1.ScriptsViewProvider.viewType, provider, {
        webviewOptions: { retainContextWhenHidden: true },
    }), vscode.commands.registerCommand('latooScripts.quickSettings', () => provider.showQuickSettings()), vscode.commands.registerCommand('latooScripts.refresh', () => provider.refresh()), terminalManager);
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
function deactivate() {
    // nothing to clean up
}
//# sourceMappingURL=extension.js.map