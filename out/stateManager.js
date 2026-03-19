"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStateManager = createStateManager;
const LEGACY_FAVORITES_KEY = 'latooScripts.favorites';
const FAVORITES_KEY_PREFIX = 'latooScripts.favorites.';
const FAVORITES_SECTION_ORDER_KEY_PREFIX = 'latooScripts.favoritesSectionOrder.';
const TAB_ORDER_KEY = 'latooScripts.tabOrder';
const CUSTOM_FAVORITES_KEY_PREFIX = 'latooScripts.customFavoriteCommands.';
function createStateManager(workspaceState, globalState) {
    let favoritesScopeId = 'default';
    function getFavoritesKey() {
        return `${FAVORITES_KEY_PREFIX}${favoritesScopeId}`;
    }
    function getFavoritesSectionOrderKey() {
        return `${FAVORITES_SECTION_ORDER_KEY_PREFIX}${favoritesScopeId}`;
    }
    function getCustomFavoritesKey() {
        return `${CUSTOM_FAVORITES_KEY_PREFIX}${favoritesScopeId}`;
    }
    function normalizeCustomFavoriteEntries(entries) {
        if (!Array.isArray(entries)) {
            return [];
        }
        const result = [];
        const seen = new Set();
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            const name = typeof Reflect.get(entry, 'name') === 'string' ? Reflect.get(entry, 'name').trim() : '';
            const command = typeof Reflect.get(entry, 'command') === 'string' ? Reflect.get(entry, 'command').trim() : '';
            if (name.length === 0 || command.length === 0) {
                continue;
            }
            if (seen.has(name)) {
                continue;
            }
            seen.add(name);
            const iconId = typeof Reflect.get(entry, 'iconId') === 'string' ? Reflect.get(entry, 'iconId').trim() : '';
            result.push({ name, command, iconId: iconId.length > 0 ? iconId : undefined });
        }
        return result;
    }
    function normalizeFavoriteEntries(entries) {
        if (!Array.isArray(entries)) {
            return [];
        }
        const result = [];
        const seen = new Set();
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            const scriptNameValue = Reflect.get(entry, 'scriptName');
            if (typeof scriptNameValue !== 'string' || scriptNameValue.length === 0) {
                continue;
            }
            const workspacePathValue = Reflect.get(entry, 'workspacePath');
            const workspaceNameValue = Reflect.get(entry, 'workspaceName');
            const workspacePath = typeof workspacePathValue === 'string' ? workspacePathValue : '';
            const workspaceName = typeof workspaceNameValue === 'string' ? workspaceNameValue : undefined;
            // Legacy entries can have workspaceName without workspacePath.
            if (workspacePath.length === 0 && !workspaceName) {
                continue;
            }
            const keyScope = workspacePath.length > 0 ? workspacePath : `legacy:${workspaceName ?? ''}`;
            const key = `${keyScope}::${scriptNameValue}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            result.push({
                workspacePath,
                workspaceName,
                scriptName: scriptNameValue,
            });
        }
        return result;
    }
    function getGlobalFavoritesState() {
        const stored = globalState.get(getFavoritesKey());
        if (stored === undefined) {
            return { initialized: false, favorites: [] };
        }
        return {
            initialized: true,
            favorites: normalizeFavoriteEntries(stored),
        };
    }
    return {
        setFavoritesScope(scopeId) {
            favoritesScopeId = scopeId.trim().length > 0 ? scopeId : 'default';
        },
        getFavorites() {
            const globalFavoritesState = getGlobalFavoritesState();
            if (globalFavoritesState.initialized) {
                return globalFavoritesState.favorites;
            }
            // Legacy migration path from workspace-scoped favorites.
            const legacyFavorites = normalizeFavoriteEntries(workspaceState.get(LEGACY_FAVORITES_KEY, []));
            if (legacyFavorites.length > 0) {
                globalState.update(getFavoritesKey(), legacyFavorites);
            }
            return legacyFavorites;
        },
        setFavorites(favorites) {
            const normalized = normalizeFavoriteEntries(favorites);
            globalState.update(getFavoritesKey(), normalized);
        },
        toggleFavorite(workspacePath, scriptName, workspaceName) {
            const favorites = this.getFavorites();
            const normalizedWorkspacePath = workspacePath.trim();
            const idx = favorites.findIndex((f) => f.workspacePath === normalizedWorkspacePath && f.scriptName === scriptName);
            if (idx >= 0) {
                favorites.splice(idx, 1);
            }
            else {
                favorites.push({
                    workspacePath: normalizedWorkspacePath,
                    workspaceName,
                    scriptName,
                });
            }
            globalState.update(getFavoritesKey(), favorites);
            return favorites;
        },
        getFavoritesSectionOrder() {
            return globalState.get(getFavoritesSectionOrderKey(), []);
        },
        setFavoritesSectionOrder(order) {
            globalState.update(getFavoritesSectionOrderKey(), order);
        },
        getTabOrder() {
            return workspaceState.get(TAB_ORDER_KEY, []);
        },
        setTabOrder(order) {
            workspaceState.update(TAB_ORDER_KEY, order);
        },
        getCustomFavoriteCommands() {
            return normalizeCustomFavoriteEntries(globalState.get(getCustomFavoritesKey(), []));
        },
        setCustomFavoriteCommands(entries) {
            const normalized = normalizeCustomFavoriteEntries(entries);
            globalState.update(getCustomFavoritesKey(), normalized);
        },
    };
}
//# sourceMappingURL=stateManager.js.map