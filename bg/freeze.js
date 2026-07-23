// bg/freeze.js — основная бизнес-логика "заморозки"

import { DEFAULT_SETTINGS, isSystemUrl } from "../shared.js";
import { withStorageLock, persistSavedTabs, writeLogUnlocked, incrementTotalFrozenUnlocked } from "./storage.js";
import { isTempExempted } from "./temp.js";
import { isTabAudibleWithBuffer } from "./audio-cache.js";
import { getLastActiveTime, waitForActivityReadiness } from "./activity.js";

const ALARM_NAME = "check-tabs";
export { ALARM_NAME };

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

async function isEligibleForFreeze(tab, settings) {
  if (tab.active) return false;
  if (!tab.url) return false;

  if (tab.url.startsWith(chrome.runtime.getURL(""))) return false;

  const isSystem = isSystemUrl(tab.url);

  if (isSystem) {
    if (PROTECTED_SYSTEM_URLS.some(prefix => tab.url.startsWith(prefix))) {
      return false;
    }
    if (!settings.fullFreezeSystemPages) return false;
    const allowed = Array.isArray(settings.systemFreezeList) ? settings.systemFreezeList : [];
    if (allowed.length === 0) return false;
    if (!allowed.some(pattern => tab.url.startsWith(pattern))) return false;
    return true;
  }

  if (typeof tab.lastAccessed !== "number") return false;
  if (settings.excludePinned && tab.pinned) return false;

  if (settings.excludeAudio) {
    if (isTabAudibleWithBuffer(tab.id, tab.audible)) {
      return false;
    }
  }

  if (tab.discarded && !settings.aggressiveFreeze) return false;

  try {
    const hostname = new URL(tab.url).hostname;
    if (isWhitelisted(hostname, settings.whitelist)) return false;
    if (await isTempExempted(hostname)) return false;
  } catch {
    return false;
  }
  return true;
}

// ─── ИСПРАВЛЕНИЕ #1: waitForActivityReadiness ВЫНЕСЕНА за пределы мьютекса ───
export async function runFreezeCheck(reason = "alarm") {
  await waitForActivityReadiness(); // ← ждём ВНЕ мьютекса (с таймаутом 5 с)
  const frozenCount = await withStorageLock(() => runFreezeCheckInner(reason));
  
  // ✅ Уведомляем панель управления об изменениях, если была заморозка
  if (frozenCount > 0) {
    try {
      chrome.runtime.sendMessage({ type: "freeze-done" }).catch(() => {});
    } catch (e) {
      // Игнорируем ошибку, если панель не открыта
    }
  }
  
  return frozenCount;
}

async function runFreezeCheckInner(reason = "alarm") {
  try {
    const data = await chrome.storage.local.get(["settings", "savedTabs"]);
    const settings = data.settings || DEFAULT_SETTINGS;
    const savedTabs = data.savedTabs || [];
    const now = Date.now();
    let savedTabsChanged = false;

    const timeoutMs = Math.max(1, settings.timeoutMinutes || 15) * 60 * 1000;

    await writeLogUnlocked("Проверка", `Причина: ${reason}. Тайм-аут: ${settings.timeoutMinutes} мин. Полная заморозка: ${settings.aggressiveFreeze ? "да" : "нет"}`);

    if (settings.autoClose && settings.closeOldMinutes > 0) {
      const maxAgeMs = settings.closeOldMinutes * 60 * 1000;
      const before = savedTabs.length;
      const filtered = savedTabs.filter(t => (now - t.closedAt) <= maxAgeMs);
      if (filtered.length !== before) {
        savedTabs.length = 0;
        savedTabs.push(...filtered);
        savedTabsChanged = true;
        await writeLogUnlocked("Автоочистка", `Удалено устаревших: ${before - filtered.length}`);
      }
    }

    const tabs = await chrome.tabs.query({});
    let candidates = 0, frozenThisRun = 0;

    for (const tab of tabs) {
      if (!(await isEligibleForFreeze(tab, settings))) continue;
      candidates++;

      const lastActiveTime = getLastActiveTime(tab);
      if ((now - lastActiveTime) > timeoutMs) {
        const isSystem = isSystemUrl(tab.url);
        const useAggressive = isSystem || settings.aggressiveFreeze;

        if (useAggressive) {
          try {
            await chrome.tabs.remove(tab.id);
            savedTabs.unshift(makeSavedEntry(tab, now));
            savedTabsChanged = true;
            frozenThisRun++;
            await incrementTotalFrozenUnlocked();
            await writeLogUnlocked("Полная заморозка", `Закрыта: ${tab.title}`);
          } catch (err) {
            await writeLogUnlocked("Ошибка", `Не удалось закрыть ${tab.id}: ${err.message}`);
          }
        } else {
          try {
            const freshTab = await chrome.tabs.get(tab.id);
            if (freshTab.discarded) {
              await writeLogUnlocked("Заморозка", `Пропущена (уже выгружена ранее): ${tab.title}`);
            } else {
              await chrome.tabs.discard(tab.id);
              frozenThisRun++;
              await incrementTotalFrozenUnlocked();
              await writeLogUnlocked("Заморозка", `Выгружена: ${tab.title}`);
            }
          } catch (err) {
            await writeLogUnlocked("Ошибка", `Не удалось выгрузить ${tab.id}: ${err.message}`);
          }
        }
      }
    }

    if (frozenThisRun === 0) {
      await writeLogUnlocked("Проверка", `Кандидатов: ${candidates}, никто не подошёл.`);
    }
    if (savedTabsChanged) {
      await persistSavedTabs(savedTabs);
    }
    return frozenThisRun;
  } catch (err) {
    console.error("Freeze check error:", err);
    await writeLogUnlocked("Ошибка", `Сбой: ${err.message}`);
    return 0;
  }
}