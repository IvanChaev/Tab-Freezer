// ui/state.js — общее состояние дашборда: ссылки на DOM, кэши, режимы сортировки.
// Создаётся один раз в dashboard.js и пробрасывается во все модули панелей.

import { isSystemUrl, formatDuration } from "./dom.js";

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
    totalSavedMemory: document.getElementById('totalSavedMemory'),
    tempExemptionList: document.getElementById('tempExemptionList'),
    fullFreezeSystemPages: document.getElementById('fullFreezeSystemPages'),
    systemFreezeListEditor: document.getElementById('systemFreezeListEditor')
  };
}

export function createState(el) {
  return {
    el,
    savedTabsCache: [],
    openTabsCache: [],
    currentSortSaved: 'real',
    currentSortTabs: 'real',
    tabTimerRefs: new Map(),
    savedTimerRefs: new Map()
  };
}

// ---- Сортировки ----

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
      // 🆕 используем lastActiveTime (с fallback на lastAccessed)
      const aTime = a.active ? 0 : (now - (a.lastActiveTime || a.lastAccessed || now));
      const bTime = b.active ? 0 : (now - (b.lastActiveTime || b.lastAccessed || now));
      return aTime - bTime;
    });
  }
  return list;
}

export function updateTabBadge(badge, tab, now) {
  if (tab.active) {
    badge.textContent = "● Активна";
    return;
  }
  const lastActive = typeof tab.lastActiveTime === "number" ? tab.lastActiveTime : (tab.lastAccessed || now);
  const timeText = formatDuration(now - lastActive);
  const isSys = isSystemUrl(tab.url);
  const prefix = isSys ? "Системная " : "";
  const statusIcon = tab.discarded ? "❄" : "⏱";
  badge.textContent = prefix + statusIcon + " " + timeText;
}