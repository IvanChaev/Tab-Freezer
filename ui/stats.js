// @ts-check
// ui/stats.js — компактная статистика в шапке и подробная панель "Статистика".

/**
 * @param {import("../types.js").UIState} state
 */
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
      }
    } catch (e) {
      console.error("Ошибка загрузки панели статистики:", e);
    }
  }
  state.refreshStatsPanel = refreshStatsPanel;

  document.getElementById('refreshStatsBtn').addEventListener('click', refreshStatsPanel);
}