// background.js — финальная версия с усиленной инициализацией

const DEFAULT_SETTINGS = {
  timeoutMinutes: 15,
  closeOldMinutes: 120,
  autoClose: true,
  excludePinned: true,
  excludeAudio: true,
  aggressiveFreeze: false,
  whitelist: []
};

const ALARM_NAME = "check-tabs";

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

function isWhitelisted(hostname, whitelist) {
  if (!hostname || !Array.isArray(whitelist) || whitelist.length === 0) return false;
  const host = hostname.toLowerCase();
  return whitelist.some(domain => {
    if (!domain) return false;
    return host === domain || host.endsWith("." + domain);
  });
}

async function getTempExemptions() {
  const data = await chrome.storage.local.get("tempExemptions");
  return data.tempExemptions || [];
}

async function setTempExemptions(exemptions) {
  await chrome.storage.local.set({ tempExemptions: exemptions });
}

async function isTempExempted(hostname) {
  if (!hostname) return false;
  const exemptions = await getTempExemptions();
  const now = Date.now();
  const active = exemptions.filter(e => e.expiry > now);
  if (active.length !== exemptions.length) {
    await setTempExemptions(active);
  }
  return active.some(e => hostname === e.domain || hostname.endsWith("." + e.domain));
}

async function ensureSettings() {
  try {
    const data = await chrome.storage.local.get(["settings", "savedTabs", "logs", "totalFrozen", "tempExemptions"]);
    let changed = false;

    let settings = data.settings;
    if (!settings || typeof settings !== 'object') {
      console.warn("settings отсутствуют или повреждены, создаём заново");
      settings = { ...DEFAULT_SETTINGS };
      changed = true;
    } else {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!(key in settings)) {
          settings[key] = DEFAULT_SETTINGS[key];
          changed = true;
          console.log(`Добавлено поле ${key} в settings`);
        }
      }
      if (!Array.isArray(settings.whitelist)) {
        settings.whitelist = [];
        changed = true;
      }
    }

    if (changed) {
      await chrome.storage.local.set({ settings });
      console.log("Настройки обновлены:", settings);
      await addLog("Инициализация", "Настройки восстановлены/дополнены");
    } else {
      console.log("Настройки в порядке:", settings);
    }

    if (!data.savedTabs || !Array.isArray(data.savedTabs)) {
      await chrome.storage.local.set({ savedTabs: [] });
      changed = true;
    }
    if (!data.logs || !Array.isArray(data.logs)) {
      await chrome.storage.local.set({ logs: [] });
      changed = true;
    }
    if (typeof data.totalFrozen !== 'number') {
      await chrome.storage.local.set({ totalFrozen: 0 });
      changed = true;
    }
    if (!data.tempExemptions || !Array.isArray(data.tempExemptions)) {
      await chrome.storage.local.set({ tempExemptions: [] });
      changed = true;
    }

    if (changed) {
      console.log("Все хранилища инициализированы");
    }
  } catch (e) {
    console.error("ensureSettings error:", e);
  }
}

async function ensureAlarm() {
  try {
    const existing = await chrome.alarms.get(ALARM_NAME);
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
      addLog("Инициализация", `Создан алярм ${ALARM_NAME}`);
    }
  } catch (e) {
    console.error("ensureAlarm error:", e);
  }
}

async function addLog(action, details = "") {
  try {
    const data = await chrome.storage.local.get("logs");
    const logs = data.logs || [];
    logs.unshift({ timestamp: Date.now(), action, details });
    if (logs.length > 100) logs.length = 100;
    await chrome.storage.local.set({ logs });
  } catch (e) {
    console.error("Log error:", e);
  }
}

async function isEligibleForFreeze(tab, settings) {
  if (tab.active) return false;
  if (!tab.url ||
      tab.url.includes("dashboard.html") ||
      tab.url.startsWith(chrome.runtime.getURL("")) ||
      tab.url.startsWith("chrome-extension://") ||
      tab.url.startsWith("moz-extension://") ||
      tab.url.startsWith("edge://") ||
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("about:")) {
    return false;
  }
  if (typeof tab.lastAccessed !== "number") return false;
  if (!settings.aggressiveFreeze && tab.discarded) return false;
  if (settings.excludePinned && tab.pinned) return false;
  if (settings.excludeAudio && tab.audible) return false;

  try {
    const hostname = new URL(tab.url).hostname;
    if (isWhitelisted(hostname, settings.whitelist)) return false;
    if (await isTempExempted(hostname)) return false;
  } catch (e) {
    return false;
  }
  return true;
}

