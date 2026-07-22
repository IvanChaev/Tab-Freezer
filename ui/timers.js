// ui/timers.js — два периодических таймера, пока страница открыта:
//   1) раз в секунду — пересчитать таймеры "как давно" в активной панели;
//   2) раз в 5 секунд — обновить данные в активной панели из background.

import { formatDuration } from "./dom.js";
import { updateTabBadge } from "./state.js";

export function initTimers(state) {
  // Обёртка: выполняем действие только если страница видима
  function updateIfVisible(callback) {
    if (document.visibilityState === 'visible') {
      callback();
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
  }, 1000);

  const updateInterval = setInterval(() => {
    updateIfVisible(() => {
      state.refreshStats?.();
      // 🆕 Счётчики-бейджи в сайдбаре (countSaved, countActive, countTemp)
      // видны всегда, а не только когда открыта соответствующая панель —
      // поэтому обновляем их данные безусловно, иначе цифра на кнопке
      // "Замороженные" (и аналогичные) "зависает" устаревшей, пока
      // пользователь не откроет эту вкладку вручную.
      state.refreshSavedList?.();
      state.refreshTabList?.();
      state.refreshTempExemptions?.();

      const activePane = document.querySelector('.tab-pane.active')?.id;
      if (activePane === 'tab-stats') state.refreshStatsPanel?.();
    });
  }, 5000);

  window.addEventListener('beforeunload', () => {
    clearInterval(timerInterval);
    clearInterval(updateInterval);
  });
}

function tickTimers(state) {
  const now = Date.now();
  
  // Обновление таймеров для открытых вкладок (используем updateTabBadge)
  for (const { badge, tab } of state.tabTimerRefs.values()) {
    updateTabBadge(badge, tab, now);
  }
  
  // 🔥 ИЗМЕНЕНИЕ: для сохранённых вкладок тоже добавляем префикс "Системная " 
  for (const { badge, closedAt, isSystem } of state.savedTimerRefs.values()) {
    const timeText = formatDuration(now - closedAt);
    badge.textContent = isSystem ? `Системная ❄ ${timeText}` : `❄ ${timeText}`;
  }
}