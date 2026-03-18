// @ts-check

/** @type {{ postMessage: (message: unknown) => void, setState: (state: unknown) => void, getState: () => unknown }} */
// @ts-ignore -- provided by VS Code webview runtime
const vscode = acquireVsCodeApi();

/** @type {{ workspaces: any[], favorites: any[], tabOrder: string[], favoritesSectionOrder: string[], packageManager: string, envName: string, isEnvNameAuto: boolean, isEnvNameEnabled: boolean, primaryRunLocation: 'panel' | 'editor', primaryClickTarget: 'internal' | 'external', actionVisibility: { openScript: boolean, runSecondary: boolean, runExternal: boolean, openExternalTabCopyCommand: boolean, favorite: boolean }, scriptFeatureFilters: { envName: { includeScripts: string[], excludeScripts: string[] }, internalRun: { includeScripts: string[], excludeScripts: string[] }, persistentTerminal: { includeScripts: string[], excludeScripts: string[] } }, internalRunLocationOverrides: Record<string, 'panel' | 'editor'>, internalRunAlwaysNewOverrides: Record<string, boolean>, customFavoriteEntries?: Array<{ workspacePath: string, workspaceName: string, scriptName: string, scriptCommand: string, iconId?: string }> }} */
let state = {
  workspaces: [],
  favorites: [],
  tabOrder: [],
  favoritesSectionOrder: [],
  packageManager: 'pnpm',
  envName: 'local-0',
  isEnvNameAuto: false,
  isEnvNameEnabled: true,
  primaryRunLocation: 'panel',
  primaryClickTarget: 'internal',
  actionVisibility: {
    openScript: true,
    runSecondary: true,
    runExternal: true,
    openExternalTabCopyCommand: true,
    favorite: true,
  },
  scriptFeatureFilters: {
    envName: { includeScripts: ['*'], excludeScripts: [] },
    internalRun: { includeScripts: ['*'], excludeScripts: [] },
    persistentTerminal: { includeScripts: ['*'], excludeScripts: [] },
  },
  internalRunLocationOverrides: {},
  internalRunAlwaysNewOverrides: {},
  customFavoriteEntries: [],
};

const FAVORITES_TAB_KEY = '__favorites__';

/** @type {string} */
let activeTab = FAVORITES_TAB_KEY;

const toolbarEl = /** @type {HTMLElement} */ (document.getElementById('toolbar'));
const tabBar = /** @type {HTMLElement} */ (document.getElementById('tab-bar'));
const content = /** @type {HTMLElement} */ (document.getElementById('content'));

/** @type {string | undefined} */
let activeDraggedFavoritesSection;
/** @type {HTMLElement | undefined} */
let contextMenuEl;
/** @type {number | undefined} */
let toastTimer;

// Listen for messages from the extension
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'updateData') {
    state = msg;
    render();
  }
});

// Tell extension we're ready
vscode.postMessage({ type: 'ready' });
setupTabBarInteractions();
document.addEventListener('click', () => {
  closeContextMenu();
});
window.addEventListener('blur', () => {
  closeContextMenu();
});

// --- Rendering ---

function render() {
  closeContextMenu();
  renderToolbar();
  renderTabs();
  renderContent();
}

function renderToolbar() {
  toolbarEl.hidden = true;
}

function getTabNames() {
  const names = [FAVORITES_TAB_KEY, ...state.workspaces.map((w) => w.name)];
  // Apply saved tab order
  if (state.tabOrder.length > 0) {
    const ordered = [];
    for (const name of state.tabOrder) {
      const normalizedName = normalizeTabKey(name);
      if (names.includes(normalizedName)) { ordered.push(normalizedName); }
    }
    // Append any new tabs not in saved order
    for (const name of names) {
      if (!ordered.includes(name)) { ordered.push(name); }
    }
    return ordered;
  }
  return names;
}

/**
 * @param {string} tabName
 * @returns {string}
 */
function normalizeTabKey(tabName) {
  if (tabName === '★ Favorites') {
    return FAVORITES_TAB_KEY;
  }
  return tabName;
}

function renderTabs() {
  const tabs = getTabNames();
  if (!tabs.includes(activeTab)) {
    activeTab = tabs[0] ?? FAVORITES_TAB_KEY;
  }
  tabBar.innerHTML = '';

  for (const name of tabs) {
    const tab = document.createElement('div');
    tab.className = 'tab draggable' + (name === activeTab ? ' active' : '');
    tab.textContent = name === FAVORITES_TAB_KEY ? '★' : name;
    tab.title = name === FAVORITES_TAB_KEY ? 'Favorites' : name;
    tab.draggable = true;
    tab.dataset.name = name;

    tab.addEventListener('click', () => {
      activeTab = name;
      render();
    });

    // Drag-to-reorder
    tab.addEventListener('dragstart', (e) => {
      tab.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', name);
        e.dataTransfer.effectAllowed = 'move';
      }
    });

    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
    });

    tab.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) { e.dataTransfer.dropEffect = 'move'; }
      tab.classList.add('drag-over');
    });

    tab.addEventListener('dragleave', () => {
      tab.classList.remove('drag-over');
    });

    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      tab.classList.remove('drag-over');
      const draggedName = e.dataTransfer?.getData('text/plain');
      if (!draggedName || draggedName === name) { return; }

      const order = getTabNames();
      const fromIdx = order.indexOf(draggedName);
      const toIdx = order.indexOf(name);
      if (fromIdx < 0 || toIdx < 0) { return; }

      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, draggedName);

      state.tabOrder = order;
      vscode.postMessage({ type: 'reorderTabs', tabOrder: order });
      render();
    });

    tabBar.appendChild(tab);
  }
}

