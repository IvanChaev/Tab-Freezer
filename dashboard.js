// dashboard.js — исправленная версия с добавленным экспортом/импортом настроек

const DEFAULT_SETTINGS = {
  timeoutMinutes: 15,
  closeOldMinutes: 120,
  autoClose: true,
  excludePinned: true,
  excludeAudio: true,
  aggressiveFreeze: false,
  whitelist: []
};

document.addEventListener("DOMContentLoaded", () => {
  const versionEl = document.getElementById("version");
  if (versionEl) {
    try {
      versionEl.textContent = "v" + chrome.runtime.getManifest().version;
    } catch (e) {
      versionEl.textContent = "";
    }
  }

  const el = {
    tabs: document.querySelectorAll('.nav-tab'),
    panes: document.querySelectorAll('.tab-pane'),
    savedList: document.getElementById('savedList'),
    tabList: document.getElementById('tabList'),
    logsContainer: document.getElementById('logsContainer'),
    whitelistEditor: document.getElementById('whitelistEditor'),
    stats: document.getElementById('stats'),
    countSaved: document.getElementById('countSaved'),
    countActive: document.getElementById('countActive'),
    countTemp: document.getElementById('countTemp'),
    toast: document.getElementById('toast'),
    timeout: document.getElementById('timeout'),
    excludePinned: document.getElementById('excludePinned'),
    excludeAudio: document.getElementById('excludeAudio'),
    aggressiveFreeze: document.getElementById('aggressiveFreeze'),
    autoClose: document.getElementById('autoClose'),
    closeOldMinutes: document.getElementById('closeOldMinutes'),
    totalFrozenCount: document.getElementById('totalFrozenCount'),
    totalSavedMemory: document.getElementById('totalSavedMemory'),
    tempExemptionList: document.getElementById('tempExemptionList')
  };

  // ---- Функция нормализации домена (полностью соответствует background.js) ----
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

  let currentSortSaved = 'real';
  let currentSortTabs = 'real';
  let savedTabsCache = [];
  let openTabsCache = [];

  function isSystemUrl(url) {
    if (!url) return false;
    return url.startsWith("chrome://") ||
           url.startsWith("edge://") ||
           url.startsWith("about:") ||
           url.startsWith("chrome-extension://") ||
           url.startsWith("moz-extension://") ||
           url.startsWith(chrome.runtime.getURL(""));
  }

  function formatDuration(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60) return `0:${String(totalSec).padStart(2, "0")}`;
    const days = Math.floor(totalSec / 86400);
    if (days >= 1) return `${days} дн.`;
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    return `${minutes}:${pad(seconds)}`;
  }

  const tabTimerRefs = new Map();
  const savedTimerRefs = new Map();

  function updateTabBadge(badge, tab, now) {
    if (tab.active) {
      badge.textContent = "● Активна";
      return;
    }
    if (isSystemUrl(tab.url)) {
      badge.textContent = "Системная";
      return;
    }
    const last = typeof tab.lastAccessed === "number" ? tab.lastAccessed : now;
    const text = formatDuration(now - last);
    badge.textContent = tab.discarded ? `❄ ${text}` : `⏱ ${text}`;
  }

  function sortSavedTabs(saved, mode) {
    if (mode === 'real') return saved.slice();
    const now = Date.now();
    const list = saved.slice();
    if (mode === 'alphabet') {
      list.sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url));
    } else if (mode === 'state') {
      list.sort((a, b) => {
        const aSystem = isSystemUrl(a.url);
        const bSystem = isSystemUrl(b.url);
        if (aSystem && !bSystem) return 1;
        if (!aSystem && bSystem) return -1;
        const aTime = a.closedAt ? (now - a.closedAt) : 0;
        const bTime = b.closedAt ? (now - b.closedAt) : 0;
        return aTime - bTime;
      });
    }
    return list;
  }

  function sortOpenTabs(tabs, mode) {
    if (mode === 'real') return tabs.slice();
    const now = Date.now();
    const list = tabs.slice();
    if (mode === 'alphabet') {
      list.sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url));
    } else if (mode === 'state') {
      list.sort((a, b) => {
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        if (!a.discarded && b.discarded) return -1;
        if (a.discarded && !b.discarded) return 1;
        const aTime = a.active ? 0 : (now - (a.lastAccessed || now));
        const bTime = b.active ? 0 : (now - (b.lastAccessed || now));
        return aTime - bTime;
      });
    }
    return list;
  }

  function showToast(message, isError = false) {
    el.toast.textContent = message;
    el.toast.style.backgroundColor = isError ? 'var(--danger)' : 'var(--accent)';
    el.toast.classList.add('show');
    setTimeout(() => el.toast.classList.remove('show'), 3000);
  }

  // ---- Экспорт настроек ----
  async function exportSettings() {
    try {
      const data = await chrome.storage.local.get(['settings', 'totalFrozen']);
      const exportData = {
        version: chrome.runtime.getManifest().version,
        exportedAt: new Date().toISOString(),
        settings: data.settings || {},
        totalFrozen: data.totalFrozen || 0
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tab-freezer-settings-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Настройки экспортированы');
    } catch (e) {
      console.error(e);
      showToast('Ошибка экспорта', true);
    }
  }

  // ---- Импорт настроек ----
  async function importSettings(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.settings || typeof data.settings !== 'object') {
        throw new Error('Неверный формат: отсутствуют settings');
      }
      const mergedSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      if (!Array.isArray(mergedSettings.whitelist)) {
        mergedSettings.whitelist = [];
      }
      const totalFrozen = typeof data.totalFrozen === 'number' ? data.totalFrozen : 0;

      if (!confirm(`Импортировать настройки от ${data.exportedAt || 'неизвестной даты'}? Текущие настройки будут перезаписаны.`)) {
        return;
      }

      await chrome.storage.local.set({
        settings: mergedSettings,
        totalFrozen: totalFrozen
      });

      // Обновляем интерфейс
      await loadSettings();
      await loadWhitelist();
      await refreshStatsPanel();
      await refreshStats();
      showToast('Настройки импортированы');
    } catch (e) {
      console.error(e);
      showToast('Ошибка импорта: ' + e.message, true);
    }
  }

  // ---- Навигация по вкладкам ----
  el.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      el.tabs.forEach(t => t.classList.remove('active'));
      el.panes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const targetId = tab.dataset.target;
      document.getElementById(targetId).classList.add('active');
      if (targetId === 'tab-saved') refreshSavedList();
      if (targetId === 'tab-list') refreshTabList();
      if (targetId === 'tab-logs') refreshLogs();
      if (targetId === 'tab-whitelist') loadWhitelist();
      if (targetId === 'tab-stats') refreshStatsPanel();
      if (targetId === 'tab-temp-exemptions') refreshTempExemptions();
    });
  });

  function renderSavedList() {
    const searchText = document.getElementById('savedSearch')?.value.toLowerCase() || '';
    let filtered = savedTabsCache;
    if (searchText) {
      filtered = filtered.filter(entry => {
        const title = (entry.title || entry.url).toLowerCase();
        const url = (entry.url || '').toLowerCase();
        return title.includes(searchText) || url.includes(searchText);
      });
    }
    const sortedList = sortSavedTabs(filtered, currentSortSaved);
    el.countSaved.textContent = sortedList.length;
    el.savedList.replaceChildren();
    savedTimerRefs.clear();

    if (sortedList.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tab-row';
      empty.style.justifyContent = 'center';
      empty.style.color = 'var(--text-muted)';
      empty.textContent = searchText ? 'Нет совпадений' : 'Список пуст. Здесь появятся агрессивно закрытые вкладки.';
      el.savedList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    const now = Date.now();
    for (const entry of sortedList) {
      const row = document.createElement("a");
      row.className = "tab-row";
      row.href = entry.url;
      row.title = `Кликните, чтобы открыть: ${entry.url}`;

      const img = document.createElement("img");
      img.src = entry.favIconUrl || "icons/snowflake-16.png";
      img.onerror = () => { img.src = "icons/snowflake-16.png"; };

      const title = document.createElement("span");
      title.className = "title";
      title.textContent = entry.title || entry.url;

      const isSystem = isSystemUrl(entry.url);
      const badge = document.createElement("span");
      badge.className = "badge frozen";
      if (isSystem) {
        badge.textContent = "Системная";
      } else {
        const closedAt = typeof entry.closedAt === "number" ? entry.closedAt : now;
        badge.textContent = `❄ ${formatDuration(now - closedAt)}`;
      }
      savedTimerRefs.set(entry.id, { badge, closedAt: entry.closedAt, isSystem });

      const delBtn = document.createElement("button");
      delBtn.className = "close-btn";
      delBtn.textContent = "✕";
      delBtn.title = "Удалить из списка без открытия";
      delBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await chrome.runtime.sendMessage({ type: "delete-saved-frozen-tab", id: entry.id });
        await refreshSavedList();
      };

      row.append(img, title, badge, delBtn);
      row.onclick = async (e) => {
        if (e.target === delBtn) return;
        e.preventDefault();
        await chrome.runtime.sendMessage({ type: "open-saved-frozen-tab", id: entry.id });
        await refreshSavedList();
      };

      fragment.appendChild(row);
    }
    el.savedList.appendChild(fragment);
  }

  async function refreshSavedList() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "get-saved-frozen-tabs" });
      savedTabsCache = res?.tabs || [];
      renderSavedList();
    } catch (err) {
      console.error("Ошибка загрузки сохранённых:", err);
    }
  }

  document.getElementById('clearSavedBtn').addEventListener('click', async () => {
    if (!confirm("Очистить весь список сохранённых закрытых вкладок?")) return;
    await chrome.runtime.sendMessage({ type: "clear-saved-frozen-tabs" });
    await refreshSavedList();
    showToast("Список очищен");
  });

  function renderTabList() {
    const searchText = document.getElementById('tabsSearch')?.value.toLowerCase() || '';
    let filtered = openTabsCache;
    if (searchText) {
      filtered = filtered.filter(tab => {
        const title = (tab.title || '').toLowerCase();
        const url = (tab.url || '').toLowerCase();
        return title.includes(searchText) || url.includes(searchText);
      });
    }
    const sortedTabs = sortOpenTabs(filtered, currentSortTabs);
    el.countActive.textContent = sortedTabs.length;
    el.tabList.replaceChildren();
    tabTimerRefs.clear();

    if (sortedTabs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tab-row';
      empty.style.justifyContent = 'center';
      empty.style.color = 'var(--text-muted)';
      empty.textContent = searchText ? 'Нет совпадений' : 'Нет открытых вкладок';
      el.tabList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    const now = Date.now();
    for (const tab of sortedTabs) {
      const row = document.createElement("div");
      row.className = "tab-row";
      row.style.cursor = "pointer";
      row.title = `Кликните, чтобы перейти на вкладку: ${tab.title}`;

      const img = document.createElement("img");
      img.src = tab.favIconUrl || "";
      img.onerror = () => { img.src = "icons/snowflake-16.png"; };

      const title = document.createElement("span");
      title.className = "title";
      title.textContent = tab.title;

      const badge = document.createElement("span");
      badge.className = `badge ${tab.discarded ? 'frozen' : ''}`;
      updateTabBadge(badge, tab, now);
      tabTimerRefs.set(tab.id, { badge, tab });

      const tempBtn = document.createElement("button");
      tempBtn.textContent = "⏱";
      tempBtn.title = "Временно игнорировать этот сайт";
      tempBtn.style.cssText = "background:transparent; border:none; color:var(--accent); cursor:pointer; font-size:0.9rem; padding:0 4px;";
      tempBtn.onclick = async (e) => {
        e.stopPropagation();
        const duration = prompt("Введите время в минутах (15, 60, 120, 240, 1440):", "60");
        if (!duration) return;
        const minutes = parseInt(duration, 10);
        if (isNaN(minutes) || minutes <= 0) {
          showToast("Некорректное значение", true);
          return;
        }
        try {
          const hostname = new URL(tab.url).hostname;
          const domain = normalizeDomain(hostname);
          if (!domain) {
            showToast("Не удалось определить домен", true);
            return;
          }
          await chrome.runtime.sendMessage({ type: "add-temp-exemption", domain, durationMinutes: minutes });
          showToast(`Домен ${domain} игнорируется ${minutes} мин.`);
          refreshTempExemptions();
        } catch (err) {
          showToast("Ошибка добавления исключения", true);
        }
      };

      const closeBtn = document.createElement("button");
      closeBtn.className = "close-btn";
      closeBtn.textContent = "✕";
      closeBtn.title = "Закрыть вкладку";
      closeBtn.onclick = async (e) => {
        e.stopPropagation();
        await chrome.runtime.sendMessage({ type: "close-tab", tabId: tab.id });
        await refreshTabList();
        refreshStats();
      };

      row.append(img, title, badge, tempBtn, closeBtn);

      row.onclick = async (e) => {
        if (e.target === closeBtn || e.target === tempBtn) return;
        await chrome.runtime.sendMessage({ type: "activate-tab", tabId: tab.id, windowId: tab.windowId });
      };

      fragment.appendChild(row);
    }
    el.tabList.appendChild(fragment);
  }

  async function refreshTabList() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "get-tab-list" });
      openTabsCache = res?.tabs || [];
      renderTabList();
    } catch (err) {
      console.error("Ошибка загрузки вкладок:", err);
    }
  }

  document.getElementById('freezeAllBtn').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: "freeze-now" });
    showToast(`Обработано вкладок: ${res?.frozen || 0}`);
    await refreshTabList();
    refreshStats();
  });

  const SETTINGS_KEYS = [
    "timeoutMinutes", "closeOldMinutes", "autoClose",
    "excludePinned", "excludeAudio", "whitelist",
    "aggressiveFreeze"
  ];

  function pickSettings(obj) {
    const out = {};
    for (const k of SETTINGS_KEYS) out[k] = obj?.[k];
    return out;
  }

  async function loadSettings() {
    try {
      const settings = await chrome.runtime.sendMessage({ type: "get-settings" });
      console.log("Загружены настройки:", settings);
      if (settings && !settings.error) {
        const defaults = { timeoutMinutes: 15, closeOldMinutes: 120, autoClose: true, excludePinned: true, excludeAudio: true, aggressiveFreeze: false };
        el.timeout.value = settings.timeoutMinutes ?? defaults.timeoutMinutes;
        el.closeOldMinutes.value = settings.closeOldMinutes ?? defaults.closeOldMinutes;
        el.autoClose.checked = !!settings.autoClose;
        el.excludePinned.checked = !!settings.excludePinned;
        el.excludeAudio.checked = !!settings.excludeAudio;
        el.aggressiveFreeze.checked = !!settings.aggressiveFreeze;
      } else {
        console.warn("Настройки не получены, используем стандартные");
        el.timeout.value = 15;
        el.closeOldMinutes.value = 120;
        el.autoClose.checked = true;
        el.excludePinned.checked = true;
        el.excludeAudio.checked = true;
        el.aggressiveFreeze.checked = false;
      }
    } catch (e) {
      console.error("Ошибка загрузки настроек:", e);
    }
  }

  async function saveSettings() {
    try {
      const current = await chrome.runtime.sendMessage({ type: "get-settings" });
      const newSettings = {
        ...pickSettings(current),
        timeoutMinutes: parseInt(el.timeout.value, 10) || 15,
        closeOldMinutes: parseInt(el.closeOldMinutes.value, 10) || 120,
        autoClose: el.autoClose.checked,
        excludePinned: el.excludePinned.checked,
        excludeAudio: el.excludeAudio.checked,
        aggressiveFreeze: el.aggressiveFreeze.checked
      };
      const res = await chrome.runtime.sendMessage({ type: "save-settings", settings: newSettings });
      if (res?.ok) showToast("Настройки успешно сохранены");
    } catch (e) {
      console.error("Ошибка сохранения настроек:", e);
      showToast("Ошибка сохранения", true);
    }
  }

  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  el.aggressiveFreeze.addEventListener('change', saveSettings);
  el.autoClose.addEventListener('change', saveSettings);

  // ---- Обработчики экспорта/импорта ----
  document.getElementById('exportSettingsBtn').addEventListener('click', exportSettings);
  document.getElementById('importSettingsBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });
  document.getElementById('importFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importSettings(file);
      e.target.value = ''; // сброс для повторного выбора
    }
  });

  async function loadWhitelist() {
    try {
      const settings = await chrome.runtime.sendMessage({ type: "get-settings" });
      el.whitelistEditor.value = (settings?.whitelist || []).join("\n");
    } catch (e) {
      console.error("Ошибка загрузки белого списка:", e);
    }
  }

  document.getElementById('saveWhitelistBtn').addEventListener('click', async () => {
    const domains = el.whitelistEditor.value
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);

    try {
      const current = await chrome.runtime.sendMessage({ type: "get-settings" });
      const newSettings = { ...pickSettings(current), whitelist: domains };
      const res = await chrome.runtime.sendMessage({ type: "save-settings", settings: newSettings });
      if (res?.ok) showToast("Белый список обновлён");
    } catch (e) {
      console.error("Ошибка сохранения белого списка:", e);
      showToast("Ошибка сохранения", true);
    }
  });

  // ---- Временные исключения ----
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

  document.getElementById('refreshTempBtn').addEventListener('click', refreshTempExemptions);

  // ---- Журнал ----
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

  document.getElementById('clearLogsBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: "clear-logs" });
    refreshLogs();
    showToast("Журнал очищен");
  });

  // ---- Общая статистика ----
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

  // ---- Панель статистики ----
  async function refreshStatsPanel() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "get-stats" });
      if (res && res.totalFrozen !== undefined) {
        el.totalFrozenCount.textContent = res.totalFrozen;
        const savedMemory = res.totalFrozen * 50;
        el.totalSavedMemory.textContent = savedMemory;
      }
    } catch (e) {
      console.error("Ошибка загрузки панели статистики:", e);
    }
  }

  function tickTimers() {
    const now = Date.now();
    for (const { badge, tab } of tabTimerRefs.values()) {
      updateTabBadge(badge, tab, now);
    }
    for (const { badge, closedAt, isSystem } of savedTimerRefs.values()) {
      if (isSystem) {
        badge.textContent = "Системная";
      } else {
        badge.textContent = `❄ ${formatDuration(now - closedAt)}`;
      }
    }
  }

  // ---- Сортировки и поиск ----
  document.getElementById('savedSortControls').addEventListener('click', (e) => {
    const btn = e.target.closest('.sort-btn');
    if (!btn) return;
    const sort = btn.dataset.sort;
    if (sort === currentSortSaved) return;
    document.querySelectorAll('#savedSortControls .sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSortSaved = sort;
    renderSavedList();
  });

  document.getElementById('tabsSortControls').addEventListener('click', (e) => {
    const btn = e.target.closest('.sort-btn');
    if (!btn) return;
    const sort = btn.dataset.sort;
    if (sort === currentSortTabs) return;
    document.querySelectorAll('#tabsSortControls .sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSortTabs = sort;
    renderTabList();
  });

  document.getElementById('savedSearch').addEventListener('input', renderSavedList);
  document.getElementById('tabsSearch').addEventListener('input', renderTabList);
  document.getElementById('refreshStatsBtn').addEventListener('click', refreshStatsPanel);

  // ---- Запуск ----
  loadSettings();
  refreshSavedList();
  refreshStats();
  refreshStatsPanel();
  refreshTempExemptions();

  // ---- Таймеры ----
  const timerInterval = setInterval(() => {
    const activePane = document.querySelector('.tab-pane.active')?.id;
    if (activePane === 'tab-saved' || activePane === 'tab-list') {
      tickTimers();
    }
    if (activePane === 'tab-temp-exemptions') {
      refreshTempExemptions();
    }
  }, 1000);

  const updateInterval = setInterval(() => {
    refreshStats();
    const activePane = document.querySelector('.tab-pane.active')?.id;
    if (activePane === 'tab-saved') refreshSavedList();
    if (activePane === 'tab-list') refreshTabList();
    if (activePane === 'tab-stats') refreshStatsPanel();
    if (activePane === 'tab-temp-exemptions') refreshTempExemptions();
  }, 5000);

  window.addEventListener('beforeunload', () => {
    if (timerInterval) clearInterval(timerInterval);
    if (updateInterval) clearInterval(updateInterval);
  });
});