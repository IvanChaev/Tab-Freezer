importScripts("shared.js");

// ---- Система логирования ----
const MAX_LOGS = 500;

async function addLog(action, details = "") {
  try {
    const data = await chrome.storage.local.get("appLogs");
    const logs = data.appLogs || [];
    const timestamp = new Date().toISOString();
    
    logs.unshift({ timestamp, action, details });
    if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
    
    await chrome.storage.local.set({ appLogs: logs });
  } catch (e) {
    console.error("Ошибка записи лога:", e);
  }
}

const DEFAULT_SETTINGS = {
  timeoutMinutes: 15,
  closeOldMinutes: 120,
  autoClose: false,
  excludePinned: true,
  excludeAudio: true,
  whitelist: []
};

const lastActive = new Map();

function now() {
  return Date.now();
}

function getTabIdleMs(tab, currentTimestamp) {
  const nativeLast = (tab.lastAccessed && tab.lastAccessed > 0) ? tab.lastAccessed : 0;
  const customLast = lastActive.get(tab.id) || 0;
  const last = Math.max(nativeLast, customLast) || currentTimestamp;
  return Math.max(0, currentTimestamp - last);
}

// ---- Работа с frozenAt в session storage ----
async function getFrozenAtMap() {
  const data = await chrome.storage.session.get('frozenAt');
  return data.frozenAt || {};
}

async function setFrozenAt(tabId, timestamp) {
  const map = await getFrozenAtMap();
  map[tabId] = timestamp;
  await chrome.storage.session.set({ frozenAt: map });
}

async function deleteFrozenAt(tabId) {
  const map = await getFrozenAtMap();
  delete map[tabId];
  await chrome.storage.session.set({ frozenAt: map });
}

