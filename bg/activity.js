// bg/activity.js
import { withStorageLock } from "./storage.js";

const lastDeactivationTimes = new Map();
let currentActiveTabId = null;

export { lastDeactivationTimes };

const STORAGE_KEY = "tabDeactivationTimes";

let readinessResolve = null;
let readinessPromise = null;

// Флаг для отмены восстановления при вызове resetDeactivationTimes
let pendingRestorePromise = null;
let abortRestore = false;

// ─── ФИКС #3: разрешаем старый промис перед созданием нового ───
function createReadinessPromise() {
  if (readinessResolve) {
    readinessResolve();
  }
  readinessPromise = new Promise(resolve => {
    readinessResolve = resolve;
  });
}

// ─── ИСПРАВЛЕНИЕ #1: таймаут, чтобы мьютекс в freeze.js не вис вечно ───
const READINESS_TIMEOUT_MS = 5000;

export function waitForActivityReadiness(timeoutMs = READINESS_TIMEOUT_MS) {
  if (!readinessPromise) {
    createReadinessPromise();
    if (readinessResolve) readinessResolve();
  }
  // ✅ Очищаем таймер, если промис готовности разрешился раньше
  let timeoutId;
  const timeoutPromise = new Promise(resolve => {
    timeoutId = setTimeout(resolve, timeoutMs);
  });

  return Promise.race([
    readinessPromise.then(() => {
      clearTimeout(timeoutId); // убираем лишний таймер
    }),
    timeoutPromise
  ]);
}

// ─── ФИКС #1 (оригинальный): дебаунс записи карты деактивации ───
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

// ─── ИСПРАВЛЕНИЕ #2: восстановление обёрнуто в мьютекс ───
async function restoreDeactivationTimes() {
  return withStorageLock(async () => {
    // ✅ Если сброс уже вызван — игнорируем результат восстановления
    if (abortRestore) {
      console.log("Восстановление деактиваций отменено, т.к. выполнен сброс.");
      return;
    }

    const data = await chrome.storage.local.get(STORAGE_KEY);
    const obj = data[STORAGE_KEY] || {};
    lastDeactivationTimes.clear();
    const now = Date.now();
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;
    let changed = false;

    for (const [id, time] of Object.entries(obj)) {
      if (typeof time === 'number' && (now - time) < MAX_AGE_MS) {
        lastDeactivationTimes.set(Number(id), time);
      } else {
        changed = true;
      }
    }

    if (changed) {
      await _persistDeactivationTimesUnlocked();
    }
  });
}

export async function resetDeactivationTimes() {
  // ✅ Отменяем все незавершённые восстановления
  abortRestore = true;
  // Дожидаемся завершения текущего восстановления, чтобы не было параллельной записи
  if (pendingRestorePromise) {
    try {
      await pendingRestorePromise;
    } catch (e) {
      // игнорируем
    }
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

  // Создаём новый промис готовности (старый уже не нужен)
  createReadinessPromise();
  if (readinessResolve) {
    readinessResolve();
    readinessResolve = null;
  }
}

export function getLastActiveTime(tab) {
  if (tab.active) {
    return Date.now();
  }
  if (lastDeactivationTimes.has(tab.id)) {
    return lastDeactivationTimes.get(tab.id);
  }
  return tab.lastAccessed || Date.now();
}

export function initActivityTracking({ restore = true } = {}) {
  createReadinessPromise();
  abortRestore = false; // сбрасываем флаг отмены

  if (restore) {
    pendingRestorePromise = restoreDeactivationTimes()
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
    pendingRestorePromise = Promise.resolve();
    if (readinessResolve) {
      readinessResolve();
      readinessResolve = null;
    }
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
    }
  });

  chrome.tabs.query({ active: true, currentWindow: true })
    .then(([tab]) => {
      if (tab) {
        currentActiveTabId = tab.id;
        lastDeactivationTimes.delete(tab.id);
        debouncedPersistDeactivationTimes();
      }
    })
    .catch(console.error);

  return pendingRestorePromise;
}