function makeSavedEntry(tab, now) {
  return {
    id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(now) + Math.random().toString(36).substring(2, 10),
    url: tab.url,
    title: tab.title || tab.url,
    favIconUrl: tab.favIconUrl || "",
    closedAt: now
  };
}

async function incrementTotalFrozen() {
  try {
    const data = await chrome.storage.local.get("totalFrozen");
    const total = (data.totalFrozen || 0) + 1;
    await chrome.storage.local.set({ totalFrozen: total });
    return total;
  } catch (e) {
    console.error("Failed to increment totalFrozen:", e);
  }
}

async function runFreezeCheck(reason = "alarm") {
  try {
    await ensureSettings();
    const data = await chrome.storage.local.get(["settings", "savedTabs"]);
    const settings = data.settings || DEFAULT_SETTINGS;
    const savedTabs = data.savedTabs || [];
    const now = Date.now();
    let savedTabsChanged = false;

    const timeoutMs = (settings.timeoutMinutes || 15) * 60 * 1000;
    addLog("Проверка", `Причина: ${reason}. Тайм-аут: ${settings.timeoutMinutes} мин. Агрессивно: ${settings.aggressiveFreeze ? "да" : "нет"}`);

    if (settings.autoClose && settings.closeOldMinutes > 0) {
      const maxAgeMs = settings.closeOldMinutes * 60 * 1000;
      const before = savedTabs.length;
      const filtered = savedTabs.filter(t => (now - t.closedAt) <= maxAgeMs);
      if (filtered.length !== before) {
        savedTabs.length = 0;
        savedTabs.push(...filtered);
        savedTabsChanged = true;
        addLog("Автоочистка", `Удалено устаревших: ${before - filtered.length}`);
      }
    }

    const tabs = await chrome.tabs.query({});
    let candidates = 0, frozenThisRun = 0;
    for (const tab of tabs) {
      if (!(await isEligibleForFreeze(tab, settings))) continue;
      candidates++;
      if ((now - tab.lastAccessed) > timeoutMs) {
        if (settings.aggressiveFreeze) {
          savedTabs.unshift(makeSavedEntry(tab, now));
          savedTabsChanged = true;
          try {
            await chrome.tabs.remove(tab.id);
            frozenThisRun++;
            await incrementTotalFrozen();
            addLog("Агрессивная заморозка", `Закрыта: ${tab.title}`);
          } catch (err) {
            addLog("Ошибка", `Не удалось закрыть ${tab.id}: ${err.message}`);
          }
        } else {
          try {
            await chrome.tabs.discard(tab.id);
            frozenThisRun++;
            await incrementTotalFrozen();
            addLog("Заморозка", `Выгружена: ${tab.title}`);
          } catch (err) {
            addLog("Ошибка", `Не удалось выгрузить ${tab.id}: ${err.message}`);
          }
        }
      }
    }
    if (frozenThisRun === 0) {
      addLog("Проверка", `Кандидатов: ${candidates}, никто не подошёл.`);
    }
    if (savedTabsChanged) {
      await chrome.storage.local.set({ savedTabs });
    }
  } catch (err) {
    console.error("Freeze check error:", err);
    addLog("Ошибка", `Сбой: ${err.message}`);
  }
}

async function openDashboard() {
  const dashboardUrl = chrome.runtime.getURL("dashboard.html");
  const tabs = await chrome.tabs.query({ url: dashboardUrl });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: dashboardUrl });
  }
}

// === СТАРТ ===
(async function init() {
  console.log("Service worker started");
  await ensureSettings();
  await ensureAlarm();
  await runFreezeCheck("worker-startup");
})();

