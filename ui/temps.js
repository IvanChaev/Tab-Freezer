// ui/temps.js — панель "Временные исключения": активные записи и ручное удаление.

export function initTemps(state, showToast) {
  const { el } = state;

  async function refreshTempExemptions() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "get-temp-exemptions" });
      const exemptions = res.exemptions || [];
      el.countTemp.textContent = exemptions.length;
      const container = el.tempExemptionList;
      container.replaceChildren();

      if (exemptions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'tab-row';
        empty.style.justifyContent = 'center';
        empty.style.color = 'var(--text-muted)';
        empty.textContent = 'Нет активных временных исключений.';
        container.appendChild(empty);
        return;
      }

      const now = Date.now();
      const fragment = document.createDocumentFragment();
      for (const item of exemptions) {
        const row = document.createElement('div');
        row.className = 'tab-row';

        const info = document.createElement('span');
        info.className = 'title';
        const remaining = Math.max(0, Math.round((item.expiry - now) / 60000));
        info.textContent = `${item.domain} (осталось ~${remaining} мин)`;

        const delBtn = document.createElement('button');
        delBtn.className = 'close-btn';
        delBtn.textContent = '✕';
        delBtn.title = 'Удалить исключение';
        delBtn.onclick = async () => {
          await chrome.runtime.sendMessage({ type: "remove-temp-exemption", domain: item.domain });
          refreshTempExemptions();
          showToast(`Исключение для ${item.domain} удалено`);
        };

        row.append(info, delBtn);
        fragment.appendChild(row);
      }
      container.appendChild(fragment);
    } catch (e) {
      console.error("Ошибка загрузки временных исключений:", e);
    }
  }
  state.refreshTempExemptions = refreshTempExemptions;

  document.getElementById('refreshTempBtn').addEventListener('click', refreshTempExemptions);
}
