// ui/stats.js — компактная статистика в шапке и подробная панель "Статистика".

export function initStats(state) {
  const { el } = state;

  async function refreshStats() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "get-stats" });
      if (res) {
        el.stats.textContent =
          `Вкладок: ${res.total} | В заморозке: ${res.discarded} | Сохранено: ${res.saved ?? 0}`;
      }
    } catch (e) {
      console.error("Ошибка обновления статистики:", e);
    }
  }
  state.refreshStats = refreshStats;

  async function refreshStatsPanel() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "get-stats" });
      if (res && res.totalFrozen !== undefined) {
        el.totalFrozenCount.textContent = res.totalFrozen;
        // Грубая оценка: ~50 МБ на каждую "сэкономленную" вкладку.
        const savedMemory = res.totalFrozen * 50;
        el.totalSavedMemory.textContent = '~' + savedMemory; // ← добавлен знак приблизительности
      }
    } catch (e) {
      console.error("Ошибка загрузки панели статистики:", e);
    }
  }
  state.refreshStatsPanel = refreshStatsPanel;

  document.getElementById('refreshStatsBtn').addEventListener('click', refreshStatsPanel);
}