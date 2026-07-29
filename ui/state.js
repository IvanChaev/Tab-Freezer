// @ts-check
// ui/state.js — общее состояние дашборда: ссылки на DOM, кэши, режимы сортировки.
// Создаётся один раз в dashboard.js и пробрасывается во все модули панелей.

import { isSystemUrl, formatDuration } from "./dom.js";
import { STALE_CACHE_THRESHOLD_MS } from "../shared.js";

/**
 * @returns {import("../types.js").DOMRefs}
 */
export function collectElements() {
  return {
    tabs: document.querySelectorAll('.nav-tab'),
    panes: document.querySelectorAll('.tab-pane'),
    savedList: document.getElementById('savedList'),
    tabList: document.getElementById('tabList'),
    logsContainer: document.getElementById('logsContainer'),
    whitelistEditor: document.getElementById('whitelistEditor'),
    stats: document.getElementById('stats'),
    countSaved: document.getElementById('countSaved'),
    countActive: document.getElementById('countActive'),
    countTemp: document.getElementById('countTemp'),
    toast: document.getElementById('toast'),
    timeout: document.getElementById('timeout'),
    excludePinned: document.getElementById('excludePinned'),
    excludeAudio: document.getElementById('excludeAudio'),
    aggressiveFreeze: document.getElementById('aggressiveFreeze'),
    autoClose: document.getElementById('autoClose'),
    closeOldMinutes: document.getElementById('closeOldMinutes'),
    totalFrozenCount: document.getElementById('totalFrozenCount'),
    tempExemptionList: document.getElementById('tempExemptionList'),
    fullFreezeSystemPages: document.getElementById('fullFreezeSystemPages'),
    systemFreezeListEditor: document.getElementById('systemFreezeListEditor')
  };
}

/**
 * @param {import("../types.js").DOMRefs} el
 * @returns {import("../types.js").UIState}
 */
export function createState(el) {
  return /** @type {import("../types.js").UIState} */ ({
    el,
    savedTabsCache: [],
    openTabsCache: [],
    currentSortSaved: 'real',
    currentSortTabs: 'real',
    tabTimerRefs: new Map(),
    savedTimerRefs: new Map()
  });
}

// ---- Сортировки ----

/**
 * @param {import("../types.js").SavedEntry[]} saved
 * @param {import("../types.js").SortMode} mode
 * @returns {import("../types.js").SavedEntry[]}
 */
export function sortSavedTabs(saved, mode) {
  if (mode === 'real') return saved.slice();
  const now = Date.now();
  const list = saved.slice();
  if (mode === 'alphabet') {
    list.sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url));
  } else if (mode === 'state') {
    list.sort((a, b) => {
      const aSystem = isSystemUrl(a.url);
      const bSystem = isSystemUrl(b.url);
      if (aSystem && !bSystem) return 1;
      if (!aSystem && bSystem) return -1;
      const aTime = a.closedAt ? (now - a.closedAt) : 0;
      const bTime = b.closedAt ? (now - b.closedAt) : 0;
      return aTime - bTime;
    });
  }
  return list;
}

/**
 * @param {import("../types.js").TabInfo[]} tabs
 * @param {import("../types.js").SortMode} mode
 * @returns {import("../types.js").TabInfo[]}
 */
export function sortOpenTabs(tabs, mode) {
  if (mode === 'real') return tabs.slice();
  const now = Date.now();
  const list = tabs.slice();
  if (mode === 'alphabet') {
    list.sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url));
  } else if (mode === 'state') {
    list.sort((a, b) => {
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      if (!a.discarded && b.discarded) return -1;
      if (a.discarded && !b.discarded) return 1;
      const aTime = a.active ? 0 : (now - (a.lastActiveTime || a.lastAccessed || now));
      const bTime = b.active ? 0 : (now - (b.lastActiveTime || b.lastAccessed || now));
      return aTime - bTime;
    });
  }
  return list;
}

/**
 * @param {HTMLElement} badge
 * @param {import("../types.js").TabInfo} tab
 * @param {number} now
 * @returns {void}
 */
export function updateTabBadge(badge, tab, now) {
  // ✅ Если вкладка помечена как активная в данных — показываем "Активна"
  if (tab.active) {
    badge.textContent = "● Активна";
    return;
  }

  const lastActive = typeof tab.lastActiveTime === "number"
    ? tab.lastActiveTime
    : (tab.lastAccessed || now);

  if (now - lastActive < STALE_CACHE_THRESHOLD_MS) {
    badge.textContent = "● Активна";
    return;
  }

  const timeText = formatDuration(now - lastActive);
  const isSys = isSystemUrl(tab.url);
  const prefix = isSys ? "Системная " : "";
  const statusIcon = tab.discarded ? "❄" : "⏱";
  badge.textContent = prefix + statusIcon + " " + timeText;
}