function setupTabBarInteractions() {
  tabBar.addEventListener('wheel', (e) => {
    const maxScrollLeft = tabBar.scrollWidth - tabBar.clientWidth;
    if (maxScrollLeft <= 0) {
      return;
    }

    const hasHorizontalIntent = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const scrollDelta = hasHorizontalIntent ? e.deltaX : e.deltaY;
    if (scrollDelta === 0) {
      return;
    }

    const nextScrollLeft = tabBar.scrollLeft + scrollDelta;
    const canScrollLeft = scrollDelta < 0 && tabBar.scrollLeft > 0;
    const canScrollRight = scrollDelta > 0 && tabBar.scrollLeft < maxScrollLeft;
    const canScrollInDirection = canScrollLeft || canScrollRight;
    if (!canScrollInDirection) {
      return;
    }

    e.preventDefault();
    tabBar.scrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft));
  }, { passive: false });
}

function renderContent() {
  content.innerHTML = '';

  if (activeTab === FAVORITES_TAB_KEY) {
    renderFavorites();
  } else {
    const ws = state.workspaces.find((w) => w.name === activeTab);
    if (ws) {
      for (const script of ws.scripts) {
        content.appendChild(createScriptRow(script, ws));
      }
    }
  }
}

function renderFavorites() {
  const customFavoriteScripts = getCustomFavoriteScripts();
  if (state.favorites.length === 0 && customFavoriteScripts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No favorites yet. Click the star icon to add scripts.';
    content.appendChild(empty);
    return;
  }

  for (let i = 0; i < customFavoriteScripts.length; i++) {
    const customFavoriteScript = customFavoriteScripts[i];
    const customRow = createScriptRow(customFavoriteScript.script, customFavoriteScript.ws);
    customRow.classList.add('custom-favorite-row');
    if (i === 0) {
      customRow.classList.add('custom-favorite-row--first');
    }
    content.appendChild(customRow);
  }

  // Group favorites by workspace path.
  /** @type {Map<string, { ws: any, items: any[] }>} */
  const groups = new Map();
  for (const fav of state.favorites) {
    const ws = state.workspaces.find(
      (w) => w.path === fav.workspacePath || (fav.workspaceName && w.name === fav.workspaceName)
    );
    if (!ws) { continue; }
    const script = ws.scripts.find((/** @type {any} */ s) => s.name === fav.scriptName);
    if (!script) { continue; }
    if (!groups.has(ws.path)) {
      groups.set(ws.path, { ws, items: [] });
    }
    groups.get(ws.path)?.items.push({ script, ws });
  }

  const sectionKeys = Array.from(groups.keys());
  const orderedSectionKeys = normalizeOrder(state.favoritesSectionOrder, sectionKeys);
  for (const sectionKey of orderedSectionKeys) {
    const group = groups.get(sectionKey);
    if (!group) { continue; }

    const header = createFavoritesSectionHeader(sectionKey, group.ws.name, orderedSectionKeys);
    content.appendChild(header);

    for (const { script, ws } of group.items) {
      content.appendChild(createScriptRow(script, ws));
    }
  }
}

/**
 * @param {string[]} currentOrder
 * @param {string[]} availableItems
 * @returns {string[]}
 */
function normalizeOrder(currentOrder, availableItems) {
  const ordered = [];
  for (const item of currentOrder) {
    if (availableItems.includes(item)) {
      ordered.push(item);
    }
  }
  for (const item of availableItems) {
    if (!ordered.includes(item)) {
      ordered.push(item);
    }
  }
  return ordered;
}

/**
 * @param {string[]} order
 */
function setFavoritesSectionOrder(order) {
  state.favoritesSectionOrder = order;
  vscode.postMessage({ type: 'reorderFavoritesSections', favoritesSectionOrder: order });
}

/**
 * @param {string} sectionKey
 * @param {string} sectionName
 * @param {string[]} currentOrder
 * @returns {HTMLElement}
 */
