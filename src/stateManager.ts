import * as vscode from 'vscode';
import { FavoriteEntry, StateManager } from './types';

const LEGACY_FAVORITES_KEY = 'latooScripts.favorites';
const FAVORITES_KEY_PREFIX = 'latooScripts.favorites.';
const FAVORITES_SECTION_ORDER_KEY_PREFIX = 'latooScripts.favoritesSectionOrder.';
const TAB_ORDER_KEY = 'latooScripts.tabOrder';

export function createStateManager(
  workspaceState: vscode.Memento,
  globalState: vscode.Memento
): StateManager {
  let favoritesScopeId = 'default';

  function getFavoritesKey(): string {
    return `${FAVORITES_KEY_PREFIX}${favoritesScopeId}`;
  }

  function getFavoritesSectionOrderKey(): string {
    return `${FAVORITES_SECTION_ORDER_KEY_PREFIX}${favoritesScopeId}`;
  }

  function normalizeFavoriteEntries(entries: unknown): FavoriteEntry[] {
    if (!Array.isArray(entries)) { return []; }

    const result: FavoriteEntry[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') { continue; }

      const scriptNameValue = Reflect.get(entry, 'scriptName');
      if (typeof scriptNameValue !== 'string' || scriptNameValue.length === 0) { continue; }

      const workspacePathValue = Reflect.get(entry, 'workspacePath');
      const workspaceNameValue = Reflect.get(entry, 'workspaceName');
      const workspacePath = typeof workspacePathValue === 'string' ? workspacePathValue : '';
      const workspaceName = typeof workspaceNameValue === 'string' ? workspaceNameValue : undefined;

      // Legacy entries can have workspaceName without workspacePath.
      if (workspacePath.length === 0 && !workspaceName) { continue; }

      const keyScope = workspacePath.length > 0 ? workspacePath : `legacy:${workspaceName ?? ''}`;
      const key = `${keyScope}::${scriptNameValue}`;
      if (seen.has(key)) { continue; }
      seen.add(key);

      result.push({
        workspacePath,
        workspaceName,
        scriptName: scriptNameValue,
      });
    }

    return result;
  }

  function getGlobalFavoritesState(): { initialized: boolean; favorites: FavoriteEntry[] } {
    const stored = globalState.get<unknown>(getFavoritesKey());
    if (stored === undefined) {
      return { initialized: false, favorites: [] };
    }
    return {
      initialized: true,
      favorites: normalizeFavoriteEntries(stored),
    };
  }

  return {
    setFavoritesScope(scopeId: string): void {
      favoritesScopeId = scopeId.trim().length > 0 ? scopeId : 'default';
    },

    getFavorites(): FavoriteEntry[] {
      const globalFavoritesState = getGlobalFavoritesState();
      if (globalFavoritesState.initialized) {
        return globalFavoritesState.favorites;
      }

      // Legacy migration path from workspace-scoped favorites.
      const legacyFavorites = normalizeFavoriteEntries(
        workspaceState.get<unknown>(LEGACY_FAVORITES_KEY, [])
      );
      if (legacyFavorites.length > 0) {
        globalState.update(getFavoritesKey(), legacyFavorites);
      }
      return legacyFavorites;
    },

    setFavorites(favorites: FavoriteEntry[]): void {
      const normalized = normalizeFavoriteEntries(favorites);
      globalState.update(getFavoritesKey(), normalized);
    },

    toggleFavorite(workspacePath: string, scriptName: string, workspaceName?: string): FavoriteEntry[] {
      const favorites = this.getFavorites();
      const normalizedWorkspacePath = workspacePath.trim();
      const idx = favorites.findIndex(
        (f) => f.workspacePath === normalizedWorkspacePath && f.scriptName === scriptName
      );

      if (idx >= 0) {
        favorites.splice(idx, 1);
      } else {
        favorites.push({
          workspacePath: normalizedWorkspacePath,
          workspaceName,
          scriptName,
        });
      }

      globalState.update(getFavoritesKey(), favorites);
      return favorites;
    },

    getFavoritesSectionOrder(): string[] {
      return globalState.get<string[]>(getFavoritesSectionOrderKey(), []);
    },

    setFavoritesSectionOrder(order: string[]): void {
      globalState.update(getFavoritesSectionOrderKey(), order);
    },

    getTabOrder(): string[] {
      return workspaceState.get<string[]>(TAB_ORDER_KEY, []);
    },

    setTabOrder(order: string[]): void {
      workspaceState.update(TAB_ORDER_KEY, order);
    },
  };
}
