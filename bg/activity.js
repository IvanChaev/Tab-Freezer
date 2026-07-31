// @ts-check
// bg/activity.js — трекинг активной вкладки в браузере
import { withStorageLock } from "./storage.js";
import { ACTIVITY_READINESS_TIMEOUT_MS, PERSIST_DEBOUNCE_MS } from "../shared.js";

// Включи для диагностики, но не оставляй в проде.
const DEBUG = false;

/** @type {Map<number, number>} */
const lastDeactivationTimes = new Map();
/** @type {number|null} */
let currentActiveTabId = null;

// ─── Защита от гонки restore vs live-события ───
// restoreDeactivationTimes() делает несколько await (storage.get, tabs.get, tabs.query)
// перед тем, как окончательно выставить currentActiveTabId. Если за это время реально
// сработает chrome.tabs.onActivated / onFocusChanged / onCreated, его результат нельзя
// безусловно затирать устаревшим значением из storage.
/** @type {boolean} */
let restoreInProgress = false;
/** @type {boolean} */
let liveUpdateDuringRestore = false;

export { lastDeactivationTimes };

/**
 * Возвращает текущий активный ID вкладки (из внутреннего трекера).
 * @returns {number|null}
 */
export function getCurrentActiveTabId() {
  return currentActiveTabId;
}

const STORAGE_KEY = "tabDeactivationTimes";

/** @type {((value: void) => void)|null} */
let readinessResolve = null;
/** @type {Promise<void>|null} */
let readinessPromise = null;
/** @type {Promise<void>|null} */
let pendingRestorePromise = null;
/** @type {boolean} */
let abortRestore = false;

/**
 * @returns {void}
 */
function createReadinessPromise() {
  if (readinessResolve) {
    readinessResolve();
  }

  readinessPromise = new Promise(resolve => {
    readinessResolve = resolve;
  });
}

/**
 * Ждёт готовности activity tracking.
 * @param {number} [timeoutMs=ACTIVITY_READINESS_TIMEOUT_MS]
 * @returns {Promise<boolean>} true — готов, false — таймаут
 */
export function waitForActivityReadiness(timeoutMs = ACTIVITY_READINESS_TIMEOUT_MS) {
  if (!readinessPromise) {
    createReadinessPromise();
  }

  let timeoutId;

  const timeoutPromise = new Promise(resolve => {
    timeoutId = setTimeout(() => resolve(false), timeoutMs);
  });

  return Promise.race([
    readinessPromise.then(() => {
      clearTimeout(timeoutId);
      return true;
    }),
    timeoutPromise
  ]);
}

// ─── Персист с debounce ───
/** @type {ReturnType<typeof setTimeout>|null} */
let persistTimeoutId = null;

/**
 * Отложенное сохранение с debounce.
 * @returns {void}
 */