// === СЛУШАТЕЛИ ===
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "open-dashboard", title: "❄️ Открыть панель управления", contexts: ["action"] });
  });
  await ensureSettings();
  await ensureAlarm();
  await runFreezeCheck("onInstalled");
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureSettings();
  await ensureAlarm();
  await runFreezeCheck("onStartup");
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) await runFreezeCheck("alarm");
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "open-dashboard") openDashboard();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await ensureSettings();
    const data = await chrome.storage.local.get(["settings", "savedTabs", "logs", "totalFrozen", "tempExemptions"]);
    const settings = data.settings || DEFAULT_SETTINGS;
    const savedTabs = data.savedTabs || [];
    const totalFrozen = data.totalFrozen || 0;

    switch (message.type) {
      case "get-stats": {
        const allTabs = await chrome.tabs.query({});
        sendResponse({ total: allTabs.length, discarded: allTabs.filter(t => t.discarded).length, saved: savedTabs.length, totalFrozen });
        break;
      }
      case "get-tab-list": {
        const allTabs = await chrome.tabs.query({});
        sendResponse({ tabs: allTabs });
        break;
      }
      case "close-tab": {
        if (message.tabId) { await chrome.tabs.remove(message.tabId); addLog("Закрытие вкладки", `ID: ${message.tabId}`); }
        sendResponse({ ok: true });
        break;
      }
      case "activate-tab": {
        if (message.tabId) {
          await chrome.tabs.update(message.tabId, { active: true });
          if (message.windowId) await chrome.windows.update(message.windowId, { focused: true });
        }
        sendResponse({ ok: true });
        break;
      }
      case "freeze-now": {
        await runFreezeCheck("manual");
        sendResponse({ frozen: 1 });
        break;
      }
      case "get-saved-frozen-tabs": sendResponse({ tabs: savedTabs }); break;
      case "open-saved-frozen-tab": {
        const target = savedTabs.find(t => t.id === message.id);
        if (target) {
          await chrome.tabs.create({ url: target.url });
          await chrome.storage.local.set({ savedTabs: savedTabs.filter(t => t.id !== message.id) });
          addLog("Восстановление", `Открыта: ${target.title}`);
        }
        sendResponse({ ok: true });
        break;
      }
      case "delete-saved-frozen-tab": {
        await chrome.storage.local.set({ savedTabs: savedTabs.filter(t => t.id !== message.id) });
        sendResponse({ ok: true });
        break;
      }
      case "clear-saved-frozen-tabs": {
        await chrome.storage.local.set({ savedTabs: [] });
        sendResponse({ ok: true });
        break;
      }
      case "get-settings": sendResponse(settings); break;
      case "save-settings": {
        const merged = { ...settings, ...message.settings };
        if (Array.isArray(merged.whitelist)) {
          const seen = new Set();
          merged.whitelist = merged.whitelist.map(normalizeDomain).filter(d => d && !seen.has(d) && (seen.add(d), true));
        }
        await chrome.storage.local.set({ settings: merged });
        addLog("Настройки", "Изменены");
        sendResponse({ ok: true });
        break;
      }
      case "get-logs": sendResponse({ logs: data.logs || [] }); break;
      case "clear-logs": {
        await chrome.storage.local.set({ logs: [] });
        sendResponse({ ok: true });
        break;
      }
      case "open-dashboard": {
        await openDashboard();
        sendResponse({ ok: true });
        break;
      }
      case "add-temp-exemption": {
        const { domain, durationMinutes } = message;
        if (!domain || !durationMinutes) { sendResponse({ error: "Missing data" }); break; }
        const exemptions = await getTempExemptions();
        const expiry = Date.now() + durationMinutes * 60 * 1000;
        await setTempExemptions([...exemptions.filter(e => e.domain !== domain), { domain, expiry }]);
        addLog("Временное исключение", `${domain} на ${durationMinutes} мин.`);
        sendResponse({ ok: true });
        break;
      }
      case "remove-temp-exemption": {
        const { domain } = message;
        const exemptions = await getTempExemptions();
        await setTempExemptions(exemptions.filter(e => e.domain !== domain));
        sendResponse({ ok: true });
        break;
      }
      case "get-temp-exemptions": {
        const exemptions = await getTempExemptions();
        const now = Date.now();
        const active = exemptions.filter(e => e.expiry > now);
        if (active.length !== exemptions.length) await setTempExemptions(active);
        sendResponse({ exemptions: active });
        break;
      }
      default: sendResponse({ error: "Unknown message type" });
    }
  })();
  return true;
});