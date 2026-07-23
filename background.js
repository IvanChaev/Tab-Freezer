// background.js — точка входа service worker'а.
import { ensureSettings, addLog } from "./bg/storage.js";
import { ALARM_NAME, runFreezeCheck } from "./bg/freeze.js";
import { openDashboard } from "./bg/open-dashboard.js";
import { setupMessageListener } from "./bg/messages.js";
import { updateAudioCache, removeFromAudioCache } from "./bg/audio-cache.js";
import { initActivityTracking, resetDeactivationTimes } from "./bg/activity.js";

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

async function setupContextMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "open-dashboard",
    title: "❄️ Открыть панель управления",
    contexts: ["action"]
  });
}

function registerListeners() {
  chrome.runtime.onInstalled.addListener(async () => {
    await setupContextMenu();
    await ensureSettings();
    await ensureAlarm();
    await runFreezeCheck("onInstalled");
  });

  chrome.runtime.onStartup.addListener(async () => {
    await resetDeactivationTimes();
    await ensureSettings();
    await ensureAlarm();
    await runFreezeCheck("onStartup");
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) {
      await ensureSettings();
      await runFreezeCheck("alarm");
    }
  });

  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === "open-dashboard") openDashboard();
  });

  setupMessageListener();

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.audible !== undefined) {
      updateAudioCache(tabId, changeInfo.audible);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    removeFromAudioCache(tabId);
  });
}

// === СТАРТ ===
(async function init() {
  console.log("Service worker started");
  registerListeners();

  // Дожидаемся завершения восстановления карты активности, чтобы
  // следующие вызовы (ensureSettings, runFreezeCheck) работали с актуальными данными.
  await initActivityTracking({ restore: true });

  await ensureSettings();
  await ensureAlarm();

  try {
    await runFreezeCheck("worker-startup");
  } catch (e) {
    console.error("Ошибка стартовой проверки:", e);
  }
})();