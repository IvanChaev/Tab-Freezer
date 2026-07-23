// bg/activity.js
import { withStorageLock } from "./storage.js";

const lastDeactivationTimes = new Map();
let currentActiveTabId = null;

export { lastDeactivationTimes };

export function getCurrentActiveTabId() {
  return currentActiveTabId;
}

const STORAGE_KEY = "tabDeactivationTimes";

let readinessResolve = null;
let readinessPromise = null;

let pendingRestorePromise = null;
let abortRestore = false;

function createReadinessPromise() {
  if (readinessResolve) {
    readinessResolve();
  }
  readinessPromise = new Promise(resolve => {
    readinessResolve = resolve;
  });
}

const READINESS_TIMEOUT_MS = 5000;

// ✅ ИСПРАВЛЕНИЕ: убран преждевременный readinessResolve().
// Если readinessPromise ещё не создан (initActivityTracking не вызывалась),
// создаём его, но НЕ резолвим — пусть таймаут защитит от вечного ожидания.
export function waitForActivityReadiness(timeoutMs = READINESS_TIMEOUT_MS) {
  if (!readinessPromise) {
    createReadinessPromise();
    // НЕ вызываем readinessResolve() здесь!
    // Резолв произойдёт только после реального завершения restore + syncActiveTab.
  }
  let timeoutId;
  const timeoutPromise = new Promise(resolve => {
    timeoutId = setTimeout(resolve, timeoutMs);
  });

  return Promise.race([
    readinessPromise.then(() => {
      clearTimeout(timeoutId);
    }),
    timeoutPromise
  ]);
}

// ─── Дебаунс записи ───
let persistDebounceTimer = null;
const PERSIST_DEBOUNCE_MS = 500;

function debouncedPersistDeactivationTimes() {
  if (persistDebounceTimer !== null) {
    clearTimeout(persistDebounceTimer);
  }
  persistDebounceTimer = setTimeout(() => {
    persistDebounceTimer = null;
    persistDeactivationTimes().catch(console.error);
  }, PERSIST_DEBOUNCE_MS);
}

function cancelDebouncedPersist() {
  if (persistDebounceTimer !== null) {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = null;
  }
}

async function _persistDeactivationTimesUnlocked() {
  const obj = {};
  for (const [id, time] of lastDeactivationTimes) {
    obj[id] = time;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: obj });
}

async function persistDeactivationTimes() {
  return withStorageLock(() => _persistDeactivationTimesUnlocked());
}

// ✅ ГЛАВНОЕ ИСПРАВЛЕНИЕ: merge вместо clear+overwrite.
// Live-данные (выставленные onActivated/onCreated/onFocusChanged во время
// асинхронного чтения storage) НИКОГДА не перезаписываются stale-снэпшотом.
async function restoreDeactivationTimes() {
  return withStorageLock(async () => {
    if (abortRestore) {
      console.log("Восстановление деактиваций отменено, т.к. выполнен сброс.");
      return;
    }

    const data = await chrome.storage.local.get(STORAGE_KEY);
    const obj = data[STORAGE_KEY] || {};
    const now = Date.now();
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;

    // Узнаём, какие вкладки СЕЙЧАС реально активны (во ВСЕХ окнах),
    // чтобы никогда не восстановить для них устаревшую метку.
    let activeTabIds = new Set();
    try {
      const activeTabs = await chrome.tabs.query({ active: true });
      activeTabIds = new Set(activeTabs.map(t => t.id));
    } catch (e) {
      console.error("Не удалось получить активные вкладки при restore:", e);
    }

    let changed = false;

    for (const [id, time] of Object.entries(obj)) {
      const tabId = Number(id);

      // 1) Не перезаписываем то, что уже обновилось "вживую"
      //    (onActivated/onCreated/onFocusChanged сработали пока шёл storage.get)
      if (lastDeactivationTimes.has(tabId)) continue;

      // 2) Никогда не восстанавливаем метку неактивности для реально активной вкладки
      if (activeTabIds.has(tabId)) continue;

      // 3) Проверяем срок годности записи
      if (typeof time === 'number' && (now - time) < MAX_AGE_MS) {
        lastDeactivationTimes.set(tabId, time);
      } else {
        // Запись протухла — не добавляем, помечаем что нужно пересохраниить
        changed = true;
      }
    }

    // Если были протухшие записи — пересохраняем карту без них
    if (changed) {
      await _persistDeactivationTimesUnlocked();
    }
  });
}

