document.addEventListener("DOMContentLoaded", () => {
  const versionEl = document.getElementById("popupVersion");
  if (versionEl) {
    try {
      versionEl.textContent = "v" + chrome.runtime.getManifest().version;
    } catch (e) {
      versionEl.textContent = "";
    }
  }

  // Функция нормализации домена (аналог background.js)
  function normalizeDomain(input) {
    if (typeof input !== "string") return "";
    let d = input.trim().toLowerCase();
    d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    d = d.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
    d = d.replace(/^\.+/, "").replace(/\.+$/, "");
    if (d.startsWith("*.")) d = d.slice(2);
    if (d.startsWith("www.")) d = d.slice(4);
    return d;
  }

  async function loadPopupStats() {
    try {
      const [statsRes, savedRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: "get-stats" }),
        chrome.runtime.sendMessage({ type: "get-saved-frozen-tabs" })
      ]);
      const savedCount = savedRes?.tabs?.length || 0;

      if (statsRes) {
        document.getElementById('popupStats').innerHTML =
          `Всего вкладок: <span>${statsRes.total}</span><br>` +
          `Выгружено в память: <span>${statsRes.discarded}</span><br>` +
          `В списке «Замороженные»: <span>${savedCount}</span>`;
      }
    } catch (e) {
      console.error("Ошибка загрузки статистики:", e);
      document.getElementById('popupStats').textContent = 'Ошибка загрузки';
    }
  }

  // ---- Управление временным исключением для текущего домена ----
  async function updateTempStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        document.getElementById('tempStatus').textContent = "Не удалось определить сайт";
        return;
      }
      let hostname;
      try {
        hostname = new URL(tab.url).hostname;
      } catch {
        document.getElementById('tempStatus').textContent = "Некорректный URL";
        return;
      }
      const domain = normalizeDomain(hostname);
      if (!domain) {
        document.getElementById('tempStatus').textContent = "Не удалось определить домен";
        return;
      }

      const res = await chrome.runtime.sendMessage({ type: "get-temp-exemptions" });
      const exemptions = res.exemptions || [];
      const found = exemptions.find(e => e.domain === domain);
      const statusEl = document.getElementById('tempStatus');

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
      document.getElementById('tempStatus').textContent = "Ошибка загрузки статуса";
    }
  }

  // Добавление временного исключения
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

  // ---- Кнопка заморозки ----
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

  // ---- Открытие панели управления ----
  document.getElementById('openDashboardLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: "open-dashboard" });
  });

  // ---- Инициализация ----
  loadPopupStats();
  updateTempStatus();
});