// ui/nav.js — переключение между панелями в боковой навигации.
// При переходе на панель дёргает нужный refresh-обработчик из state.

export function initNav(state) {
  const { el } = state;

  el.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      el.tabs.forEach(t => t.classList.remove('active'));
      el.panes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const targetId = tab.dataset.target;
      document.getElementById(targetId).classList.add('active');
      onPaneActivated(state, targetId);
    });
  });
}

function onPaneActivated(state, targetId) {
  switch (targetId) {
    case 'tab-saved':           state.refreshSavedList?.(); break;
    case 'tab-list':            state.refreshTabList?.(); break;
    case 'tab-logs':            state.refreshLogs?.(); break;
    case 'tab-whitelist':       state.loadWhitelist?.(); break;
    case 'tab-stats':           state.refreshStatsPanel?.(); break;
    case 'tab-temp-exemptions': state.refreshTempExemptions?.(); break;
    case 'tab-fullfreeze':      state.loadFullFreezeSettings?.(); break; // 🆕
  }
}