// ---- Настройки ----
async function getSettings() {
  try {
    const local = await chrome.storage.local.get(null);
    if (local && Object.keys(local).length > 0) {
      return { ...DEFAULT_SETTINGS, ...local };
    }
    const synced = await chrome.storage.sync.get(null).catch(() => null);
    if (synced && Object.keys(synced).length > 0) {
      await chrome.storage.local.set(synced);
      return { ...DEFAULT_SETTINGS, ...synced };
    }
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

async function saveSettingsInternal(settings) {
  await chrome.storage.local.set(settings);
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isSystemPage(url) {
  if (!url) return true;
  return /^(about|moz-extension|chrome|chrome-extension|resource|data|view-source|jar|devtools|extension):/i.test(url);
}

function isWhitelisted(url, whitelist) {
  const host = getHostname(url);
  if (!host) return false;
  return whitelist.some((entry) => {
    const e = normalizeDomain(entry);
    if (!e) return false;
    return host === e || host.endsWith("." + e);
  });
}

// ---- Единая функция проверки на возможность автозакрытия ----
function isEligibleForAutoClose(tab, settings, nowTime, frozenMap) {
  if (isSystemPage(tab.url)) return false;
  if (tab.active) return false;
  if (settings.excludePinned && tab.pinned) return false;
  if (settings.excludeAudio && tab.audible) return false;
  if (isWhitelisted(tab.url || "", settings.whitelist)) return false;
  
  if (!tab.discarded) return false;

  const closeMs = settings.closeOldMinutes * 60 * 1000;
  if (closeMs <= 0) return false;

  const idleMs = getTabIdleMs(tab, nowTime);
  return idleMs >= closeMs;
}

// ---- Инициализация вкладок (с логированием) ----
async function initTabs() {
  const tabs = await chrome.tabs.query({});
  const t = now();
  const frozenMap = await getFrozenAtMap();
  let needUpdate = false;
  let restoredCount = 0;

  for (const tab of tabs) {
    if (!lastActive.has(tab.id)) {
      lastActive.set(tab.id, tab.lastAccessed || t);
    }
    if (tab.discarded && !frozenMap[tab.id]) {
      frozenMap[tab.id] = tab.lastAccessed || t;
      needUpdate = true;
      restoredCount++;
    }
    if (!tab.discarded && frozenMap[tab.id]) {
      delete frozenMap[tab.id];
      needUpdate = true;
    }
  }
  if (needUpdate) {
    await chrome.storage.session.set({ frozenAt: frozenMap });
  }
  addLog("Инициализация", `Обнаружено вкладок: ${tabs.length}. Восстановлено замороженных: ${restoredCount}`);
}

// ---- События активности (с логированием разморозки) ----
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const t = now();
  lastActive.set(activeInfo.tabId, t);
  
  const frozenMap = await getFrozenAtMap();
  const isFrozen = !!frozenMap[activeInfo.tabId];
  deleteFrozenAt(activeInfo.tabId);
  
  if (isFrozen) {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
      await chrome.tabs.reload(activeInfo.tabId);
      addLog("Разморозка", `Активация и перезагрузка вкладки [ID: ${activeInfo.tabId}]: "${tab?.title || tab?.url || 'неизвестно'}"`);
    } catch (e) {}
  }
  
  if (activeInfo.previousTabId) {
    lastActive.set(activeInfo.previousTabId, t);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    lastActive.set(tabId, now());
  }
  if (changeInfo.discarded !== undefined) {
    if (changeInfo.discarded) {
      setFrozenAt(tabId, now());
    } else {
      deleteFrozenAt(tabId);
    }
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  lastActive.set(tab.id, now());
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastActive.delete(tabId);
  deleteFrozenAt(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  lastActive.delete(removedTabId);
  deleteFrozenAt(removedTabId);
  lastActive.set(addedTabId, now());
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const tabs = await chrome.tabs.query({ active: true, windowId });
  if (tabs[0]) {
    lastActive.set(tabs[0].id, now());
    deleteFrozenAt(tabs[0].id);
  }
});

// ---- Заморозка с логированием ----
async function discardTabSafely(tab) {
  if (tab.active) return false;
  try {
    const idleMin = Math.round(getTabIdleMs(tab, now()) / 60000);
    await chrome.tabs.discard(tab.id);
    await setFrozenAt(tab.id, now());
    addLog("Заморозка", `Вкладка "${tab.title}" [ID: ${tab.id}] заморожена (бездействие: ~${idleMin} мин.)`);
    return true;
  } catch (e) {
    addLog("Ошибка заморозки", `Не удалось заморозить "${tab.title}" [ID: ${tab.id}]: ${e.message}`);
    return false;
  }
}

// ---- Автоматическая проверка через alarms ----
chrome.alarms.create("checkIdleTabs", { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkIdleTabs") {
    checkIdleTabs();
  }
});

async function checkIdleTabs() {
  await initTabs();
  const settings = await getSettings();
  const freezeMs = settings.timeoutMinutes * 60 * 1000;
  const tabs = await chrome.tabs.query({});
  const t = now();
  const frozenMap = await getFrozenAtMap();

  for (const tab of tabs) {
    // ---- Заморозка ----
    if (!tab.discarded && !tab.active && !isSystemPage(tab.url) &&
        !(settings.excludePinned && tab.pinned) &&
        !(settings.excludeAudio && tab.audible) &&
        !isWhitelisted(tab.url || "", settings.whitelist)) {
      const idleMs = getTabIdleMs(tab, t);
      if (freezeMs > 0 && idleMs >= freezeMs) {
        await discardTabSafely(tab);
      }
    }

    // ---- Автозакрытие (только замороженных, по времени) ----
    if (settings.autoClose && isEligibleForAutoClose(tab, settings, t, frozenMap)) {
      try {
        const title = tab.title || tab.url;
        await chrome.tabs.remove(tab.id);
        delete frozenMap[tab.id];
        await chrome.storage.session.set({ frozenAt: frozenMap });
        addLog("Автозакрытие", `Закрыта старая замороженная вкладка "${title}" [ID: ${tab.id}]`);
      } catch (e) { /* ignore */ }
    }
  }
}

// ---- Ручное закрытие ВСЕХ замороженных вкладок (без учёта времени) ----
async function closeOldTabs(minutes) {
  // Параметр minutes игнорируется – кнопка закрывает все замороженные вкладки
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  const frozenMap = await getFrozenAtMap();
  let closed = 0;
  let notDiscarded = 0;
  let system = 0;
  let active = 0;
  let pinned = 0;
  let audio = 0;
  let whitelisted = 0;

  for (const tab of tabs) {
    if (isSystemPage(tab.url)) { system++; continue; }
    if (tab.active) { active++; continue; }
    if (settings.excludePinned && tab.pinned) { pinned++; continue; }
    if (settings.excludeAudio && tab.audible) { audio++; continue; }
    if (isWhitelisted(tab.url || "", settings.whitelist)) { whitelisted++; continue; }
    if (!tab.discarded) { notDiscarded++; continue; }

    // Закрываем все замороженные, прошедшие фильтры
    try {
      await chrome.tabs.remove(tab.id);
      delete frozenMap[tab.id];
      closed++;
    } catch (e) { /* ignore */ }
  }

  let logDetails = `Всего вкладок: ${tabs.length}. ` +
    `Закрыто замороженных: ${closed}. ` +
    `Не заморожены: ${notDiscarded}, ` +
    `Системные: ${system}, активные: ${active}, закреплённые: ${pinned}, со звуком: ${audio}, в белом списке: ${whitelisted}.`;

  if (closed > 0) {
    await chrome.storage.session.set({ frozenAt: frozenMap });
    addLog("Очистка вкладок (ручная)", logDetails);
  } else {
    addLog("Очистка вкладок (ручная)", logDetails + " (ни одна не закрыта)");
  }
  return closed;
}

// ---- Заморозить все сейчас ----
async function freezeAllNow() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  let frozen = 0;

  for (const tab of tabs) {
    if (tab.discarded) continue;
    if (isSystemPage(tab.url)) continue;
    if (tab.active) continue;
    if (settings.excludePinned && tab.pinned) continue;
    if (settings.excludeAudio && tab.audible) continue;
    if (isWhitelisted(tab.url || "", settings.whitelist)) continue;

    const success = await discardTabSafely(tab);
    if (success) frozen++;
  }
  addLog("Принудительная заморозка", `Заморожено вкладок по команде: ${frozen}`);
  return frozen;
}

