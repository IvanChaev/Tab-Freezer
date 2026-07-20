const el = {
  timeout: document.getElementById("timeout"),
  excludePinned: document.getElementById("excludePinned"),
  excludeAudio: document.getElementById("excludeAudio"),
  save: document.getElementById("save"),
  status: document.getElementById("status"),
  stats: document.getElementById("stats"),
  
  pageMain: document.getElementById("pageMain"),
  pageList: document.getElementById("pageList"),
  pageWhitelist: document.getElementById("pageWhitelist"),
  pageLogs: document.getElementById("pageLogs"),
  openTabListBtn: document.getElementById("openTabListBtn"),
  backBtn: document.getElementById("backBtn"),
  tabList: document.getElementById("tabList"),
  openWhitelistBtn: document.getElementById("openWhitelistBtn"),
  backFromWhitelistBtn: document.getElementById("backFromWhitelistBtn"),
  whitelistEditor: document.getElementById("whitelistEditor"),
  saveWhitelistBtn: document.getElementById("saveWhitelistBtn"),
  cancelWhitelistBtn: document.getElementById("cancelWhitelistBtn"),
  
  autoClose: document.getElementById("autoClose"),
  closeOldMinutes: document.getElementById("closeOldMinutes"),
  closeOldBtn: document.getElementById("closeOldBtn"),
  
  exportSettingsBtn: document.getElementById("exportSettingsBtn"),
  importSettingsBtn: document.getElementById("importSettingsBtn"),
  
  // Логи
  openLogsBtn: document.getElementById("openLogsBtn"),
  backFromLogsBtn: document.getElementById("backFromLogsBtn"),
  copyLogsBtn: document.getElementById("copyLogsBtn"),
  clearLogsBtn: document.getElementById("clearLogsBtn"),
  logsContainer: document.getElementById("logsContainer")
};

let listVisible = false;
let updateInterval = null;

function formatIdle(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return "< 1 мин";
  if (totalMinutes < 60) return `~${totalMinutes} мин`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `~${hours} ч ${minutes} м` : `~${hours} ч`;
}

function getBadgeInfo(tab) {
  switch (tab.category) {
    case "system":
      return { cls: "system", text: "системная" };
    case "pinned": {
      const prefix = tab.immunePinned ? "📌 закреплена" : "📌 закреплена (без защиты)";
      if (tab.discarded) return { cls: "pinned", text: `${prefix} · спит` };
      return { cls: "pinned", text: prefix };
    }
    case "frozen":
      if (tab.frozenMs && tab.frozenMs > 0) {
        return { cls: "frozen", text: `❄ ${formatIdle(tab.frozenMs)}` };
      }
      return { cls: "frozen", text: "заморожена" };
    case "audio":
      return { cls: "audio", text: "🔊 со звуком" };
    case "whitelist":
      return { cls: "whitelist", text: "★ в белом списке" };
    case "active":
      return { cls: "active", text: "активна" };
    default:
      return { cls: "waiting", text: `${formatIdle(tab.idleMs)}` };
  }
}

function buildTabRow(tab) {
  const row = document.createElement("div");
  row.className = "tabRow";

  if (tab.favIconUrl) {
    const img = document.createElement("img");
    img.src = tab.favIconUrl;
    img.alt = "";
    row.appendChild(img);
  }

  const titleSpan = document.createElement("span");
  titleSpan.className = "tabTitle";
  titleSpan.title = tab.title;
  titleSpan.textContent = tab.title;
  row.appendChild(titleSpan);

  const { cls, text } = getBadgeInfo(tab);
  const badge = document.createElement("span");
  badge.className = `badge ${cls}`;
  badge.textContent = text;
  row.appendChild(badge);

  const closeBtn = document.createElement("button");
  closeBtn.className = "closeTabBtn";
  closeBtn.title = "Закрыть вкладку";
  closeBtn.textContent = "✕";
  
  closeBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    closeBtn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: "close-tab", tabId: tab.id });
      row.remove();
      refreshStats();
    } catch (err) {
      console.error("Ошибка при закрытии вкладки:", err);
    }
  });

  row.appendChild(closeBtn);
  return row;
}

async function refreshTabList() {
  if (!listVisible) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: "get-tab-list" });
    if (res?.error) throw new Error("Ошибка получения списка");
    const tabs = res?.tabs || [];
    el.tabList.replaceChildren();
    if (tabs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tabRow";
      empty.textContent = "Нет открытых вкладок";
      el.tabList.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const tab of tabs) {
      fragment.appendChild(buildTabRow(tab));
    }
    el.tabList.appendChild(fragment);
  } catch (err) {
    el.status.textContent = "Ошибка загрузки списка";
    el.status.classList.add("status-error");
    setTimeout(() => (el.status.textContent = ""), 2000);
  }
}

