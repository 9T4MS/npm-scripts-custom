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
exports.detectGitWorktree = detectGitWorktree;
exports.getRepositoryIdentity = getRepositoryIdentity;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function detectGitWorktree(workspacePath) {
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
    }
    catch {
        return false;
    }
}
function getRepositoryIdentity(workspacePath) {
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
    }
    catch {
        return workspacePath;
    }
}
//# sourceMappingURL=gitUtils.js.map