export async function resetDeactivationTimes() {
  abortRestore = true;
  if (pendingRestorePromise) {
    try {
      await pendingRestorePromise;
    } catch (e) { /* ignore */ }
  }

  cancelDebouncedPersist();

  await withStorageLock(async () => {
    lastDeactivationTimes.clear();
    currentActiveTabId = null;
    await chrome.storage.local.remove(STORAGE_KEY);

    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    for (const tab of tabs) {
      if (!tab.active) {
        lastDeactivationTimes.set(tab.id, now);
      } else {
        currentActiveTabId = tab.id;
      }
    }
    await _persistDeactivationTimesUnlocked();
  });

  createReadinessPromise();
  if (readinessResolve) {
    readinessResolve();
    readinessResolve = null;
  }
}

export function getLastActiveTime(tab) {
  if (tab.active || tab.id === currentActiveTabId) {
    return Date.now();
  }
  if (lastDeactivationTimes.has(tab.id)) {
    return lastDeactivationTimes.get(tab.id);
  }
  return tab.lastAccessed || Date.now();
}

async function syncActiveTab() {
  try {
    const focusedWindow = await chrome.windows.getLastFocused();
    const [tab] = await chrome.tabs.query({ active: true, windowId: focusedWindow.id });
    if (tab) {
      if (currentActiveTabId !== tab.id) {
        if (currentActiveTabId !== null) {
          lastDeactivationTimes.set(currentActiveTabId, Date.now());
        }
        currentActiveTabId = tab.id;
        lastDeactivationTimes.delete(tab.id);
        debouncedPersistDeactivationTimes();
      } else {
        lastDeactivationTimes.delete(tab.id);
      }
    }
  } catch (e) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        currentActiveTabId = tab.id;
        lastDeactivationTimes.delete(tab.id);
        debouncedPersistDeactivationTimes();
      }
    } catch (e2) {
      console.error("syncActiveTab fallback failed:", e2);
    }
  }
}

export function initActivityTracking({ restore = true } = {}) {
  createReadinessPromise();
  abortRestore = false;

  if (restore) {
    pendingRestorePromise = restoreDeactivationTimes()
      .then(() => syncActiveTab())
      .then(() => {
        if (!abortRestore) {
          if (readinessResolve) {
            readinessResolve();
            readinessResolve = null;
          }
        }
      })
      .catch(console.error);
  } else {
    pendingRestorePromise = syncActiveTab()
      .then(() => {
        if (readinessResolve) {
          readinessResolve();
          readinessResolve = null;
        }
      })
      .catch(console.error);
  }

  chrome.tabs.onActivated.addListener((activeInfo) => {
    const newActiveTabId = activeInfo.tabId;
    if (currentActiveTabId !== null && currentActiveTabId !== newActiveTabId) {
      const now = Date.now();
      lastDeactivationTimes.set(currentActiveTabId, now);
      debouncedPersistDeactivationTimes();
    }
    lastDeactivationTimes.delete(newActiveTabId);
    currentActiveTabId = newActiveTabId;
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      return;
    }
    syncActiveTab();
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    lastDeactivationTimes.delete(tabId);
    debouncedPersistDeactivationTimes();
    if (currentActiveTabId === tabId) {
      currentActiveTabId = null;
    }
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (!tab.active) {
      const now = Date.now();
      lastDeactivationTimes.set(tab.id, now);
    } else {
      if (currentActiveTabId !== null && currentActiveTabId !== tab.id) {
        lastDeactivationTimes.set(currentActiveTabId, Date.now());
      }
      lastDeactivationTimes.delete(tab.id);
      currentActiveTabId = tab.id;
      debouncedPersistDeactivationTimes();
    }
  });

  return pendingRestorePromise;
}