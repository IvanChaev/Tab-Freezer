// bg/freeze.js — основная бизнес-логика "заморозки"

import { DEFAULT_SETTINGS, isSystemUrl } from "../shared.js";
import { withStorageLock, persistSavedTabs, addLog, incrementTotalFrozenUnlocked } from "./storage.js";
import { isTempExempted } from "./temp.js";
import { isTabAudibleWithBuffer } from "./audio-cache.js";

const ALARM_NAME = "check-tabs";
export { ALARM_NAME };

// Защищённые системные страницы, которые нельзя закрывать даже при полной заморозке
const PROTECTED_SYSTEM_URLS = [
  'chrome://extensions',
  'chrome://settings',
  'edge://extensions',
  'edge://settings',
  'about:preferences'
];

function isWhitelisted(hostname, whitelist) {
  if (!hostname || !Array.isArray(whitelist) || whitelist.length === 0) return false;
  const host = hostname.toLowerCase();
  return whitelist.some(domain => {
    if (!domain) return false;
    return host === domain || host.endsWith("." + domain);
  });
}

function makeSavedEntry(tab, now) {
  return {
    id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(now) + Math.random().toString(36).substring(2, 10),
    url: tab.url,
    title: tab.title || tab.url,
    favIconUrl: tab.favIconUrl || "",
    closedAt: now
  };
}

// Основная функция проверки – изменена для поддержки системных страниц и аудио-буфера
async function isEligibleForFreeze(tab, settings) {
  if (tab.active) return false;
  if (!tab.url) return false;

  // 🛡️ Защита самого расширения – всегда запрещено
  if (tab.url.startsWith(chrome.runtime.getURL(""))) return false;

  const isSystem = isSystemUrl(tab.url);

  // Обработка системных страниц
  if (isSystem) {
    // Защита критических системных страниц
    if (PROTECTED_SYSTEM_URLS.some(prefix => tab.url.startsWith(prefix))) {
      return false;
    }
    // Если фича выключена – не трогаем
    if (!settings.fullFreezeSystemPages) return false;
    // Проверяем, есть ли URL в списке разрешённых (сравнение через startsWith)
    const allowed = Array.isArray(settings.systemFreezeList) ? settings.systemFreezeList : [];
    // 🔥 ИСПРАВЛЕНИЕ: если список пуст – разрешаем все системные страницы (кроме защищённых)
    if (allowed.length === 0) return true;
    if (!allowed.some(pattern => tab.url.startsWith(pattern))) return false;
    // Системные проходят проверку, но будут закрыты принудительно (см. runFreezeCheckInner)
    return true;
  }

  // Стандартные проверки для обычных вкладок
  if (typeof tab.lastAccessed !== "number") return false;
  if (settings.excludePinned && tab.pinned) return false;

  // ---- ЗАЩИТА ОТ КРАТКОВРЕМЕННОЙ ПОТЕРИ ЗВУКА ----
  if (settings.excludeAudio) {
    // Используем кеш с буфером 10 секунд после последнего true
    if (isTabAudibleWithBuffer(tab.id, tab.audible)) {
      return false;
    }
  }

  if (tab.discarded && !settings.aggressiveFreeze) return false;  // уже выгружена, полная заморозка выключена — не трогаем
                                                                    // если же полная заморозка включена, такая вкладка
                                                                    // остаётся кандидатом на ЗАКРЫТИЕ (см. useAggressive ниже)

  try {
    const hostname = new URL(tab.url).hostname;
    if (isWhitelisted(hostname, settings.whitelist)) return false;
    if (await isTempExempted(hostname)) return false;
  } catch {
    return false;
  }
  return true;
}

// Обёртка с мьютексом
export function runFreezeCheck(reason = "alarm") {
  return withStorageLock(() => runFreezeCheckInner(reason));
}

async function runFreezeCheckInner(reason = "alarm") {
  try {
    const data = await chrome.storage.local.get(["settings", "savedTabs"]);
    const settings = data.settings || DEFAULT_SETTINGS;
    const savedTabs = data.savedTabs || [];
    const now = Date.now();
    let savedTabsChanged = false;

    const timeoutMs = (settings.timeoutMinutes || 15) * 60 * 1000;
    addLog("Проверка", `Причина: ${reason}. Тайм-аут: ${settings.timeoutMinutes} мин. Полная заморозка: ${settings.aggressiveFreeze ? "да" : "нет"}`);

    // Автоочистка старых записей
    if (settings.autoClose && settings.closeOldMinutes > 0) {
      const maxAgeMs = settings.closeOldMinutes * 60 * 1000;
      const before = savedTabs.length;
      const filtered = savedTabs.filter(t => (now - t.closedAt) <= maxAgeMs);
      if (filtered.length !== before) {
        savedTabs.length = 0;
        savedTabs.push(...filtered);
        savedTabsChanged = true;
        addLog("Автоочистка", `Удалено устаревших: ${before - filtered.length}`);
      }
    }

    const tabs = await chrome.tabs.query({});
    let candidates = 0, frozenThisRun = 0;

    for (const tab of tabs) {
      if (!(await isEligibleForFreeze(tab, settings))) continue;
      candidates++;
      const lastAccessed = typeof tab.lastAccessed === "number" ? tab.lastAccessed : now;
      if ((now - lastAccessed) > timeoutMs) {
        // Определяем, является ли вкладка системной
        const isSystem = isSystemUrl(tab.url);
        // Для системных всегда применяем агрессивное закрытие (т.к. discard недоступен)
        // Для обычных – в зависимости от настройки aggressiveFreeze
        const useAggressive = isSystem || settings.aggressiveFreeze;

        if (useAggressive) {
          // Полное закрытие (удаление вкладки)
          savedTabs.unshift(makeSavedEntry(tab, now));
          savedTabsChanged = true;
          try {
            await chrome.tabs.remove(tab.id);
            frozenThisRun++;
            await incrementTotalFrozenUnlocked();
            addLog("Полная заморозка", `Закрыта: ${tab.title}`);
          } catch (err) {
            addLog("Ошибка", `Не удалось закрыть ${tab.id}: ${err.message}`);
          }
        } else {
          // Обычная выгрузка
          try {
            // 🆕 Перепроверяем состояние вкладки прямо перед выгрузкой
            const freshTab = await chrome.tabs.get(tab.id);
            if (freshTab.discarded) {
              addLog("Заморозка", `Пропущена (уже выгружена ранее): ${tab.title}`);
            } else {
              await chrome.tabs.discard(tab.id);
              frozenThisRun++;
              await incrementTotalFrozenUnlocked();
              addLog("Заморозка", `Выгружена: ${tab.title}`);
            }
          } catch (err) {
            addLog("Ошибка", `Не удалось выгрузить ${tab.id}: ${err.message}`);
          }
        }
      }
    }

    if (frozenThisRun === 0) {
      addLog("Проверка", `Кандидатов: ${candidates}, никто не подошёл.`);
    }
    if (savedTabsChanged) {
      await persistSavedTabs(savedTabs);
    }
    return frozenThisRun;
  } catch (err) {
    console.error("Freeze check error:", err);
    addLog("Ошибка", `Сбой: ${err.message}`);
    return 0;
  }
}