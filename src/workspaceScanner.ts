import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceInfo, ScriptInfo } from './types';

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

export function detectPackageManager(rootPath: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf-8'));
    if (typeof pkg.packageManager === 'string') {
      const match = pkg.packageManager.match(/^(pnpm|npm|yarn|bun)/);
      if (match) { return match[1]; }
    }
  } catch { /* ignore */ }

  if (fs.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) { return 'pnpm'; }
  if (fs.existsSync(path.join(rootPath, 'yarn.lock'))) { return 'yarn'; }
  if (fs.existsSync(path.join(rootPath, 'bun.lockb'))) { return 'bun'; }
  return 'npm';
}

export function scanWorkspaces(rootPath: string): WorkspaceInfo[] {
  const globs = resolveWorkspaceGlobs(rootPath);

  const configuredDirs = globs.length > 0 ? expandGlobs(rootPath, globs) : [];
  const dirs = configuredDirs.length > 0 ? configuredDirs : collectPackageJsonDirs(rootPath);

  const workspaces: WorkspaceInfo[] = [];

  // Root workspace first
  const rootInfo = readWorkspace(rootPath, rootPath);
  if (rootInfo) { workspaces.push(rootInfo); }

  for (const dir of dirs) {
    if (dir === rootPath) { continue; }
    const info = readWorkspace(dir, rootPath);
    if (info) { workspaces.push(info); }
  }

  // Final safety net: if workspace rules produced nothing usable, still list scripts.
  if (workspaces.length === 0) {
    const fallbackDirs = collectPackageJsonDirs(rootPath);
    for (const dir of fallbackDirs) {
      const info = readWorkspace(dir, rootPath);
      if (info) { workspaces.push(info); }
    }
  }

  return workspaces;
}

export function scanWorkspaceFolders(rootPaths: string[]): WorkspaceInfo[] {
  const merged: WorkspaceInfo[] = [];
  const seenPaths = new Set<string>();

  for (const rootPath of rootPaths) {
    const workspaces = scanWorkspaces(rootPath);
    for (const workspace of workspaces) {
      if (seenPaths.has(workspace.path)) { continue; }
      seenPaths.add(workspace.path);
      merged.push(workspace);
    }
  }

  return merged;
}

/** Resolves workspace glob patterns from pnpm-workspace.yaml or package.json workspaces field. */
function resolveWorkspaceGlobs(rootPath: string): string[] {
  // 1. pnpm-workspace.yaml
  const yamlPath = path.join(rootPath, 'pnpm-workspace.yaml');
  if (fs.existsSync(yamlPath)) {
    try {
      const content = fs.readFileSync(yamlPath, 'utf-8');
      const globs = parsePnpmWorkspaceYaml(content);
      if (globs.length > 0) { return globs; }
    } catch { /* ignore */ }
  }

  // 2. package.json workspaces field (npm / yarn)
  const pkgPath = path.join(rootPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      let workspacesField: unknown = pkg.workspaces;

      // yarn uses { packages: [...] } shape
      if (workspacesField && typeof workspacesField === 'object' && !Array.isArray(workspacesField)) {
        const asObj = workspacesField as Record<string, unknown>;
        if (Array.isArray(asObj.packages)) {
          workspacesField = asObj.packages;
        }
      }

      if (Array.isArray(workspacesField)) {
        const globs = (workspacesField as string[]).map((g) => g.replace(/^\.\//, ''));
        if (globs.length > 0) { return globs; }
      }
    } catch { /* ignore */ }
  }

  return [];
}

function parsePnpmWorkspaceYaml(yaml: string): string[] {
  const globs: string[] = [];
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
        if (glob && !glob.startsWith('!')) { globs.push(glob); }
      } else if (trimmed !== '' && !trimmed.startsWith('#')) {
        break;
      }
    }
  }

  return globs;
}

function expandGlobs(rootPath: string, globs: string[]): string[] {
  const dirs: string[] = [];

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

function expandGlobSegments(
  rootPath: string,
  currentPath: string,
  segments: string[],
  segmentIndex: number,
  results: string[]
): void {
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

function createGlobSegmentMatcher(segment: string): (value: string) => boolean {
  if (!segment.includes('*')) {
    return (value: string) => value === segment;
  }
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  return (value: string) => regex.test(value);
}

function readDirectoryEntries(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isExistingDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function shouldSkipDirectory(name: string): boolean {
  return name.startsWith('.') || ignoredDirNames.has(name);
}

function collectPackageJsonDirs(rootPath: string): string[] {
  const dirs: string[] = [];

  function walk(currentPath: string): void {
    const base = path.basename(currentPath);
    if (ignoredDirNames.has(base)) { return; }

    const packageJsonPath = path.join(currentPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      dirs.push(currentPath);
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
      walk(path.join(currentPath, entry.name));
    }
  }

  walk(rootPath);
  return [...new Set(dirs)].sort();
}

function readWorkspace(dirPath: string, rootPath: string): WorkspaceInfo | null {
  const pkgPath = path.join(dirPath, 'package.json');
  if (!fs.existsSync(pkgPath)) { return null; }

  try {
    const pkgRaw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    const name: string = pkg.name || path.relative(rootPath, dirPath) || path.basename(dirPath);
    const scriptsObj: Record<string, string> = pkg.scripts || {};
    const scriptPositions = findScriptPositions(pkgRaw);
    const scripts: ScriptInfo[] = Object.entries(scriptsObj).map(([scriptName, command]) => ({
      name: scriptName,
      command: command as string,
      workspaceName: name,
      workspacePath: dirPath,
      scriptLine: scriptPositions.get(scriptName)?.line,
      scriptColumn: scriptPositions.get(scriptName)?.column,
    }));

    if (scripts.length === 0) { return null; }

    return { name, path: dirPath, scripts };
  } catch {
    return null;
  }
}

function findScriptPositions(pkgRaw: string): Map<string, { line: number; column: number }> {
  const positions = new Map<string, { line: number; column: number }>();
  const range = getScriptsObjectRange(pkgRaw);
  if (!range) { return positions; }

  const beforeScripts = pkgRaw.slice(0, range.start);
  const baseLine = beforeScripts.split('\n').length - 1;
  const scriptsBody = pkgRaw.slice(range.start, range.end + 1);
  const lines = scriptsBody.split('\n');
  const scriptLinePattern = /^(\s*)"((?:\\.|[^"\\])+)":\s*/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = scriptLinePattern.exec(line);
    if (!match) { continue; }

    const key = match[2].replace(/\\"/g, '"');
    const indentLength = match[1]?.length ?? 0;
    positions.set(key, { line: baseLine + i, column: indentLength });
  }

  return positions;
}

function getScriptsObjectRange(input: string): { start: number; end: number } | undefined {
  const scriptsKeyPattern = /"scripts"\s*:/g;
  const keyMatch = scriptsKeyPattern.exec(input);
  if (!keyMatch) { return undefined; }

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
  if (objectStart < 0) { return undefined; }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = objectStart; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
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
