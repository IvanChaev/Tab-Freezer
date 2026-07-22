// bg/storage.js — слой хранилища chrome.storage.local: мьютекс, обработка квоты,
// инициализация дефолтов и лог. Никакой бизнес-логики "заморозки" — только данные.

import { DEFAULT_SETTINGS } from "../shared.js";

// === ЗАЩИТА ОТ ГОНКИ (race condition) ===
let storageMutex = Promise.resolve();
export function withStorageLock(task) {
  const run = storageMutex.then(task, task);
  storageMutex = run.then(() => {}, () => {});
  return run;
}

// === ЗАЩИТА ОТ ПРЕВЫШЕНИЯ КВОТЫ ===
function isQuotaError(e) {
  const msg = (e && e.message) || String(e || "");
  return /quota/i.test(msg);
}

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

// Запись лога БЕЗ захвата мьютекса. Используется:
//  1) публичной функцией addLog() ниже (оборачивает в withStorageLock);
//  2) кодом, который уже выполняется ВНУТРИ withStorageLock (например,
//     ensureSettings) — вызывать оттуда addLog() напрямую НЕЛЬЗЯ, это
//     приводит к дедлоку мьютекса (повторный withStorageLock изнутри
//     уже выполняющегося withStorageLock-таска).
async function writeLogUnlocked(action, details = "") {
  try {
    const data = await chrome.storage.local.get("logs");
    const logs = data.logs || [];
    logs.unshift({ timestamp: Date.now(), action, details });
    if (logs.length > 100) logs.length = 100;
    await chrome.storage.local.set({ logs });
  } catch (e) {
    console.error("Log error:", e);
  }
}

export async function addLog(action, details = "") {
  return withStorageLock(() => writeLogUnlocked(action, details));
}

async function incrementTotalFrozenUnlocked() {
  try {
    const data = await chrome.storage.local.get("totalFrozen");
    const total = (data.totalFrozen || 0) + 1;
    await chrome.storage.local.set({ totalFrozen: total });
    return total;
  } catch (e) {
    console.error("Failed to increment totalFrozen:", e);
  }
}

// ВАЖНО: freeze.js вызывает incrementTotalFrozenUnlocked() напрямую, а не эту
// функцию — потому что там она выполняется изнутри уже захваченного
// withStorageLock (внутри runFreezeCheck), и повторный withStorageLock здесь
// привёл бы к дедлоку.
export async function incrementTotalFrozen() {
  return withStorageLock(incrementTotalFrozenUnlocked);
}
export { incrementTotalFrozenUnlocked };

// FIX: теперь проверяем не только наличие ключей, но и корректность значений
export async function ensureSettings() {
  return withStorageLock(async () => {
    try {
      const data = await chrome.storage.local.get(["settings", "savedTabs", "logs", "totalFrozen", "tempExemptions"]);
      let changed = false;

      let settings = data.settings;
      if (!settings || typeof settings !== 'object') {
        settings = { ...DEFAULT_SETTINGS };
        changed = true;
      } else {
        // Проверяем все ключи DEFAULT_SETTINGS
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          // FIX: перезаписываем, если ключа нет, или значение null/undefined, или неверный тип
          const defaultValue = DEFAULT_SETTINGS[key];
          const currentValue = settings[key];
          let shouldReplace = false;

          if (!(key in settings) || currentValue === null || currentValue === undefined) {
            shouldReplace = true;
          } else {
            // Проверка типов
            if (typeof defaultValue === 'number' && (typeof currentValue !== 'number' || isNaN(currentValue) || currentValue < 0)) {
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