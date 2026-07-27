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

export function waitForActivityReadiness(timeoutMs = READINESS_TIMEOUT_MS) {
  if (!readinessPromise) {
    createReadinessPromise();
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

// 🔥 ИЗМЕНЕНИЕ: теперь сохраняем и currentActiveTabId
async function _persistDeactivationTimesUnlocked() {
  const obj = {
    currentActiveTabId: currentActiveTabId  // сохраняем ID активной вкладки
  };
  for (const [id, time] of lastDeactivationTimes) {
    obj[id] = time;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: obj });
}

async function persistDeactivationTimes() {
  return withStorageLock(() => _persistDeactivationTimesUnlocked());
}

// 🔥 ИЗМЕНЕНИЕ: восстановление currentActiveTabId из хранилища
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

    // Восстанавливаем активную вкладку из хранилища
    const savedActiveTabId = obj.currentActiveTabId ?? null;
    if (savedActiveTabId !== null && savedActiveTabId !== undefined) {
      // Проверяем, существует ли ещё такая вкладка
      try {
        await chrome.tabs.get(savedActiveTabId);
        currentActiveTabId = savedActiveTabId;
        console.log("Восстановлена активная вкладка:", savedActiveTabId);
      } catch (e) {
        // Вкладка была закрыта, пока сервис-воркер спал
        currentActiveTabId = null;
        console.log("Сохранённая активная вкладка уже не существует, сброшена.");
      }
    } else {
      currentActiveTabId = null;
    }

    // Узнаём, какие вкладки СЕЙЧАС реально активны (во ВСЕХ окнах)
    let activeTabIds = new Set();
    try {
      const activeTabs = await chrome.tabs.query({ active: true });
      activeTabIds = new Set(activeTabs.map(t => t.id));
    } catch (e) {
      console.error("Не удалось получить активные вкладки при restore:", e);
    }

    let changed = false;

    for (const [id, time] of Object.entries(obj)) {
      // Пропускаем служебное поле currentActiveTabId
      if (id === "currentActiveTabId") continue;

      const tabId = Number(id);

      // 1) Не перезаписываем то, что уже обновилось "вживую"
      if (lastDeactivationTimes.has(tabId)) continue;

      // 2) Никогда не восстанавливаем метку неактивности для реально активной вкладки
      if (activeTabIds.has(tabId)) continue;

      // 3) Проверяем срок годности записи
      if (typeof time === 'number' && (now - time) < MAX_AGE_MS) {
        lastDeactivationTimes.set(tabId, time);
      } else {
        changed = true;
      }
    }

    // 🔥 Дополнительно: если после восстановления currentActiveTabId всё ещё null,
    // а в карте деактиваций нет активной вкладки, то на всякий случай попробуем
    // определить её через syncActiveTab (один раз при первом запуске расширения).
    if (currentActiveTabId === null) {
      // Не вызываем syncActiveTab здесь, это будет сделано позже в initActivityTracking.
      // Просто оставляем возможность.
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
    // 🔥 После сброса сохраняем актуальное состояние
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
  // 🔥 Дополнительная страховка: если данных нет, возвращаем текущее время,
  // чтобы вкладка не казалась неактивной бесконечно долго.
  return tab.lastAccessed || Date.now();
}

// 🔥 Упрощённый syncActiveTab – больше не нужен при восстановлении,
// но остаётся для обработки onFocusChanged и как fallback.
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
      .then(() => {
        // 🔥 Если после восстановления currentActiveTabId так и не определён,
        // запускаем syncActiveTab для первого определения.
        if (currentActiveTabId === null) {
          return syncActiveTab();
        }
      })
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
    // Явно вызываем персистентность, т.к. currentActiveTabId изменился
    debouncedPersistDeactivationTimes();
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      return;
    }
    syncActiveTab();
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    lastDeactivationTimes.delete(tabId);
    if (currentActiveTabId === tabId) {
      currentActiveTabId = null;
      // Персистентно сбрасываем активную вкладку
      debouncedPersistDeactivationTimes();
    } else {
      debouncedPersistDeactivationTimes();
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