function createFavoritesSectionHeader(sectionKey, sectionName, currentOrder) {
  const header = document.createElement('div');
  header.className = 'section-header draggable';
  header.draggable = true;
  header.tabIndex = 0;
  header.dataset.sectionKey = sectionKey;
  header.title = 'Drag to reorder favorites sections. Use Alt+ArrowUp/Alt+ArrowDown to reorder with keyboard.';

  const name = document.createElement('span');
  name.className = 'section-header-name';
  name.textContent = sectionName;

  const handle = document.createElement('span');
  handle.className = 'section-header-handle';
  handle.textContent = '⋮⋮';
  handle.setAttribute('aria-hidden', 'true');

  const quickActions = document.createElement('div');
  quickActions.className = 'section-header-quick-actions';

  const jumpToTab = document.createElement('button');
  jumpToTab.className = 'icon-btn section-header-action action-jump-tab';
  jumpToTab.innerHTML = getActionIconSvg('jumpToTab');
  jumpToTab.type = 'button';
  jumpToTab.title = `Go to ${sectionName} tab`;
  jumpToTab.setAttribute('aria-label', `Go to ${sectionName} tab`);
  jumpToTab.addEventListener('click', (e) => {
    e.stopPropagation();
    activeTab = sectionName;
    render();
  });
  jumpToTab.addEventListener('dragstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  const openWorkspaceScripts = document.createElement('button');
  openWorkspaceScripts.className = 'icon-btn section-header-action action-open-workspace-scripts';
  openWorkspaceScripts.innerHTML = getActionIconSvg('openScript');
  openWorkspaceScripts.type = 'button';
  openWorkspaceScripts.title = `Open ${sectionName} package.json scripts`;
  openWorkspaceScripts.setAttribute('aria-label', `Open ${sectionName} package.json scripts`);
  openWorkspaceScripts.addEventListener('click', (e) => {
    e.stopPropagation();
    vscode.postMessage({
      type: 'openWorkspaceScriptsInPackageJson',
      workspacePath: sectionKey,
      workspaceName: sectionName,
    });
  });
  openWorkspaceScripts.addEventListener('dragstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  header.appendChild(name);
  quickActions.appendChild(openWorkspaceScripts);
  quickActions.appendChild(jumpToTab);
  const spacer = document.createElement('span');
  spacer.className = 'section-header-spacer';
  header.appendChild(quickActions);
  header.appendChild(spacer);
  header.appendChild(handle);

  header.addEventListener('dragstart', (e) => {
    activeDraggedFavoritesSection = sectionKey;
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', sectionKey);
      e.dataTransfer.effectAllowed = 'move';
    }
  });

  header.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) { e.dataTransfer.dropEffect = 'move'; }
    header.classList.add('drag-over');
  });

  header.addEventListener('dragleave', () => {
    header.classList.remove('drag-over');
  });

  header.addEventListener('drop', (e) => {
    e.preventDefault();
    header.classList.remove('drag-over');
    const draggedSection = e.dataTransfer?.getData('text/plain') || activeDraggedFavoritesSection;
    if (!draggedSection || draggedSection === sectionKey) { return; }
    reorderFavoritesSections(draggedSection, sectionKey);
  });

  header.addEventListener('dragend', () => {
    activeDraggedFavoritesSection = undefined;
  });

  header.addEventListener('keydown', (e) => {
    if (!e.altKey) { return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') { return; }
    e.preventDefault();

    const fromIdx = currentOrder.indexOf(sectionKey);
    if (fromIdx < 0) { return; }
    const toIdx = e.key === 'ArrowUp' ? fromIdx - 1 : fromIdx + 1;
    if (toIdx < 0 || toIdx >= currentOrder.length) { return; }

    const nextOrder = [...currentOrder];
    nextOrder.splice(fromIdx, 1);
    nextOrder.splice(toIdx, 0, sectionKey);
    setFavoritesSectionOrder(nextOrder);
    render();
  });

  return header;
}

/**
 * @param {string} fromKey
 * @param {string} toKey
 */
function reorderFavoritesSections(fromKey, toKey) {
  const order = normalizeOrder(state.favoritesSectionOrder, getFavoritesSectionKeys());
  const fromIdx = order.indexOf(fromKey);
  const toIdx = order.indexOf(toKey);
  if (fromIdx < 0 || toIdx < 0) { return; }

  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, fromKey);
  setFavoritesSectionOrder(order);
  render();
}

/**
 * @returns {string[]}
 */
function getFavoritesSectionKeys() {
  const sections = [];
  for (const fav of state.favorites) {
    const ws = state.workspaces.find(
      (w) => w.path === fav.workspacePath || (fav.workspaceName && w.name === fav.workspaceName)
    );
    if (!ws) { continue; }
    if (!sections.includes(ws.path)) {
      sections.push(ws.path);
    }
  }
  return sections;
}

/**
 * @param {string} scriptName
 * @param {string} scriptCommand
 * @returns {{ id: string, label: string }}
 */
function getScriptIcon(scriptName, scriptCommand) {
  const normalizedScriptName = scriptName.toLowerCase();
  const normalizedScriptCommand = scriptCommand.toLowerCase();

  for (const rule of SCRIPT_ICON_RULES) {
    if (
      matchesAny(normalizedScriptName, rule.namePatterns) ||
      matchesAny(normalizedScriptCommand, rule.commandPatterns)
    ) {
      return { id: rule.id, label: rule.label };
    }
  }

  const packageManagerIcon = getPackageManagerFallbackIcon();
  if (packageManagerIcon) {
    return packageManagerIcon;
  }

  return { id: 'script', label: 'Script' };
}