function startAutoUpdate() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(() => {
    if (listVisible) {
      refreshTabList();
      refreshStats();
    }
  }, 2000);
}
function stopAutoUpdate() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

function showPage(pageId) {
  el.pageMain.hidden = (pageId !== 'main');
  el.pageList.hidden = (pageId !== 'list');
  el.pageWhitelist.hidden = (pageId !== 'whitelist');
  el.pageLogs.hidden = (pageId !== 'logs');
}

el.openTabListBtn.addEventListener("click", () => {
  listVisible = true;
  showPage('list');
  refreshTabList();
  startAutoUpdate();
});

el.backBtn.addEventListener("click", () => {
  listVisible = false;
  showPage('main');
  stopAutoUpdate();
  refreshStats();
});

el.openWhitelistBtn.addEventListener("click", async () => {
  try {
    const settings = await chrome.runtime.sendMessage({ type: "get-settings" });
    if (settings && !settings.error) {
      el.whitelistEditor.value = (settings.whitelist || []).join("\n");
    } else {
      el.whitelistEditor.value = "";
    }
  } catch (e) {
    el.whitelistEditor.value = "";
  }
  showPage('whitelist');
});

el.backFromWhitelistBtn.addEventListener("click", () => showPage('main'));
el.cancelWhitelistBtn.addEventListener("click", () => showPage('main'));

el.saveWhitelistBtn.addEventListener("click", async () => {
  const raw = el.whitelistEditor.value;
  const domains = raw.split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => normalizeDomain(s))
    .filter(Boolean);

  try {
    const currentSettings = await chrome.runtime.sendMessage({ type: "get-settings" });
    if (currentSettings && !currentSettings.error) {
      const newSettings = {
        ...currentSettings,
        whitelist: domains
      };
      const response = await chrome.runtime.sendMessage({ type: "save-settings", settings: newSettings });
      if (response?.ok) {
        el.status.textContent = "Белый список сохранён ✓";
        el.status.classList.remove("status-error");
        showPage('main');
      } else {
        throw new Error("Ошибка сохранения");
      }
    } else {
      throw new Error("Не удалось загрузить настройки");
    }
  } catch (err) {
    el.status.textContent = "Ошибка сохранения белого списка ✗";
    el.status.classList.add("status-error");
  }
  setTimeout(() => (el.status.textContent = ""), 1500);
});

async function loadSettings() {
  try {
    const settings = await chrome.runtime.sendMessage({ type: "get-settings" });
    if (settings?.error) throw new Error("Ошибка загрузки");
    if (settings) {
      el.timeout.value = settings.timeoutMinutes;
      el.closeOldMinutes.value = settings.closeOldMinutes || 120;
      el.autoClose.checked = !!settings.autoClose;
      el.excludePinned.checked = settings.excludePinned;
      el.excludeAudio.checked = settings.excludeAudio;
    }
  } catch (err) {
    el.status.textContent = "Ошибка загрузки настроек";
    el.status.classList.add("status-error");
    setTimeout(() => (el.status.textContent = ""), 2000);
  }
}

async function saveSettings() {
  let timeout = parseInt(el.timeout.value, 10);
  if (isNaN(timeout) || timeout < 1) timeout = 15;

  let closeOld = parseInt(el.closeOldMinutes.value, 10);
  if (isNaN(closeOld) || closeOld < 1) closeOld = 120;

  try {
    const current = await chrome.runtime.sendMessage({ type: "get-settings" });
    const settings = {
      timeoutMinutes: timeout,
      closeOldMinutes: closeOld,
      autoClose: el.autoClose.checked,
      excludePinned: el.excludePinned.checked,
      excludeAudio: el.excludeAudio.checked,
      whitelist: current?.whitelist || []
    };

    const response = await chrome.runtime.sendMessage({ type: "save-settings", settings });
    if (response?.ok) {
      el.status.textContent = "Настройки сохранены ✓";
      el.status.classList.remove("status-error");
    } else {
      throw new Error("Не удалось сохранить");
    }
  } catch (err) {
    el.status.textContent = "Ошибка сохранения ✗";
    el.status.classList.add("status-error");
  }
  setTimeout(() => (el.status.textContent = ""), 1500);
}

