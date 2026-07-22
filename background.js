// background.js — точка входа service worker'а.
import { ensureSettings, addLog } from "./bg/storage.js";
import { ALARM_NAME, runFreezeCheck } from "./bg/freeze.js";
import { openDashboard } from "./bg/open-dashboard.js";
import { setupMessageListener } from "./bg/messages.js";
import { updateAudioCache, removeFromAudioCache } from "./bg/audio-cache.js";

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

  // Регистрируем обработчик сообщений
  setupMessageListener();

  // 🆕 Долгоживущее соединение для dashboard, чтобы service worker не засыпал
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "dashboard") {
      console.log("Dashboard connected");
      port.onDisconnect.addListener(() => console.log("Dashboard disconnected"));
    }
  });

  // ---- Аудио-кеш: отслеживаем изменения статуса audible ----
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
  await ensureSettings();
  await ensureAlarm();
  runFreezeCheck("worker-startup").catch(console.error);
})();