/**
 * @param {string} scriptName
 * @param {string} scriptCommand
 * @returns {{ id: string, label: string, className: string }}
 */
function getScriptIconMeta(scriptName, scriptCommand, customIconId) {
  if (customIconId && customIconId.trim().length > 0) {
    const customId = customIconId.trim().toLowerCase();
    return {
      id: customId,
      label: customIconId.trim(),
      className: `script-icon--${customId}`,
    };
  }
  const selected = getScriptIcon(scriptName, scriptCommand);
  const candidates = [
    { id: 'docker', className: 'script-icon--docker' },
    { id: 'playwright', className: 'script-icon--playwright' },
    { id: 'storybook', className: 'script-icon--storybook' },
    { id: 'graphql', className: 'script-icon--graphql' },
    { id: 'expo', className: 'script-icon--expo' },
    { id: 'eas', className: 'script-icon--eas' },
    { id: 'tailwind', className: 'script-icon--tailwind' },
    { id: 'deploy', className: 'script-icon--deploy' },
    { id: 'watch', className: 'script-icon--watch' },
    { id: 'preview', className: 'script-icon--preview' },
    { id: 'database', className: 'script-icon--database' },
    { id: 'nest', className: 'script-icon--nest' },
    { id: 'shell', className: 'script-icon--shell' },
    { id: 'clean', className: 'script-icon--clean' },
    { id: 'i18n', className: 'script-icon--i18n' },
    { id: 'prettier', className: 'script-icon--prettier' },
    { id: 'prisma', className: 'script-icon--prisma' },
    { id: 'eslint', className: 'script-icon--eslint' },
    { id: 'vitest', className: 'script-icon--vitest' },
    { id: 'jest', className: 'script-icon--jest' },
    { id: 'webpack', className: 'script-icon--webpack' },
    { id: 'vite', className: 'script-icon--vite' },
    { id: 'typescript', className: 'script-icon--typescript' },
    { id: 'npm', className: 'script-icon--npm' },
    { id: 'pnpm', className: 'script-icon--pnpm' },
    { id: 'yarn', className: 'script-icon--yarn' },
    { id: 'bun', className: 'script-icon--bun' },
    { id: 'claude-code', className: 'script-icon--claude-code' },
    { id: 'claude', className: 'script-icon--claude' },
    { id: 'script', className: 'script-icon--script' },
  ];

  for (const candidate of candidates) {
    if (candidate.id === selected.id) {
      return {
        id: selected.id,
        label: selected.label,
        className: candidate.className,
      };
    }
  }

  return {
    id: 'script',
    label: 'Script',
    className: 'script-icon--script',
  };
}

/**
 * @returns {Array<{ ws: any, script: any }>}
 */
function getCustomFavoriteScripts() {
  const entries = state.customFavoriteEntries || [];
  const scripts = [];
  for (const entry of entries) {
    if (!entry || !entry.workspacePath || !entry.scriptName || !entry.scriptCommand) {
      continue;
    }
    const workspace = state.workspaces.find((ws) => ws.path === entry.workspacePath);
    const workspaceName = workspace?.name || entry.workspaceName || entry.workspacePath.split('/').pop() || 'workspace';
    scripts.push({
      ws: {
        name: workspaceName,
        path: entry.workspacePath,
      },
      script: {
        name: entry.scriptName,
        command: entry.scriptCommand,
        workspaceName,
        workspacePath: entry.workspacePath,
        isRawCommand: true,
        customIconId: entry.iconId,
      },
    });
  }
  return scripts;
}

/**
 * @param {'openScript' | 'runExternalWindow' | 'openTabCopyCommand' | 'favorite' | 'favoriteActive' | 'runPanel' | 'runEditor' | 'jumpToTab' | 'settings'} iconName
 * @returns {string}
 */
function getActionIconSvg(iconName) {
  switch (iconName) {
    case 'openScript':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8zm0 2.5L17.5 8H14zM7 14h10v2H7zm0-4h10v2H7zm0 8h7v2H7z"/></svg>';
    case 'runExternalWindow':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13 3v2h4.59l-5.3 5.29 1.41 1.42L19 6.41V11h2V3zM5 5h6v2H7v10h10v-4h2v6H5z"/></svg>';
    case 'openTabCopyCommand':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h10v2H4zm0 3h16v13H4zm8 2H6v9h6zm6 2h-4v2h4zm0 3h-4v2h4z"/></svg>';
    case 'runPanel':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 4h18v16H3zm2 2v10h14V6zm0 12h14v-1H5z"/></svg>';
    case 'runEditor':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1m1 2v14h14V5zm2 3h10v2H7zm0 4h6v2H7z"/></svg>';
    case 'jumpToTab':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 5h10v2H4zm0 6h10v2H4zm0 6h10v2H4zm11-8 1.41-1.41L22 13l-5.59 5.41L15 17l3.17-3z"/></svg>';
    case 'settings':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m19.14 12.94.04-.94-.04-.94 2.03-1.58a.5.5 0 0 0 .12-.63l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.23 7.23 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54a7.23 7.23 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.63L4.86 10.7l-.04.94.04.94-2.03 1.58a.5.5 0 0 0-.12.63l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.39 1.05.7 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.24 1.13-.55 1.63-.94l2.39.96c.22.09.48 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.63zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5"/></svg>';
    case 'favoriteActive':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 17.27 6.18 3.73-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
    case 'favorite':
    default:
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m22 9.24-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03zM12 15.4l-3.76 2.27 1-4.28-3.33-2.89 4.38-.38L12 6.1l1.71 4.01 4.38.38-3.33 2.89 1 4.28z"/></svg>';
  }
}

