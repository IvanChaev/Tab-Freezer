// @ts-check
// bg/storage.js — слой хранилища chrome.storage.local: обработка квоты,
// инициализация дефолтов и лог. Никакой бизнес-логики "заморозки" — только данные.
// Мьютекс для последовательного доступа вынесен в ./lock.js.

import { DEFAULT_SETTINGS, LOG_MAX_LENGTH } from "../shared.js";
import { withStorageLock } from "./lock.js";
export { withStorageLock };

// === ЗАЩИТА ОТ ПРЕВЫШЕНИЯ КВОТЫ ===
/**
 * @param {unknown} e
 * @returns {boolean}
 */
function isQuotaError(e) {
  const msg = (e && e.message) || String(e || "");
  return /quota/i.test(msg);
}

/**
 * Сохраняет список замороженных вкладок, с поэтапным сжатием при превышении квоты.
 * @param {import("../types.js").SavedEntry[]} savedTabs
 * @returns {Promise<import("../types.js").SavedEntry[]>}
 */
export async function persistSavedTabs(savedTabs) {
  try {
    await chrome.storage.local.set({ savedTabs });
    return savedTabs;
  } catch (e) {
    if (!isQuotaError(e)) throw e;
    console.warn("Квота превышена, освобождаем место:", e.message);
  }

  const withoutIcons = savedTabs.map(t => ({ ...t, favIconUrl: "" }));
  try {
    await chrome.storage.local.set({ savedTabs: withoutIcons });
    await writeLogUnlocked("Хранилище", "Удалены иконки сохранённых вкладок для экономии места");
    return withoutIcons;
  } catch (e) {
    if (!isQuotaError(e)) throw e;
  }

  const sortedByRecency = withoutIcons.slice().sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  let limit = Math.max(1, Math.floor(sortedByRecency.length / 2));
  while (limit >= 1) {
    const reduced = sortedByRecency.slice(0, limit);
    try {
      await chrome.storage.local.set({ savedTabs: reduced });
      await writeLogUnlocked("Хранилище", `Список урезан до ${limit} самых свежих записей`);
      return reduced;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      limit = Math.floor(limit / 2);
    }
  }

  try {
    await chrome.storage.local.set({ savedTabs: [] });
  } catch (e) {
    console.error("Не удалось сохранить даже пустой список savedTabs:", e);
  }
  await writeLogUnlocked("Хранилище", "Список сохранённых вкладок полностью очищен из-за квоты");
  return [];
}

/**
 * Запись лога БЕЗ захвата мьютекса.
 * Использовать ТОЛЬКО внутри уже захваченного withStorageLock.
 * @param {string} action
 * @param {string} [details=""]
 */
export async function writeLogUnlocked(action, details = "") {
  try {
    const data = await chrome.storage.local.get("logs");
    const logs = data.logs || [];
    logs.unshift({ timestamp: Date.now(), action, details });
    if (logs.length > LOG_MAX_LENGTH) logs.length = LOG_MAX_LENGTH;
    await chrome.storage.local.set({ logs });
  } catch (e) {
    console.error("Log error:", e);
  }
}

/**
 * Запись лога С захватом мьютекса.
 * Использовать из кода, который НЕ находится внутри withStorageLock.
 * @param {string} action
 * @param {string} [details=""]
 */
export async function addLog(action, details = "") {
  return withStorageLock(() => writeLogUnlocked(action, details));
}

/**
 * @returns {Promise<number|undefined>}
 */
export async function incrementTotalFrozenUnlocked() {
  try {
    const data = await chrome.storage.local.get("totalFrozen");
    const total = (data.totalFrozen || 0) + 1;
    await chrome.storage.local.set({ totalFrozen: total });
    return total;
  } catch (e) {
    console.error("Failed to increment totalFrozen:", e);
  }
}

/**
 * @returns {Promise<number|undefined>}
 */
export async function incrementTotalFrozen() {
  return withStorageLock(incrementTotalFrozenUnlocked);
}

/**
 * Инициализирует/восстанавливает настройки и структуры хранилища.
 * @returns {Promise<void>}
 */
export async function ensureSettings() {
  return withStorageLock(async () => {
    try {
      const data = /** @type {import("../types.js").StorageData} */ (await chrome.storage.local.get(["settings", "savedTabs", "logs", "totalFrozen", "tempExemptions"]));
      let changed = false;

      let settings = data.settings;
      if (!settings || typeof settings !== 'object') {
        settings = { ...DEFAULT_SETTINGS };
        changed = true;
      } else {
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          const defaultValue = DEFAULT_SETTINGS[key];
          const currentValue = settings[key];
          let shouldReplace = false;

          if (!(key in settings) || currentValue === null || currentValue === undefined) {
            shouldReplace = true;
          } else {
            if (typeof defaultValue === 'number' && (typeof currentValue !== 'number' || isNaN(currentValue) || currentValue < 1)) {
              shouldReplace = true;
            } else if (typeof defaultValue === 'boolean' && typeof currentValue !== 'boolean') {
              shouldReplace = true;
            } else if (Array.isArray(defaultValue) && !Array.isArray(currentValue)) {
              shouldReplace = true;
            }
          }

          if (shouldReplace) {
            settings[key] = defaultValue;
            changed = true;
          }
        }
      }

      if (changed) {
        await chrome.storage.local.set({ settings });
        console.log("Настройки обновлены/восстановлены:", settings);
        await writeLogUnlocked("Инициализация", "Настройки восстановлены/дополнены");
      } else {
        console.log("Настройки в порядке:", settings);
      }

      if (!data.savedTabs || !Array.isArray(data.savedTabs)) {
        await chrome.storage.local.set({ savedTabs: [] });
        changed = true;
      }
      if (!data.logs || !Array.isArray(data.logs)) {
        await chrome.storage.local.set({ logs: [] });
        changed = true;
      }
      if (typeof data.totalFrozen !== 'number') {
        await chrome.storage.local.set({ totalFrozen: 0 });
        changed = true;
      }
      if (!data.tempExemptions || !Array.isArray(data.tempExemptions)) {
        await chrome.storage.local.set({ tempExemptions: [] });
        changed = true;
      }

      if (changed) {
        console.log("Все хранилища инициализированы");
      }
    } catch (e) {
      console.error("ensureSettings error:", e);
    }
  });
}