// ui/timers.js — исправленная функция tickTimers

import { formatDuration } from "./dom.js";
import { updateTabBadge } from "./state.js";

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

  // ✅ ИСПРАВЛЕНИЕ: таймер раз в секунду + принудительное обновление активной вкладки
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
  }, 1000);

  // ✅ НОВОЕ: раз в 3 секунды обновляем кэш вкладок, чтобы tab.active был актуальным.
  // Это гарантирует, что если пользователь переключился на вкладку и вернулся,
  // бейдж перестанет тикать даже без полного перерендера.
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
  }, 3000);

  const updateInterval = setInterval(() => {
    updateIfVisible(() => {
      state.refreshStats?.();
      updateBadgeCounts();
    });
  }, 5000);

  let lastVisibilityUpdate = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const now = Date.now();
      if (now - lastVisibilityUpdate > 5000) {
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