/**
 * @param {string} text
 * @param {string[]} patterns
 * @returns {boolean}
 */
function matchesAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

/**
 * @returns {{ id: string, label: string } | undefined}
 */
function getPackageManagerFallbackIcon() {
  switch (state.packageManager) {
    case 'npm':
      return { id: 'npm', label: 'npm' };
    case 'pnpm':
      return { id: 'pnpm', label: 'pnpm' };
    case 'yarn':
      return { id: 'yarn', label: 'yarn' };
    case 'bun':
      return { id: 'bun', label: 'bun' };
    default:
      return undefined;
  }
}

const SCRIPT_ICON_RULES = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    namePatterns: ['claude-code', 'claudecode'],
    commandPatterns: ['claude-code', 'claudecode'],
  },
  {
    id: 'eslint',
    label: 'Check',
    namePatterns: ['check', 'check:all', 'verify'],
    commandPatterns: ['turbo run check', 'format:check', 'pnpm check', 'npm run check', 'yarn check'],
  },
  { id: 'claude', label: 'Claude', namePatterns: ['claude'], commandPatterns: ['claude'] },
  {
    id: 'docker',
    label: 'Docker',
    namePatterns: ['docker', 'compose'],
    commandPatterns: ['docker', 'compose', 'build-release.sh'],
  },
  {
    id: 'expo',
    label: 'Expo',
    namePatterns: ['expo', 'android', 'ios'],
    commandPatterns: ['expo run:android', 'expo run:ios', 'expo start', 'npx expo'],
  },
  {
    id: 'eas',
    label: 'EAS',
    namePatterns: ['release:local:android', 'release:local:ios', 'release'],
    commandPatterns: ['eas build --local --platform android', 'eas build --local --platform ios', 'eas build --platform all', 'eas build'],
  },
  {
    id: 'nest',
    label: 'NestJS',
    namePatterns: ['nest', 'nestjs', 'start:dev', 'start:debug'],
    commandPatterns: ['nest start', '@nestjs', 'nest build', 'nest-cli'],
  },
  {
    id: 'shell',
    label: 'Shell',
    namePatterns: ['killports', 'kill-ports', 'loadenvs', 'load-envs'],
    commandPatterns: ['sh scripts/', ' sh scripts/', 'clean-monorepo.sh', 'kill-ports.sh', 'load-env-files.sh'],
  },
  {
    id: 'prisma',
    label: 'Prisma',
    namePatterns: ['prisma', 'renovate', 'seed'],
    commandPatterns: ['prisma', 'npx prisma', 'renovate', 'seed'],
  },
  {
    id: 'playwright',
    label: 'Playwright',
    namePatterns: ['playwright', 'cypress', 'e2e'],
    commandPatterns: ['playwright', 'cypress'],
  },
  { id: 'storybook', label: 'Storybook', namePatterns: ['storybook'], commandPatterns: ['storybook', 'sb '] },
  {
    id: 'graphql',
    label: 'GraphQL',
    namePatterns: ['graphql', 'codegen', 'gql'],
    commandPatterns: ['graphql', 'graphql-codegen', 'gql'],
  },
  { id: 'tailwind', label: 'Tailwind', namePatterns: ['tailwind'], commandPatterns: ['tailwind', 'tailwindcss'] },
  { id: 'typescript', label: 'TypeScript', namePatterns: ['typecheck', 'type-check', 'tsc'], commandPatterns: ['tsc'] },
  { id: 'jest', label: 'Jest', namePatterns: ['jest'], commandPatterns: ['jest'] },
  { id: 'vitest', label: 'Vitest', namePatterns: ['vitest', 'test', 'spec'], commandPatterns: ['vitest', 'mocha', 'ava', 'nyc'] },
  { id: 'eslint', label: 'ESLint', namePatterns: ['eslint', 'lint'], commandPatterns: ['eslint', 'stylelint', 'oxlint', 'biome lint'] },
  { id: 'prettier', label: 'Prettier', namePatterns: ['prettier', 'format', 'fmt'], commandPatterns: ['prettier', 'biome format', 'dprint'] },
  {
    id: 'i18n',
    label: 'i18n',
    namePatterns: ['i18n', 'intl', 'translate', 'translations', 'locale'],
    commandPatterns: ['lingui', 'i18next', 'formatjs', 'react-intl'],
  },
  {
    id: 'database',
    label: 'Database',
    namePatterns: ['db', 'database', 'migrate', 'migration', 'seed', 'schema'],
    commandPatterns: ['knex', 'typeorm', 'sequelize', 'migrate'],
  },
  {
    id: 'deploy',
    label: 'Deploy',
    namePatterns: ['deploy', 'release', 'publish', 'ship'],
    commandPatterns: ['deploy', 'serverless', 'cdk', 'pulumi', 'terraform'],
  },
  {
    id: 'webpack',
    label: 'Build',
    namePatterns: ['build', 'compile', 'bundle', 'generate'],
    commandPatterns: ['webpack', 'rollup', 'esbuild', 'vite build', 'next build', 'nuxt build', 'tsup', 'unbuild', 'turbo run build'],
  },
  {
    id: 'clean',
    label: 'Clean',
    namePatterns: ['clean', 'purge', 'clear', 'reset', 'killports', 'kill-ports', 'loadenvs', 'load-envs'],
    commandPatterns: ['rimraf', 'rm -rf', 'del-cli', 'kill-ports', 'load-env-files.sh'],
  },
  { id: 'watch', label: 'Watch', namePatterns: ['watch'], commandPatterns: ['--watch', 'chokidar'] },
  { id: 'preview', label: 'Preview', namePatterns: ['preview'], commandPatterns: ['preview'] },
  {
    id: 'vite',
    label: 'Dev',
    namePatterns: ['dev', 'start', 'serve', 'develop'],
    commandPatterns: ['vite', 'next dev', 'next start', 'nuxt dev', 'nodemon', 'ts-node', 'tsx', 'node '],
  },
];

