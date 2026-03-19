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
exports.detectPackageManager = detectPackageManager;
exports.scanWorkspaces = scanWorkspaces;
exports.scanWorkspaceFolders = scanWorkspaceFolders;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ignoredDirNames = new Set([
    'node_modules',
    '.git',
    '.next',
    '.turbo',
    'dist',
    'build',
    'out',
    'coverage',
]);
function detectPackageManager(rootPath) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf-8'));
        if (typeof pkg.packageManager === 'string') {
            const match = pkg.packageManager.match(/^(pnpm|npm|yarn|bun)/);
            if (match) {
                return match[1];
            }
        }
    }
    catch { /* ignore */ }
    if (fs.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    if (fs.existsSync(path.join(rootPath, 'yarn.lock'))) {
        return 'yarn';
    }
    if (fs.existsSync(path.join(rootPath, 'bun.lockb'))) {
        return 'bun';
    }
    const vscodeSetting = vscode.workspace.getConfiguration('npm').get('packageManager');
    if (vscodeSetting && /^(pnpm|npm|yarn|bun)$/.test(vscodeSetting)) {
        return vscodeSetting;
    }
    return 'npm';
}
function scanWorkspaces(rootPath) {
    const globs = resolveWorkspaceGlobs(rootPath);
    const configuredDirs = globs.length > 0 ? expandGlobs(rootPath, globs) : [];
    const dirs = configuredDirs.length > 0 ? configuredDirs : collectPackageJsonDirs(rootPath);
    const workspaces = [];
    // Root workspace first
    const rootInfo = readWorkspace(rootPath, rootPath);
    if (rootInfo) {
        workspaces.push(rootInfo);
    }
    for (const dir of dirs) {
        if (dir === rootPath) {
            continue;
        }
        const info = readWorkspace(dir, rootPath);
        if (info) {
            workspaces.push(info);
        }
    }
    // Final safety net: if workspace rules produced nothing usable, still list scripts.
    if (workspaces.length === 0) {
        const fallbackDirs = collectPackageJsonDirs(rootPath);
        for (const dir of fallbackDirs) {
            const info = readWorkspace(dir, rootPath);
            if (info) {
                workspaces.push(info);
            }
        }
    }
    return workspaces;
}
function scanWorkspaceFolders(rootPaths) {
    const merged = [];
    const seenPaths = new Set();
    for (const rootPath of rootPaths) {
        const workspaces = scanWorkspaces(rootPath);
        for (const workspace of workspaces) {
            if (seenPaths.has(workspace.path)) {
                continue;
            }
            seenPaths.add(workspace.path);
            merged.push(workspace);
        }
    }
    return merged;
}
/** Resolves workspace glob patterns from pnpm-workspace.yaml or package.json workspaces field. */
function resolveWorkspaceGlobs(rootPath) {
    // 1. pnpm-workspace.yaml
    const yamlPath = path.join(rootPath, 'pnpm-workspace.yaml');
    if (fs.existsSync(yamlPath)) {
        try {
            const content = fs.readFileSync(yamlPath, 'utf-8');
            const globs = parsePnpmWorkspaceYaml(content);
            if (globs.length > 0) {
                return globs;
            }
        }
        catch { /* ignore */ }
    }
    // 2. package.json workspaces field (npm / yarn)
    const pkgPath = path.join(rootPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            let workspacesField = pkg.workspaces;
            // yarn uses { packages: [...] } shape
            if (workspacesField && typeof workspacesField === 'object' && !Array.isArray(workspacesField)) {
                const asObj = workspacesField;
                if (Array.isArray(asObj.packages)) {
                    workspacesField = asObj.packages;
                }
            }
            if (Array.isArray(workspacesField)) {
                const globs = workspacesField.map((g) => g.replace(/^\.\//, ''));
                if (globs.length > 0) {
                    return globs;
                }
            }
        }
        catch { /* ignore */ }
    }
    return [];
}
function parsePnpmWorkspaceYaml(yaml) {
    const globs = [];
    const lines = yaml.split('\n');
    let inPackages = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === 'packages:') {
            inPackages = true;
            continue;
        }
        if (inPackages) {
            if (trimmed.startsWith('- ')) {
                const glob = trimmed.slice(2).trim().replace(/^['"]|['"]$/g, '').replace(/^\.\//, '');
                // Skip negated patterns, fallback recursive scan handles exclusions safely.
                if (glob && !glob.startsWith('!')) {
                    globs.push(glob);
                }
            }
            else if (trimmed !== '' && !trimmed.startsWith('#')) {
                break;
            }
        }
    }
    return globs;
}
function expandGlobs(rootPath, globs) {
    const dirs = [];
    for (const glob of globs) {
        const normalised = glob.trim().replace(/^\.\//, '').replace(/\/$/, '');
        if (normalised.length === 0) {
            continue;
        }
        const segments = normalised.split('/').filter((segment) => segment.length > 0);
        if (segments.length === 0) {
            continue;
        }
        expandGlobSegments(rootPath, rootPath, segments, 0, dirs);
    }
    return [...new Set(dirs)].sort();
}
function expandGlobSegments(rootPath, currentPath, segments, segmentIndex, results) {
    if (segmentIndex >= segments.length) {
        if (isExistingDirectory(currentPath)) {
            results.push(currentPath);
        }
        return;
    }
    const segment = segments[segmentIndex];
    if (segment === '**') {
        // Match zero directory segments.
        expandGlobSegments(rootPath, currentPath, segments, segmentIndex + 1, results);
        // Match one or more directory segments.
        for (const entry of readDirectoryEntries(currentPath)) {
            if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) {
                continue;
            }
            expandGlobSegments(rootPath, path.join(currentPath, entry.name), segments, segmentIndex, results);
        }
        return;
    }
    const matcher = createGlobSegmentMatcher(segment);
    for (const entry of readDirectoryEntries(currentPath)) {
        if (!entry.isDirectory() || shouldSkipDirectory(entry.name) || !matcher(entry.name)) {
            continue;
        }
        expandGlobSegments(rootPath, path.join(currentPath, entry.name), segments, segmentIndex + 1, results);
    }
}
function createGlobSegmentMatcher(segment) {
    if (!segment.includes('*')) {
        return (value) => value === segment;
    }
    const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`);
    return (value) => regex.test(value);
}
function readDirectoryEntries(dirPath) {
    try {
        return fs.readdirSync(dirPath, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
function isExistingDirectory(dirPath) {
    try {
        return fs.statSync(dirPath).isDirectory();
    }
    catch {
        return false;
    }
}
function shouldSkipDirectory(name) {
    return name.startsWith('.') || ignoredDirNames.has(name);
}
function collectPackageJsonDirs(rootPath) {
    const dirs = [];
    function walk(currentPath) {
        const base = path.basename(currentPath);
        if (ignoredDirNames.has(base)) {
            return;
        }
        const packageJsonPath = path.join(currentPath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            dirs.push(currentPath);
        }
        let entries = [];
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) {
                continue;
            }
            walk(path.join(currentPath, entry.name));
        }
    }
    walk(rootPath);
    return [...new Set(dirs)].sort();
}
function readWorkspace(dirPath, rootPath) {
    const pkgPath = path.join(dirPath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        return null;
    }
    try {
        const pkgRaw = fs.readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(pkgRaw);
        const name = pkg.name || path.relative(rootPath, dirPath) || path.basename(dirPath);
        const scriptsObj = pkg.scripts || {};
        const scriptPositions = findScriptPositions(pkgRaw);
        const scripts = Object.entries(scriptsObj).map(([scriptName, command]) => ({
            name: scriptName,
            command: command,
            workspaceName: name,
            workspacePath: dirPath,
            scriptLine: scriptPositions.get(scriptName)?.line,
            scriptColumn: scriptPositions.get(scriptName)?.column,
        }));
        if (scripts.length === 0) {
            return null;
        }
        return { name, path: dirPath, scripts };
    }
    catch {
        return null;
    }
}
function findScriptPositions(pkgRaw) {
    const positions = new Map();
    const range = getScriptsObjectRange(pkgRaw);
    if (!range) {
        return positions;
    }
    const beforeScripts = pkgRaw.slice(0, range.start);
    const baseLine = beforeScripts.split('\n').length - 1;
    const scriptsBody = pkgRaw.slice(range.start, range.end + 1);
    const lines = scriptsBody.split('\n');
    const scriptLinePattern = /^(\s*)"((?:\\.|[^"\\])+)":\s*/;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = scriptLinePattern.exec(line);
        if (!match) {
            continue;
        }
        const key = match[2].replace(/\\"/g, '"');
        const indentLength = match[1]?.length ?? 0;
        positions.set(key, { line: baseLine + i, column: indentLength });
    }
    return positions;
}
function getScriptsObjectRange(input) {
    const scriptsKeyPattern = /"scripts"\s*:/g;
    const keyMatch = scriptsKeyPattern.exec(input);
    if (!keyMatch) {
        return undefined;
    }
    let objectStart = -1;
    for (let i = scriptsKeyPattern.lastIndex; i < input.length; i++) {
        if (input[i] === '{') {
            objectStart = i;
            break;
        }
        if (!/\s/.test(input[i])) {
            return undefined;
        }
    }
    if (objectStart < 0) {
        return undefined;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = objectStart; i < input.length; i++) {
        const ch = input[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            }
            else if (ch === '\\') {
                escaped = true;
            }
            else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            depth += 1;
            continue;
        }
        if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return { start: objectStart, end: i };
            }
        }
    }
    return undefined;
}
//# sourceMappingURL=workspaceScanner.js.map