// bg/freeze.js — основная бизнес-логика "заморозки"
import { DEFAULT_SETTINGS, isSystemUrl } from "../shared.js";
import {
  withStorageLock,
  persistSavedTabs,
  writeLogUnlocked,
  incrementTotalFrozenUnlocked
} from "./storage.js";
import { isTempExempted } from "./temp.js";
import { isTabAudibleWithBuffer } from "./audio-cache.js";
import {
  getLastActiveTime,
  waitForActivityReadiness
} from "./activity.js";

const ALARM_NAME = "check-tabs";
export { ALARM_NAME };

const PROTECTED_SYSTEM_URLS = [
  "chrome://extensions",
  "chrome://settings",
  "edge://extensions",
  "edge://settings",
  "about:preferences"
];

function isWhitelisted(hostname, whitelist) {
  if (!hostname || !Array.isArray(whitelist) || whitelist.length === 0) {
    return false;
  }

  const host = hostname.toLowerCase();

  return whitelist.some(domain => {
    if (!domain) return false;
    return host === domain || host.endsWith("." + domain);
  });
}

function makeSavedEntry(tab, now) {
  return {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(now) + Math.random().toString(36).substring(2, 10),
    url: tab.url,
    title: tab.title || tab.url,
    favIconUrl: tab.favIconUrl || "",
    closedAt: now
  };
}

/**
 * Черновая проверка пригодности вкладки к заморозке.
 *
 * ВАЖНО:
 * Эта проверка работает по снэпшоту вкладок из chrome.tabs.query({}).
 * Она может немного устареть к моменту реального действия, поэтому перед
 * discard/remove делается ещё одна свежая проверка через chrome.tabs.get(tab.id).
 *
 * getCurrentActiveTabId() здесь намеренно НЕ используется.
 * Источник правды — браузерное состояние вкладки, особенно свежий tab.active.
 */
async function isEligibleForFreeze(tab, settings) {
  if (tab.active) return false;
  if (!tab.url) return false;

  // Страницы самого расширения защищены всегда.
  if (tab.url.startsWith(chrome.runtime.getURL(""))) return false;

  const isSystem = isSystemUrl(tab.url);

  if (isSystem) {
    if (PROTECTED_SYSTEM_URLS.some(prefix => tab.url.startsWith(prefix))) {
      return false;
    }

    if (!settings.fullFreezeSystemPages) return false;

    const allowed = Array.isArray(settings.systemFreezeList)
      ? settings.systemFreezeList
      : [];

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

/**
 * Внешняя точка входа для проверки заморозки.
 *
 * waitForActivityReadiness() вызывается ВНЕ storage mutex, чтобы не держать
 * мьютекс во время ожидания готовности activity tracking.
 */
export async function runFreezeCheck(reason = "alarm") {
  const activityReady = await waitForActivityReadiness();

  if (!activityReady) {
    console.warn(
      "Activity tracking не готов вовремя, пропускаем эту проверку заморозки:",
      reason
    );

    await withStorageLock(() =>
      writeLogUnlocked(
        "Проверка",
        `Пропущена (${reason}): activity tracking не готов вовремя`
      )
    );

    return 0;
  }

  const frozenCount = await withStorageLock(() => runFreezeCheckInner(reason));

  if (frozenCount > 0) {
    try {
      chrome.runtime.sendMessage({ type: "freeze-done" }).catch(() => {});
    } catch (e) {
      // Панель управления может быть закрыта — игнорируем.
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

    await writeLogUnlocked(
      "Проверка",
      `Причина: ${reason}. Тайм-аут: ${settings.timeoutMinutes} мин. ` +
      `Полная заморозка: ${settings.aggressiveFreeze ? "да" : "нет"}`
    );

    // Автоочистка старых сохранённых вкладок.
    if (settings.autoClose && settings.closeOldMinutes > 0) {
      const maxAgeMs = settings.closeOldMinutes * 60 * 1000;
      const before = savedTabs.length;

      const filtered = savedTabs.filter(t => (now - t.closedAt) <= maxAgeMs);

      if (filtered.length !== before) {
        savedTabs.length = 0;
        savedTabs.push(...filtered);
        savedTabsChanged = true;

        await writeLogUnlocked(
          "Автоочистка",
          `Удалено устаревших: ${before - filtered.length}`
        );
      }
    }

    const tabs = await chrome.tabs.query({});

    let candidates = 0;
    let frozenThisRun = 0;

    for (const tab of tabs) {
      // Черновая проверка по снэпшоту.
      if (!(await isEligibleForFreeze(tab, settings))) {
        continue;
      }

      candidates++;

      const lastActiveTime = getLastActiveTime(tab);

      if ((now - lastActiveTime) <= timeoutMs) {
        continue;
      }

      // ─── Свежая проверка прямо перед действием ───
      // Пока цикл шёл по другим вкладкам, пользователь мог переключиться
      // именно на эту вкладку. Поэтому перед discard/remove запрашиваем
      // актуальное состояние у браузера.
      let freshTab;

      try {
        freshTab = await chrome.tabs.get(tab.id);
      } catch {
        // Вкладку уже закрыли — пропускаем.
        continue;
      }

      // Главная защита от закрытия/выгрузки активной вкладки.
      if (freshTab.active) {
        continue;
      }

      // Если вкладка уже выгружена и полная заморозка выключена — делать нечего.
      if (freshTab.discarded && !settings.aggressiveFreeze) {
        await writeLogUnlocked(
          "Заморозка",
          `Пропущена (уже выгружена ранее): ${freshTab.title || freshTab.url}`
        );
        continue;
      }

      // Повторная проверка по свежему табу.
      // Защищает от случаев, когда за время цикла изменились:
      // - URL;
      // - pinned;
      // - audible;
      // - whitelist;
      // - временные исключения;
      // - системные страницы.
      if (!(await isEligibleForFreeze(freshTab, settings))) {
        continue;
      }

      const isSystem = isSystemUrl(freshTab.url);
      const useAggressive = isSystem || settings.aggressiveFreeze;

      if (useAggressive) {
        try {
          await chrome.tabs.remove(freshTab.id);

          savedTabs.unshift(makeSavedEntry(freshTab, now));
          savedTabsChanged = true;
          frozenThisRun++;

          await incrementTotalFrozenUnlocked();
          await writeLogUnlocked(
            "Полная заморозка",
            `Закрыта: ${freshTab.title || freshTab.url}`
          );
        } catch (err) {
          await writeLogUnlocked(
            "Ошибка",
            `Не удалось закрыть ${freshTab.id}: ${err.message}`
          );
        }
      } else {
        try {
          // Дополнительная страховка: если вкладка стала discarded между
          // предыдущей проверкой и этим моментом.
          if (freshTab.discarded) {
            await writeLogUnlocked(
              "Заморозка",
              `Пропущена (уже выгружена ранее): ${freshTab.title || freshTab.url}`
            );
          } else {
            await chrome.tabs.discard(freshTab.id);

            frozenThisRun++;

            await incrementTotalFrozenUnlocked();
            await writeLogUnlocked(
              "Заморозка",
              `Выгружена: ${freshTab.title || freshTab.url}`
            );
          }
        } catch (err) {
          await writeLogUnlocked(
            "Ошибка",
            `Не удалось выгрузить ${freshTab.id}: ${err.message}`
          );
        }
      }
    }

    if (frozenThisRun === 0) {
      await writeLogUnlocked(
        "Проверка",
        `Кандидатов: ${candidates}, никто не подошёл.`
      );
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