/**
 * @param {any} script
 * @param {any} ws
 * @returns {HTMLElement}
 */
function createScriptRow(script, ws) {
  const row = document.createElement('div');
  row.className = 'script-row';
  row.tabIndex = 0;

  const isFav = state.favorites.some(
    (f) => f.workspacePath === ws.path && f.scriptName === script.name
  );

  const meta = document.createElement('div');
  meta.className = 'script-meta';

  const iconInfo = getScriptIconMeta(script.name, script.command, script.customIconId);
  const scriptIcon = document.createElement('span');
  scriptIcon.className = `script-icon ${iconInfo.className}`;
  scriptIcon.title = iconInfo.label;
  scriptIcon.setAttribute('aria-label', iconInfo.label);

  const name = document.createElement('span');
  name.className = 'script-name';
  name.textContent = script.name;

  meta.appendChild(scriptIcon);
  meta.appendChild(name);

  const actions = document.createElement('div');
  actions.className = 'script-actions';
  const shouldPinFavoriteAction = isFav && activeTab !== FAVORITES_TAB_KEY;
  if (shouldPinFavoriteAction) {
    row.classList.add('favorite-pinned');
    actions.classList.add('favorite-pinned');
  }
  const actionVisibility = getActionVisibility();

  // Open script in package.json
  const openInPackageJson = document.createElement('button');
  openInPackageJson.className = 'icon-btn action-open-script';
  openInPackageJson.innerHTML = getActionIconSvg('openScript');
  const openScriptTitle = script.isRawCommand
    ? 'Open custom favorite commands in user settings.json'
    : 'Open script in package.json';
  openInPackageJson.title = openScriptTitle;
  openInPackageJson.setAttribute('aria-label', openScriptTitle);
  openInPackageJson.addEventListener('click', (e) => {
    e.stopPropagation();
    if (script.isRawCommand) {
      vscode.postMessage({ type: 'openUserSettingsJson' });
      return;
    }
    vscode.postMessage({
      type: 'openScriptInPackageJson',
      workspacePath: script.workspacePath,
      scriptName: script.name,
      scriptLine: script.scriptLine,
      scriptColumn: script.scriptColumn,
    });
  });

  // Run in external terminal button
  const runExternal = document.createElement('button');
  runExternal.className = 'icon-btn action-run-external';
  runExternal.innerHTML = getActionIconSvg('runExternalWindow');
  runExternal.title = 'Run in external window';
  runExternal.setAttribute('aria-label', 'Run in external window');
  runExternal.addEventListener('click', (e) => {
    e.stopPropagation();
    vscode.postMessage({
      type: 'runExternal',
      workspacePath: script.workspacePath,
      scriptName: script.name,
      scriptCommand: script.command,
      isRawCommand: Boolean(script.isRawCommand),
    });
  });

  // Open external tab + copy command button
  const openExternalTabCopyCommand = document.createElement('button');
  openExternalTabCopyCommand.className = 'icon-btn action-open-external-tab-copy-command';
  openExternalTabCopyCommand.innerHTML = getActionIconSvg('openTabCopyCommand');
  openExternalTabCopyCommand.title = 'Open external tab and copy command';
  openExternalTabCopyCommand.setAttribute('aria-label', 'Open external tab and copy command');
  openExternalTabCopyCommand.addEventListener('click', (e) => {
    e.stopPropagation();
    vscode.postMessage({
      type: 'openExternalTabCopyCommand',
      workspacePath: script.workspacePath,
      scriptName: script.name,
      scriptCommand: script.command,
      isRawCommand: Boolean(script.isRawCommand),
    });
  });

  // Run in secondary location (opposite of primary)
  const runSecondary = document.createElement('button');
  const secondaryLocation = getSecondaryRunLocation();
  const secondaryIcon = secondaryLocation === 'editor' ? 'runEditor' : 'runPanel';
  runSecondary.className = `icon-btn action-run-secondary action-run-${secondaryLocation}`;
  runSecondary.innerHTML = getActionIconSvg(secondaryIcon);
  runSecondary.title = `Run in ${secondaryLocation}`;
  runSecondary.setAttribute('aria-label', `Run in ${secondaryLocation}`);
  runSecondary.addEventListener('click', (e) => {
    e.stopPropagation();
    vscode.postMessage({
      type: 'runScript',
      workspacePath: script.workspacePath,
      scriptName: script.name,
      scriptCommand: script.command,
      isRawCommand: Boolean(script.isRawCommand),
      locationOverride: secondaryLocation,
    });
  });

  // Favorite button
  const star = document.createElement('button');
  star.className = 'icon-btn star-btn action-favorite' + (isFav ? ' active' : '');
  star.innerHTML = getActionIconSvg(isFav ? 'favoriteActive' : 'favorite');
  star.title = isFav ? 'Remove from favorites' : 'Add to favorites';
  star.setAttribute('aria-label', isFav ? 'Remove from favorites' : 'Add to favorites');
  star.addEventListener('click', (e) => {
    e.stopPropagation();
    vscode.postMessage({
      type: 'toggleFavorite',
      workspacePath: ws.path,
      workspaceName: ws.name,
      scriptName: script.name,
    });
  });

  if (actionVisibility.openScript && !script.isRawCommand) {
    actions.appendChild(openInPackageJson);
  }
  if (actionVisibility.runSecondary) {
    actions.appendChild(runSecondary);
  }
  if (actionVisibility.runExternal) {
    actions.appendChild(runExternal);
  }
  if (actionVisibility.openExternalTabCopyCommand) {
    actions.appendChild(openExternalTabCopyCommand);
  }
  if (actionVisibility.favorite) {
    actions.appendChild(star);
  }
  row.appendChild(meta);
  row.appendChild(actions);

  // Click row to run script
  row.addEventListener('click', () => {
    if (state.primaryClickTarget === 'external') {
      vscode.postMessage({
        type: 'runExternal',
        workspacePath: script.workspacePath,
        scriptName: script.name,
        scriptCommand: script.command,
        isRawCommand: Boolean(script.isRawCommand),
      });
      return;
    }
    vscode.postMessage({
      type: 'runScript',
      workspacePath: script.workspacePath,
      scriptName: script.name,
      scriptCommand: script.command,
      isRawCommand: Boolean(script.isRawCommand),
    });
  });

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openScriptContextMenu(e.clientX, e.clientY, script, ws);
  });

  row.addEventListener('keydown', (e) => {
    if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
      e.preventDefault();
      e.stopPropagation();
      const rect = row.getBoundingClientRect();
      openScriptContextMenu(rect.left + 16, rect.bottom - 4, script, ws);
    }
  });

  return row;
}

