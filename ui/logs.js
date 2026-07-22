// ui/logs.js — панель "Журнал": история событий и её очистка.

export function initLogs(state, showToast) {
  const { el } = state;

  async function refreshLogs() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "get-logs" });
      const logs = res?.logs || [];
      el.logsContainer.replaceChildren();

      if (logs.length === 0) {
        const empty = document.createElement('div');
        empty.style.color = 'var(--text-muted)';
        empty.style.textAlign = 'center';
        empty.textContent = 'Журнал пуст';
        el.logsContainer.appendChild(empty);
        return;
      }

      const fragment = document.createDocumentFragment();
      for (const item of logs) {
        const div = document.createElement("div");
        div.className = "log-item";

        const time = document.createElement("span");
        time.className = "log-time";
        time.textContent = `[${new Date(item.timestamp).toLocaleTimeString()}]`;

        const action = document.createElement("span");
        action.className = "log-action";
        action.textContent = `${item.action}:`;

        const details = document.createElement("span");
        details.textContent = " " + (item.details || "");

        div.append(time, action, details);
        fragment.appendChild(div);
      }
      el.logsContainer.appendChild(fragment);
    } catch (e) {
      console.error("Ошибка загрузки логов:", e);
    }
  }
  state.refreshLogs = refreshLogs;

  document.getElementById('clearLogsBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: "clear-logs" });
    refreshLogs();
    showToast("Журнал очищен");
  });
}
