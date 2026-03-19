import * as fs from 'fs';
import * as path from 'path';

export function detectGitWorktree(workspacePath: string): boolean {
  try {
    const dotGitPath = path.join(workspacePath, '.git');
    const dotGitStats = fs.statSync(dotGitPath);
    if (!dotGitStats.isFile()) {
      return false;
    }
    const dotGitContent = fs.readFileSync(dotGitPath, 'utf8');
    const gitDirLine = dotGitContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().startsWith('gitdir:'));
    if (!gitDirLine) {
      return false;
    }
    const gitDirValue = gitDirLine.slice('gitdir:'.length).trim();
    if (!gitDirValue) {
      return false;
    }
    const resolvedGitDir = path.resolve(workspacePath, gitDirValue);
    const normalizedGitDir = resolvedGitDir.replace(/\\/g, '/').toLowerCase();
    return normalizedGitDir.includes('/worktrees/');
  } catch {
    return false;
  }
}

export function getRepositoryIdentity(workspacePath: string): string {
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
      return fs.realpathSync(path.dirname(path.dirname(resolvedGitDir)));
    }
    return fs.realpathSync(resolvedGitDir);
  } catch {
    return workspacePath;
  }
}