/**
 * @returns {'panel' | 'editor'}
 */
function getSecondaryRunLocation() {
  return state.primaryRunLocation === 'editor' ? 'panel' : 'editor';
}

function getActionVisibility() {
  const current = state.actionVisibility || {};
  return {
    openScript: current.openScript ?? true,
    runSecondary: current.runSecondary ?? true,
    runExternal: current.runExternal ?? true,
    openExternalTabCopyCommand: current.openExternalTabCopyCommand ?? true,
    favorite: current.favorite ?? true,
  };
}

/**
 * @param {number} x
 * @param {number} y
 * @param {any} script
 * @param {any} ws
 */
function openScriptContextMenu(x, y, script, ws) {
  closeContextMenu();
  const target = `${ws.path}::${script.name}`;
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  const persistentEnabled = isScriptFeatureEnabled('persistentTerminal', ws.path, script.name);
  const envNameEnabled = isScriptFeatureEnabled('envName', ws.path, script.name);
  const effectiveLocation = getEffectiveScriptRunLocation(ws.path, script.name);
  const alwaysNewInternal = isScriptAlwaysNewInternal(ws.path, script.name);

  menu.appendChild(createContextMenuItem(
    persistentEnabled ? 'Disable persistent terminal' : 'Enable persistent terminal',
    () => {
      vscode.postMessage({
        type: 'togglePersistentTerminalScript',
        workspacePath: ws.path,
        scriptName: script.name,
        enabled: !persistentEnabled,
      });
      showToast(!persistentEnabled ? 'Persistent terminal enabled' : 'Persistent terminal disabled');
    }
  ));
  menu.appendChild(createContextMenuItem(
    alwaysNewInternal
      ? 'Disable always new internal terminal'
      : 'Always run in new internal terminal',
    () => {
      vscode.postMessage({
        type: 'setScriptAlwaysNewTerminal',
        workspacePath: ws.path,
        scriptName: script.name,
        enabled: !alwaysNewInternal,
      });
      showToast(
        alwaysNewInternal
          ? 'Always new internal terminal disabled'
          : 'Always new internal terminal enabled'
      );
    }
  ));
  const runLocationText = effectiveLocation === 'panel'
    ? 'Switch default run location to editor'
    : 'Switch default run location to panel';
  menu.appendChild(createContextMenuItem(
    runLocationText,
    () => {
      const nextLocation = effectiveLocation === 'panel' ? 'editor' : 'panel';
      vscode.postMessage({
        type: 'setScriptLocationOverride',
        workspacePath: ws.path,
        scriptName: script.name,
        location: nextLocation,
      });
      showToast(`Default run location: ${nextLocation}`);
    }
  ));
  if (state.internalRunLocationOverrides?.[target]) {
    menu.appendChild(createContextMenuItem(
      `Use global run location (${state.primaryRunLocation})`,
      () => {
        vscode.postMessage({
          type: 'setScriptLocationOverride',
          workspacePath: ws.path,
          scriptName: script.name,
        });
        showToast('Using global run location');
      }
    ));
  }
  menu.appendChild(createContextMenuItem(
    envNameEnabled ? 'Disable envName for this script' : 'Enable envName for this script',
    () => {
      vscode.postMessage({
        type: 'toggleEnvNameScriptDisabled',
        workspacePath: ws.path,
        scriptName: script.name,
        disabled: envNameEnabled,
      });
      showToast(envNameEnabled ? 'envName disabled for script' : 'envName enabled for script');
    }
  ));

  document.body.appendChild(menu);
  const { left, top } = clampContextMenuPosition(menu, x, y);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  contextMenuEl = menu;
}

