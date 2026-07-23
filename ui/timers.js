// ui/timers.js — два периодических таймера, пока страница открыта:
//   1) раз в секунду — пересчитать таймеры "как давно" в активной панели;
//   2) раз в 5 секунд — обновить статистику и бейджи-счётчики.

import { formatDuration } from "./dom.js";
import { updateTabBadge } from "./state.js";

export function initTimers(state) {
  const { el } = state;

  // Обёртка: выполняем действие только если страница видима
  function updateIfVisible(callback) {
    if (document.visibilityState === 'visible') {
      callback();
    }
  }

  // ---- Функция обновления только бейджей-счётчиков (без перерисовки списков) ----
  async function updateBadgeCounts() {
    try {
      // Получаем количество сохранённых
      const savedRes = await chrome.runtime.sendMessage({ type: "get-saved-frozen-tabs" });
      if (savedRes && el.countSaved) {
        el.countSaved.textContent = savedRes.tabs?.length ?? 0;
      }
      // Получаем количество временных исключений
      const tempRes = await chrome.runtime.sendMessage({ type: "get-temp-exemptions" });
      if (tempRes && el.countTemp) {
        el.countTemp.textContent = tempRes.exemptions?.length ?? 0;
      }
      // countActive обновляется при перерисовке списка открытых вкладок
    } catch (e) {
      console.error("Ошибка обновления бейджей:", e);
    }
  }

  // ---- Таймер 1: обновление времени в строках (раз в секунду) ----
  const timerInterval = setInterval(() => {
    updateIfVisible(() => {
      const activePane = document.querySelector('.tab-pane.active')?.id;
      if (activePane === 'tab-saved' || activePane === 'tab-list') {
        tickTimers(state);
      }
      // Для панели временных исключений обновляем оставшееся время (перерисовываем список)
      if (activePane === 'tab-temp-exemptions') {
        state.refreshTempExemptions?.();
      }
    });
  }, 1000);

  // ---- Таймер 2: обновление статистики и бейджей (раз в 5 секунд) ----
  const updateInterval = setInterval(() => {
    updateIfVisible(() => {
      state.refreshStats?.();
      updateBadgeCounts();
    });
  }, 5000);

  // ---- Обработчик видимости: при возвращении на страницу обновляем счётчики и статистику ----
  let lastVisibilityUpdate = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const now = Date.now();
      if (now - lastVisibilityUpdate > 5000) {
        lastVisibilityUpdate = now;
        state.refreshStats?.();
        updateBadgeCounts();
      }
    }
  });

  // ---- Очистка при закрытии ----
  window.addEventListener('beforeunload', () => {
    clearInterval(timerInterval);
    clearInterval(updateInterval);
  });
}

function tickTimers(state) {
  const now = Date.now();
  
  // Обновление таймеров для открытых вкладок
  for (const { badge, tab } of state.tabTimerRefs.values()) {
    updateTabBadge(badge, tab, now);
  }
  
  // Обновление таймеров для сохранённых вкладок
  for (const { badge, closedAt, isSystem } of state.savedTimerRefs.values()) {
    const timeText = formatDuration(now - closedAt);
    badge.textContent = isSystem ? `Системная ❄ ${timeText}` : `❄ ${timeText}`;
  }
}