async function refreshStats() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "get-stats" });
    if (res?.error) throw new Error("Ошибка статистики");
    if (res) {
      el.stats.textContent = `Сейчас вкладок: ${res.total}, из них заморожено: ${res.discarded}`;
    }
  } catch (err) {
    el.stats.textContent = "Ошибка получения статистики";
  }
}

el.save.addEventListener("click", saveSettings);

el.closeOldBtn.addEventListener("click", async () => {
  let minutes = parseInt(el.closeOldMinutes.value, 10);
  if (isNaN(minutes) || minutes < 1) minutes = 120;

  if (!confirm(`Вы уверены, что хотите безвозвратно закрыть все неактивные вкладки (кроме закреплённых, активной и из белого списка), которые не открывались более ${minutes} мин.?`)) {
    return;
  }

  el.status.textContent = "Очистка вкладок…";
  el.status.classList.remove("status-error");
  try {
    const res = await chrome.runtime.sendMessage({ type: "close-old-tabs", minutes });
    if (res?.error) throw new Error("Ошибка");
    el.status.textContent = `Закрыто вкладок: ${res?.closed ?? 0}`;
    refreshStats();
  } catch (err) {
    el.status.textContent = "Ошибка при закрытии";
    el.status.classList.add("status-error");
  }
  setTimeout(() => (el.status.textContent = ""), 3000);
});

// ---- Экспорт настроек ----
el.exportSettingsBtn.addEventListener('click', async () => {
  try {
    const settings = await chrome.runtime.sendMessage({ type: 'get-settings' });
    if (!settings || settings.error) throw new Error('Не удалось получить настройки');
    
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tab-freezer-settings-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    el.status.textContent = 'Настройки экспортированы ✓';
    el.status.classList.remove('status-error');
  } catch (err) {
    el.status.textContent = 'Ошибка экспорта ✗';
    el.status.classList.add('status-error');
  }
  setTimeout(() => (el.status.textContent = ''), 3000);
});

// ---- Импорт настроек ----
el.importSettingsBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('import.html') });
});

// ---- Работа с логами ----
let currentLogsData = [];

async function refreshLogs() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "get-logs" });
    currentLogsData = res?.logs || [];
    el.logsContainer.replaceChildren();

    if (currentLogsData.length === 0) {
      el.logsContainer.innerHTML = '<div class="log-item" style="text-align:center; opacity:0.6;">Журнал пуст</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of currentLogsData) {
      const div = document.createElement("div");
      div.className = "log-item";
      
      const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      div.innerHTML = `
        <div><span class="log-time">[${timeStr}]</span><span class="log-action">${item.action}</span></div>
        ${item.details ? `<div class="log-details">${item.details}</div>` : ''}
      `;
      fragment.appendChild(div);
    }
    el.logsContainer.appendChild(fragment);
  } catch (err) {
    el.status.textContent = "Ошибка загрузки логов";
    el.status.classList.add("status-error");
  }
}

el.openLogsBtn.addEventListener("click", () => {
  showPage('logs');
  refreshLogs();
});

el.backFromLogsBtn.addEventListener("click", () => {
  showPage('main');
  refreshStats();
});

el.copyLogsBtn.addEventListener("click", async () => {
  if (!currentLogsData.length) return;
  
  const text = currentLogsData.map(l => {
    const time = new Date(l.timestamp).toLocaleString();
    return `[${time}] [${l.action}] ${l.details || ''}`;
  }).join("\n");

  try {
    await navigator.clipboard.writeText(text);
    el.status.textContent = "Логи скопированы в буфер обмена ✓";
    el.status.classList.remove("status-error");
  } catch (err) {
    el.status.textContent = "Не удалось скопировать ✗";
    el.status.classList.add("status-error");
  }
  setTimeout(() => (el.status.textContent = ""), 2500);
});

el.clearLogsBtn.addEventListener("click", async () => {
  if (!confirm("Очистить всю историю событий в журнале?")) return;
  try {
    await chrome.runtime.sendMessage({ type: "clear-logs" });
    await refreshLogs();
    el.status.textContent = "Журнал очищен ✓";
    el.status.classList.remove("status-error");
  } catch (err) {
    el.status.textContent = "Ошибка очистки";
    el.status.classList.add("status-error");
  }
  setTimeout(() => (el.status.textContent = ""), 2000);
});

// ---- Инициализация ----
loadSettings();
refreshStats();
showPage('main');

window.addEventListener("unload", () => {
  stopAutoUpdate();
});