function closeContextMenu() {
  if (!contextMenuEl) {
    return;
  }
  contextMenuEl.remove();
  contextMenuEl = undefined;
}

/**
 * @param {'envName' | 'internalRun' | 'persistentTerminal'} feature
 * @param {string} workspacePath
 * @param {string} scriptName
 * @returns {boolean}
 */
function isScriptFeatureEnabled(feature, workspacePath, scriptName) {
  const includeScripts = state.scriptFeatureFilters?.[feature]?.includeScripts || ['*'];
  const excludeScripts = state.scriptFeatureFilters?.[feature]?.excludeScripts || [];
  const included = includeScripts.some((pattern) => matchesScriptTargetPattern(workspacePath, scriptName, pattern));
  if (!included) {
    return false;
  }
  const excluded = excludeScripts.some((pattern) => matchesScriptTargetPattern(workspacePath, scriptName, pattern));
  return !excluded;
}

/**
 * @param {string} text
 * @param {() => void} onClick
 * @param {boolean} disabled
 * @returns {HTMLElement}
 */
function createContextMenuItem(text, onClick, disabled = false) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'context-menu-item' + (disabled ? ' disabled' : '');
  item.disabled = disabled;
  item.title = text;
  const label = document.createElement('span');
  label.className = 'context-menu-item-label';
  label.textContent = text;
  item.appendChild(label);
  item.addEventListener('click', (event) => {
    event.stopPropagation();
    if (disabled) {
      return;
    }
    onClick();
    closeContextMenu();
  });
  return item;
}

/**
 * @param {string} workspacePath
 * @param {string} scriptName
 * @returns {'panel' | 'editor'}
 */
function getEffectiveScriptRunLocation(workspacePath, scriptName) {
  const key = `${workspacePath}::${scriptName}`;
  return state.internalRunLocationOverrides?.[key] || state.primaryRunLocation;
}

/**
 * @param {string} workspacePath
 * @param {string} scriptName
 * @returns {boolean}
 */
function isScriptAlwaysNewInternal(workspacePath, scriptName) {
  const key = `${workspacePath}::${scriptName}`;
  return state.internalRunAlwaysNewOverrides?.[key] === true;
}

/**
 * @param {string} workspacePath
 * @param {string} scriptName
 * @param {string} pattern
 * @returns {boolean}
 */
function matchesScriptTargetPattern(workspacePath, scriptName, pattern) {
  const separatorIndex = pattern.indexOf('::');
  if (separatorIndex < 0) {
    return matchesWildcard(scriptName, pattern);
  }
  const workspacePattern = pattern.slice(0, separatorIndex) || '*';
  const scriptPattern = pattern.slice(separatorIndex + 2) || '*';
  return matchesWildcard(workspacePath, workspacePattern) && matchesWildcard(scriptName, scriptPattern);
}

/**
 * @param {string} value
 * @param {string} pattern
 * @returns {boolean}
 */
function matchesWildcard(value, pattern) {
  if (pattern === '*') {
    return true;
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(value);
}

function clampContextMenuPosition(menuEl, x, y) {
  const margin = 8;
  const maxLeft = window.innerWidth - menuEl.offsetWidth - margin;
  const maxTop = window.innerHeight - menuEl.offsetHeight - margin;
  return {
    left: Math.max(margin, Math.min(maxLeft, x)),
    top: Math.max(margin, Math.min(maxTop, y)),
  };
}

/**
 * @param {string} message
 */
function showToast(message) {
  let toast = /** @type {HTMLElement | null} */ (document.getElementById('toast'));
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toast?.classList.remove('visible');
  }, 1600);
}
