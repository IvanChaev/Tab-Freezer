import { normalizeDomain } from "./shared.js";

document.addEventListener("DOMContentLoaded", () => {
  const versionEl = document.getElementById("popupVersion");
  if (versionEl) {
    try {
      versionEl.textContent = "v" + chrome.runtime.getManifest().version;
    } catch {
      versionEl.textContent = "";
    }
  }

  // ---- Статистика напрямую (быстро, даже если service worker спит) ----
  async function loadPopupStats() {
    try {
      const [tabs, storage] = await Promise.all([
        chrome.tabs.query({}),
        chrome.storage.local.get(["savedTabs", "totalFrozen"])
      ]);
      const total = tabs.length;
      const discarded = tabs.filter(t => t.discarded).length;
      const saved = (storage.savedTabs || []).length;

      const statsEl = document.getElementById('popupStats');
      statsEl.innerHTML =
        `Всего вкладок: <span>${total}</span><br>` +
        `Выгружено в память: <span>${discarded}</span><br>` +
        `В списке «Замороженные»: <span>${saved}</span>`;
    } catch (e) {
      console.error("Ошибка загрузки статистики:", e);
      document.getElementById('popupStats').textContent = 'Ошибка загрузки';
    }
  }

  // ---- Временное исключение (с таймаутом, чтобы не висеть) ----
  async function updateTempStatus() {
    const statusEl = document.getElementById('tempStatus');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        statusEl.textContent = "Не удалось определить сайт";
        return;
      }
      let hostname;
      try {
        hostname = new URL(tab.url).hostname;
      } catch {
        statusEl.textContent = "Некорректный URL";
        return;
      }
      const domain = normalizeDomain(hostname);
      if (!domain) {
        statusEl.textContent = "Не удалось определить домен";
        return;
      }

      // Запрос с таймаутом 3 секунды
      const res = await Promise.race([
        chrome.runtime.sendMessage({ type: "get-temp-exemptions" }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
      ]);
      const exemptions = res.exemptions || [];
      const found = exemptions.find(e => e.domain === domain);

      if (found) {
        const remaining = Math.max(0, Math.round((found.expiry - Date.now()) / 60000));
        statusEl.innerHTML = `✅ Активно: <strong>${domain}</strong> (осталось ~${remaining} мин) 
          <button class="remove-temp" id="removeTempBtn">Отменить</button>`;
        document.getElementById('removeTempBtn').addEventListener('click', async () => {
          await chrome.runtime.sendMessage({ type: "remove-temp-exemption", domain });
          updateTempStatus();
          loadPopupStats();
        });
      } else {
        statusEl.textContent = `Нет активного исключения для ${domain}.`;
      }
    } catch (e) {
      console.error("Ошибка обновления статуса:", e);
      statusEl.textContent = "⚠️ Не удалось загрузить статус исключений";
    }
  }

  document.getElementById('addTempExemptionBtn').addEventListener('click', async () => {
    const duration = parseInt(document.getElementById('tempDuration').value, 10);
    if (!duration || duration <= 0) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      alert("Не удалось определить текущую вкладку.");
      return;
    }
    let hostname;
    try {
      hostname = new URL(tab.url).hostname;
    } catch {
      alert("Некорректный URL.");
      return;
    }
    const domain = normalizeDomain(hostname);
    if (!domain) {
      alert("Не удалось определить домен.");
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        type: "add-temp-exemption",
        domain,
        durationMinutes: duration
      });
      updateTempStatus();
      loadPopupStats();
    } catch (e) {
      console.error("Ошибка добавления исключения:", e);
      alert("Не удалось добавить исключение.");
    }
  });

  // ---- Заморозка (через background) ----
  const freezeBtn = document.getElementById('freezePopupBtn');
  freezeBtn.addEventListener('click', async () => {
    freezeBtn.disabled = true;
    const originalText = freezeBtn.textContent;
    freezeBtn.textContent = "⏳ Заморозка...";
    try {
      await chrome.runtime.sendMessage({ type: "freeze-now" });
      await loadPopupStats();
    } catch (e) {
      console.error(e);
    } finally {
      freezeBtn.disabled = false;
      freezeBtn.textContent = originalText;
    }
  });

  // ---- Кнопка "Панель управления" ----
  document.getElementById('openDashboardLink').addEventListener('click', async (e) => {
    e.preventDefault();
    await chrome.runtime.sendMessage({ type: "open-dashboard" });
    window.close();
  });

  // ---- Запуск ----
  loadPopupStats();
  updateTempStatus();
});