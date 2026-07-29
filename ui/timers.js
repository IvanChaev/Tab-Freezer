// @ts-check
// ui/timers.js — таймеры обновления бейджей и данных

import { formatDuration } from "./dom.js";
import { updateTabBadge } from "./state.js";
import {
  BADGE_TICK_INTERVAL_MS,
  CACHE_REFRESH_INTERVAL_MS,
  STATS_UPDATE_INTERVAL_MS,
  VISIBILITY_THROTTLE_MS,
} from "../shared.js";

/**
 * @param {import("../types.js").UIState} state
 */
export function initTimers(state) {
  const { el } = state;

  function updateIfVisible(callback) {
    if (document.visibilityState === 'visible') {
      callback();
    }
  }

  async function updateBadgeCounts() {
    try {
      const savedRes = await chrome.runtime.sendMessage({ type: "get-saved-frozen-tabs" });
      if (savedRes && el.countSaved) {
        el.countSaved.textContent = savedRes.tabs?.length ?? 0;
      }
      const tempRes = await chrome.runtime.sendMessage({ type: "get-temp-exemptions" });
      if (tempRes && el.countTemp) {
        el.countTemp.textContent = tempRes.exemptions?.length ?? 0;
      }
    } catch (e) {
      console.error("Ошибка обновления бейджей:", e);
    }
  }

  const timerInterval = setInterval(() => {
    updateIfVisible(() => {
      const activePane = document.querySelector('.tab-pane.active')?.id;
      if (activePane === 'tab-saved' || activePane === 'tab-list') {
        tickTimers(state);
      }
      if (activePane === 'tab-temp-exemptions') {
        state.refreshTempExemptions?.();
      }
    });
  }, BADGE_TICK_INTERVAL_MS);

  const cacheRefreshInterval = setInterval(() => {
    updateIfVisible(async () => {
      const activePane = document.querySelector('.tab-pane.active')?.id;
      if (activePane === 'tab-list') {
        try {
          const res = await chrome.runtime.sendMessage({ type: "get-tab-list" });
          if (res?.tabs) {
            // Обновляем кэш и tabTimerRefs актуальными данными
            const freshMap = new Map(res.tabs.map(t => [t.id, t]));
            for (const [tabId, ref] of state.tabTimerRefs) {
              const freshTab = freshMap.get(tabId);
              if (freshTab) {
                ref.tab = freshTab; // ← подменяем на свежий объект
              }
            }
            // Также обновляем основной кэш для сортировки/поиска
            state.openTabsCache = res.tabs;
          }
        } catch (e) {
          // Тихо игнорируем — SW мог уснуть
        }
      }
    });
  }, CACHE_REFRESH_INTERVAL_MS);

  const updateInterval = setInterval(() => {
    updateIfVisible(() => {
      state.refreshStats?.();
      updateBadgeCounts();
    });
  }, STATS_UPDATE_INTERVAL_MS);

  let lastVisibilityUpdate = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const now = Date.now();
      if (now - lastVisibilityUpdate > VISIBILITY_THROTTLE_MS) {
        lastVisibilityUpdate = now;
        state.refreshStats?.();
        updateBadgeCounts();
        // ✅ При возврате на страницу — полное обновление списка вкладок
        state.refreshTabList?.();
        state.refreshSavedList?.();
        state.refreshTempExemptions?.();
      }
    }
  });

  window.addEventListener('beforeunload', () => {
    clearInterval(timerInterval);
    clearInterval(cacheRefreshInterval);
    clearInterval(updateInterval);
  });
}

function tickTimers(state) {
  const now = Date.now();

  for (const { badge, tab } of state.tabTimerRefs.values()) {
    updateTabBadge(badge, tab, now);
  }

  for (const { badge, closedAt, isSystem } of state.savedTimerRefs.values()) {
    const timeText = formatDuration(now - closedAt);
    badge.textContent = isSystem ? `Системная ❄ ${timeText}` : `❄ ${timeText}`;
  }
}