function schedulePersist() {
  if (persistTimeoutId) clearTimeout(persistTimeoutId);
  persistTimeoutId = setTimeout(() => {
    persistTimeoutId = null;
    persistDeactivationTimes().catch(console.error);
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Немедленное сохранение (для onRemoved — терять закрытие вкладки нельзя).
 * @returns {void}
 */
function schedulePersistImmediate() {
  if (persistTimeoutId) {
    clearTimeout(persistTimeoutId);
    persistTimeoutId = null;
  }
  persistDeactivationTimes().catch(console.error);
}

/**
 * Сохраняет карту деактиваций и activeTabId в storage (без мьютекса).
 * @returns {Promise<void>}
 */
async function _persistDeactivationTimesUnlocked() {
  const obj = {
    currentActiveTabId: currentActiveTabId
  };

  for (const [id, time] of lastDeactivationTimes) {
    obj[id] = time;
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: obj });
}

/**
 * @returns {Promise<void>}
 */
async function persistDeactivationTimes() {
  return withStorageLock(() => _persistDeactivationTimesUnlocked());
}

/**
 * @returns {void}
 */
function markLiveUpdateDuringRestore() {
  if (restoreInProgress) {
    liveUpdateDuringRestore = true;
  }
}

/**
 * Восстановление состояния активности из хранилища.
 *
 * Логика:
 * 1. Читаем storage.
 * 2. Если есть сохранённый currentActiveTabId, проверяем, жив ли он.
 * 3. Если во время restore уже пришло живое событие, не затираем его.
 * 4. Если живое событие пришло раньше restore, но не смогло записать деактивацию
 *    старой вкладки, восстанавливаем эту запись задним числом.
 * 5. Сверяемся с реально активными вкладками браузера.
 * 6. Восстанавливаем lastDeactivationTimes, не трогая живые и активные вкладки.
 */
async function restoreDeactivationTimes() {
  return withStorageLock(async () => {
    if (abortRestore) {
      console.log("Восстановление деактиваций отменено, т.к. выполнен сброс.");
      return;
    }

    restoreInProgress = true;
    liveUpdateDuringRestore = false;

    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const obj = /** @type {Record<string, number>} */ (data[STORAGE_KEY] || {});
      const now = Date.now();
      const MAX_AGE_MS = 24 * 60 * 60 * 1000;

      const savedActiveTabId = obj.currentActiveTabId ?? null;
      let savedTabExists = false;

      // Восстанавливаем сохранённую активную вкладку, если только live-событие
      // уже не успело обновить currentActiveTabId.
      if (savedActiveTabId !== null && savedActiveTabId !== undefined) {
        try {
          await chrome.tabs.get(savedActiveTabId);
          savedTabExists = true;

          if (!liveUpdateDuringRestore) {
            currentActiveTabId = savedActiveTabId;
            console.log("Восстановлена активная вкладка:", savedActiveTabId);
          }
        } catch (e) {
          if (!liveUpdateDuringRestore) {
            currentActiveTabId = null;
            console.log("Сохранённая активная вкладка уже не существует, сброшена.");
          }
        }
      } else if (!liveUpdateDuringRestore) {
        currentActiveTabId = null;
      }

      // Узнаём, какие вкладки СЕЙЧАС реально активны во всех окнах.
      let activeTabs = [];
      let activeQueryOk = false;

      try {
        activeTabs = await chrome.tabs.query({ active: true });
        activeQueryOk = true;
      } catch (e) {
        console.error("Не удалось получить активные вкладки при restore:", e);
      }

      const activeTabIds = new Set(activeTabs.map(t => t.id));

      // Если сохранённая вкладка существует, но браузер уже не считает её активной,
      // нужно аккуратно восстановить пропущенную деактивацию.
      if (savedTabExists && savedActiveTabId !== null && savedActiveTabId !== undefined) {
        const savedStillActive = activeQueryOk && activeTabIds.has(savedActiveTabId);

        if (liveUpdateDuringRestore) {
          // Live-событие пришло раньше restore.
          //
          // Пример:
          // 1. SW спал, currentActiveTabId = X.
          // 2. Пользователь переключился с X на Y.
          // 3. onActivated сработал раньше restore, когда в памяти currentActiveTabId был null.
          // 4. Listener выставил currentActiveTabId = Y, но не смог записать деактивацию X.
          //
          // Здесь мы восстанавливаем эту пропущенную запись.
          if (
            activeQueryOk &&
            !savedStillActive &&
            savedActiveTabId !== currentActiveTabId &&
            !lastDeactivationTimes.has(savedActiveTabId)
          ) {
            lastDeactivationTimes.set(savedActiveTabId, Date.now());
            console.log(
              "Восстановлена пропущенная деактивация вкладки (live update опередил restore):",
              savedActiveTabId
            );
          }
        } else if (
          activeQueryOk &&
          !savedStillActive &&
          currentActiveTabId === savedActiveTabId
        ) {
          // Live-события не было, но браузер говорит, что сохранённая вкладка уже не активна.
          // Например, пользователь переключился, пока SW реально спал, а проснулись мы по alarm.
          //
          // В этом случае безопаснее:
          // 1. записать деактивацию сохранённой вкладки текущим моментом;
          // 2. сбросить currentActiveTabId, чтобы initActivityTracking() сделал syncActiveTab().
          if (!lastDeactivationTimes.has(savedActiveTabId)) {
            lastDeactivationTimes.set(savedActiveTabId, Date.now());
          }

          currentActiveTabId = null;
        }
      }

      // Для текущей активной вкладки не должно быть записи о деактивации.
      if (currentActiveTabId !== null && lastDeactivationTimes.delete(currentActiveTabId)) {
        // Если удалили запись, состояние тоже нужно будет пересохранить.
      }

      let dirty = false;

      for (const [id, time] of Object.entries(obj)) {
        if (id === "currentActiveTabId") continue;

        const tabId = Number(id);

        if (Number.isNaN(tabId)) continue;

        // Не перезаписываем то, что уже обновилось вживую.
        if (lastDeactivationTimes.has(tabId)) continue;

        // Никогда не восстанавливаем метку деактивации для реально активной вкладки.
        if (activeTabIds.has(tabId)) continue;

        // Не восстанавливаем метку для вкладки, которую мы сейчас считаем активной.
        if (tabId === currentActiveTabId) continue;

        if (typeof time === "number" && (now - time) < MAX_AGE_MS) {
          lastDeactivationTimes.set(tabId, time);
        } else {
          // Запись протухла или битая — не добавляем.
          dirty = true;
        }
      }

      // Если мы добавляли пропущенную деактивацию, сбрасывали currentActiveTabId
      // или чистили протухшие записи — пересохраняем состояние.
      if (dirty || liveUpdateDuringRestore) {
        await _persistDeactivationTimesUnlocked();
      }
    } finally {
      restoreInProgress = false;
    }
  });
}

/**
 * Полный сброс состояния активности.
 * Используется, например, при chrome.runtime.onStartup.
 * @returns {Promise<void>}
 */
export async function resetDeactivationTimes() {
  abortRestore = true;

  if (pendingRestorePromise) {
    try {
      await pendingRestorePromise;
    } catch (e) {
      // ignore
    }
  }

  await withStorageLock(async () => {
    restoreInProgress = false;
    liveUpdateDuringRestore = false;

    lastDeactivationTimes.clear();
    currentActiveTabId = null;

    await chrome.storage.local.remove(STORAGE_KEY);

    const tabs = await chrome.tabs.query({});
    const now = Date.now();

    let focusedWindowId = null;

    try {
      const focusedWindow = await chrome.windows.getLastFocused();
      focusedWindowId = focusedWindow.id;
    } catch (e) {
      // ignore
    }

    for (const tab of tabs) {
      if (!tab.active) {
        lastDeactivationTimes.set(tab.id, now);
      } else {
        // Если активных вкладок несколько (разные окна), предпочитаем активную вкладку
        // последнего focused окна. Это всё ещё компромисс для multi-window, но лучше,
        // чем случайная последняя активная вкладка в цикле.
        if (focusedWindowId !== null && tab.windowId === focusedWindowId) {
          currentActiveTabId = tab.id;
        } else if (currentActiveTabId === null) {
          currentActiveTabId = tab.id;
        }
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

/**
 * Возвращает время последней активности вкладки.
 * @param {chrome.tabs.Tab} tab
 * @returns {number}
 */
export function getLastActiveTime(tab) {
  if (DEBUG) {
    console.log(
      `[getLastActiveTime] tabId=${tab.id} active=${tab.active} ` +
      `currentActiveTabId=${currentActiveTabId} ` +
      `lastDeact=${lastDeactivationTimes.get(tab.id)} lastAccessed=${tab.lastAccessed}`
    );
  }

  if (tab.active) {
    return Date.now();
  }

  if (lastDeactivationTimes.has(tab.id)) {
    return lastDeactivationTimes.get(tab.id);
  }

  // Если точной записи о деактивации нет, опираемся на lastAccessed.
  // Это может быть немного неточно, но лучше, чем обнулять счётчик.
  if (typeof tab.lastAccessed === "number") {
    return tab.lastAccessed;
  }

  // lastAccessed может быть null у системных страниц (chrome://, edge://, about: и т.п.)
  // и у вкладок, созданных во время сна service worker'а (запись о деактивации
  // при этом могла протухнуть). Такую вкладку нельзя считать "только что использованной" —
  // иначе она никогда не замораживается. Возвращаем 0 (эпоху): она явно старше тайм-аута.
  return 0;
}

/**
 * Синхронизация текущей активной вкладки с браузером.
 * Используется как fallback и при смене фокуса окна.
 */
async function syncActiveTab() {
  try {
    const focusedWindow = await chrome.windows.getLastFocused();
    const [tab] = await chrome.tabs.query({ active: true, windowId: focusedWindow.id });

    if (tab) {
      markLiveUpdateDuringRestore();

      if (currentActiveTabId !== tab.id) {
        if (currentActiveTabId !== null) {
          lastDeactivationTimes.set(currentActiveTabId, Date.now());
        }

        currentActiveTabId = tab.id;
        lastDeactivationTimes.delete(tab.id);
        schedulePersist();
      } else {
        if (lastDeactivationTimes.delete(tab.id)) {
          schedulePersist();
        }
      }
    }
  } catch (e) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab) {
        markLiveUpdateDuringRestore();

        if (currentActiveTabId !== tab.id) {
          if (currentActiveTabId !== null) {
            lastDeactivationTimes.set(currentActiveTabId, Date.now());
          }

          currentActiveTabId = tab.id;
          lastDeactivationTimes.delete(tab.id);
          schedulePersist();
        } else {
          if (lastDeactivationTimes.delete(tab.id)) {
            schedulePersist();
          }
        }
      }
    } catch (e2) {
      console.error("syncActiveTab fallback failed:", e2);
    }
  }
}

/**
 * Инициализация трекинга активности.
 * @param {{ restore?: boolean }} [options]
 * @returns {Promise<void>|null}
 */
export function initActivityTracking({ restore = true } = {}) {
  createReadinessPromise();
  abortRestore = false;

  if (restore) {
    pendingRestorePromise = restoreDeactivationTimes()
      .then(() => {
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
    const now = Date.now();

    if (DEBUG) {
      console.log(
        `[onActivated] prev=${currentActiveTabId} new=${newActiveTabId} windowId=${activeInfo.windowId}`
      );
    }

    if (currentActiveTabId !== null && currentActiveTabId !== newActiveTabId) {
      lastDeactivationTimes.set(currentActiveTabId, now);
      schedulePersist();
    }

    lastDeactivationTimes.delete(newActiveTabId);
    currentActiveTabId = newActiveTabId;

    markLiveUpdateDuringRestore();
    schedulePersist();
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
    }

    schedulePersistImmediate();
  });

  chrome.tabs.onCreated.addListener((tab) => {
    const now = Date.now();

    if (!tab.active) {
      lastDeactivationTimes.set(tab.id, now);
      schedulePersist();
    } else {
      if (currentActiveTabId !== null && currentActiveTabId !== tab.id) {
        lastDeactivationTimes.set(currentActiveTabId, now);
      }

      lastDeactivationTimes.delete(tab.id);
      currentActiveTabId = tab.id;

      markLiveUpdateDuringRestore();
      schedulePersist();
    }
  });

  return pendingRestorePromise;
}