// ---- Категории для списка ----
function getTabCategory(tab) {
  if (tab.system) return "system";
  if (tab.pinned || tab.immunePinned) return "pinned";
  if (tab.discarded) return "frozen";
  if (tab.immuneAudio) return "audio";
  if (tab.immuneWhitelist) return "whitelist";
  if (tab.active) return "active";
  return "waiting";
}

const CATEGORY_RANK = {
  pinned: 0,
  frozen: 1,
  waiting: 2,
  active: 3,
  audio: 4,
  whitelist: 5,
  system: 6
};

// ---- Обработка сообщений ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ---- Логирование ----
  if (msg?.type === "get-logs") {
    chrome.storage.local.get("appLogs").then((data) => {
      sendResponse({ logs: data.appLogs || [] });
    });
    return true;
  }
  if (msg?.type === "clear-logs") {
    chrome.storage.local.set({ appLogs: [] }).then(() => {
      addLog("Очистка логов", "История событий была очищена пользователем");
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg?.type === "freeze-now") {
    freezeAllNow().then((frozen) => sendResponse({ frozen }));
    return true;
  }
  if (msg?.type === "close-tab" && msg.tabId) {
    chrome.tabs.remove(msg.tabId)
      .then(() => {
        addLog("Закрытие вкладки", `Вкладка [ID: ${msg.tabId}] закрыта через список в попапе`);
        sendResponse({ ok: true });
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === "close-old-tabs" && msg.minutes) {
    closeOldTabs(msg.minutes).then((closed) => sendResponse({ closed }));
    return true;
  }
  if (msg?.type === "get-stats") {
    chrome.tabs.query({}).then((tabs) => sendResponse({
      total: tabs.length,
      discarded: tabs.filter((t) => t.discarded).length
    }));
    return true;
  }
  if (msg?.type === "get-tab-list") {
    (async () => {
      await initTabs();
      const tabs = await chrome.tabs.query({});
      const settings = await getSettings();
      const frozenMap = await getFrozenAtMap();
      const t = now();
      const list = tabs
        .map((tab) => {
          const whitelisted = isWhitelisted(tab.url || "", settings.whitelist);
          const fTime = frozenMap[tab.id] || 0;
          const idleMs = getTabIdleMs(tab, t);
          const entry = {
            id: tab.id,
            title: tab.title || tab.url || "Вкладка",
            url: tab.url || "",
            favIconUrl: tab.favIconUrl || "",
            discarded: !!tab.discarded,
            active: !!tab.active,
            pinned: !!tab.pinned,
            audible: !!tab.audible,
            system: isSystemPage(tab.url),
            immunePinned: settings.excludePinned && !!tab.pinned,
            immuneAudio: settings.excludeAudio && !!tab.audible,
            immuneWhitelist: whitelisted,
            idleMs: idleMs,
            frozenMs: (tab.discarded && fTime) ? Math.max(0, t - fTime) : 0
          };
          entry.category = getTabCategory(entry);
          return entry;
        })
        .sort((a, b) => {
          const rankDiff = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
          if (rankDiff !== 0) return rankDiff;
          if (b.idleMs !== a.idleMs) return b.idleMs - a.idleMs;
          return a.title.localeCompare(b.title, "ru");
        });
      sendResponse({ tabs: list });
    })();
    return true;
  }
  if (msg?.type === "save-settings") {
    saveSettingsInternal(msg.settings)
      .then(() => {
        addLog("Настройки", "Настройки расширения сохранены / обновлены");
        sendResponse({ ok: true });
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === "get-settings") {
    getSettings().then((settings) => sendResponse(settings));
    return true;
  }
});

initTabs();
chrome.runtime.onInstalled.addListener(initTabs);
chrome.runtime.onStartup.addListener(initTabs);